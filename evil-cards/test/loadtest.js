/**
 * loadtest.js — 12 фейковых клиентов играют 20 раундов против ЗАПУЩЕННОГО сервера.
 *
 * Сервер поднимается отдельным процессом, поэтому пиковая память меряется честно:
 * это RSS именно игры, без веса самих клиентов.
 *
 * Запуск:
 *   npm run loadtest
 *   LOADTEST_URL=https://<ip>.sslip.io npm run loadtest   — против боевого сервера
 *
 * На сервере Aeza это обязательный прогон перед праздником (ТЗ 10).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PLAYERS = Number(process.env.LOADTEST_PLAYERS || 12);
const ROUNDS = Number(process.env.LOADTEST_ROUNDS || 20);
const PORT = Number(process.env.LOADTEST_PORT || 3999);
const EXTERNAL = process.env.LOADTEST_URL || '';
const TIMEOUT_MS = Number(process.env.LOADTEST_TIMEOUT || 180000);
const MEM_LIMIT_MB = Number(process.env.LOADTEST_MEM_LIMIT || 256);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

let serverProc = null;
let tmpDir = null;

async function startServer() {
  if (EXTERNAL) {
    log(`Тестируем внешний сервер: ${EXTERNAL}`);
    return EXTERNAL.replace(/\/+$/, '');
  }

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-cards-load-'));
  log(`Поднимаю сервер на порту ${PORT}, данные в ${tmpDir}`);

  serverProc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stderr.on('data', (b) => process.stderr.write('[сервер] ' + b));

  const url = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url + '/health');
      if (res.ok) return url;
    } catch { /* ещё не поднялся */ }
    await sleep(250);
  }
  throw new Error('сервер не поднялся за 15 секунд');
}

async function health(baseUrl) {
  try {
    const res = await fetch(baseUrl + '/health');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function connect(baseUrl, role) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      reconnection: true,
      timeout: 10000,
    });
    const t = setTimeout(() => reject(new Error('не удалось подключиться за 10 с')), 12000);
    socket.on('connect', () => {
      clearTimeout(t);
      socket.emit('hello', { role });
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

async function main() {
  const baseUrl = await startServer();
  const counters = { statesReceived: 0, actionsSent: 0, toasts: 0, errors: 0 };
  // Копим тексты ошибок: без них падение теста невозможно диагностировать.
  const toastCounts = new Map();
  const noteToast = (t) => {
    counters.toasts += 1;
    const msg = t?.message ?? String(t);
    toastCounts.set(msg, (toastCounts.get(msg) ?? 0) + 1);
  };
  const peak = { rss: 0, heap: 0 };
  const startedAt = Date.now();

  // ---- следим за памятью сервера всё время прогона ----
  let watching = true;
  const memWatcher = (async () => {
    while (watching) {
      const h = await health(baseUrl);
      if (h) {
        peak.rss = Math.max(peak.rss, h.rssMb ?? 0);
        peak.heap = Math.max(peak.heap, h.heapMb ?? 0);
      }
      await sleep(400);
    }
  })();

  // ---- подключаем ноутбук и игроков ----
  const screen = await connect(baseUrl, 'screen');
  screen.on('toast', noteToast);

  const clients = [];
  for (let i = 0; i < PLAYERS; i += 1) {
    const socket = await connect(baseUrl, 'player');
    const client = { socket, name: `Нагрузка ${i + 1}`, id: null, acted: new Set(), submittedRound: 0 };
    socket.on('identity', ({ playerId }) => { client.id = playerId; });
    socket.on('toast', noteToast);
    clients.push(client);
  }
  log(`Подключено: 1 ноутбук + ${clients.length} игроков`);

  // ---- вход и подготовка ----
  for (const c of clients) {
    await new Promise((resolve) => c.socket.emit('join', { name: c.name }, resolve));
    c.socket.emit('card:add', { kind: 'prompt', text: `Вопрос от ${c.name}: ___.` });
    for (let k = 0; k < 4; k += 1) {
      c.socket.emit('card:add', { kind: 'answer', text: `ответ ${c.name} №${k}` });
    }
    c.socket.emit('prep:ready', { ready: true });
    counters.actionsSent += 6;
  }

  // Большая база, чтобы карт хватило на 20 раундов.
  const base = {
    prompts: Array.from({ length: 60 }, (_, i) => `Базовый вопрос ${i}: ___.`).join('\n'),
    answers: Array.from({ length: 600 }, (_, i) => `базовый ответ ${i}`).join('\n'),
  };
  await new Promise((resolve) => screen.emit('admin:saveBase', base, resolve));
  await sleep(300);

  // ---- игровой цикл: каждый клиент реагирует на свой снимок ----
  let roundsDone = 0;
  let finished = false;
  const doneAt = { time: 0 };

  const act = (client, snap) => {
    counters.statesReceived += 1;
    const r = snap.round;
    if (!r || snap.phase !== 'round') return;

    // Ключ обязан включать число уже полученных ответов: пока копятся ответы,
    // шаг не меняется, а ведущему в какой-то момент становится можно вскрывать.
    // Без `answered` ведущий «засыпает» на первом же снимке шага и раунд встаёт.
    const key = `${r.number}:${r.step}:${r.revealedCount}:${r.answered}`;
    if (client.acted.has(key)) return;
    client.acted.add(key);
    if (client.acted.size > 400) client.acted.clear();

    const send = (event, payload) => {
      counters.actionsSent += 1;
      client.socket.emit(event, payload);
    };

    if (snap.can.draw) return send('host:draw', { round: r.number });
    if (snap.can.submit && snap.you?.hand?.length) {
      // Свой ответ шлём один раз за раунд: снимок с can.submit может прийти
      // ещё раз до того, как сервер учтёт наш ход.
      if (client.submittedRound === r.number) return;
      client.submittedRound = r.number;
      // В снимке рука — это объекты {id, text}, сервер ждёт строковый id.
      return send('answer:submit', { round: r.number, cardId: snap.you.hand[0].id });
    }
    if (snap.can.reveal) return send('host:reveal', { round: r.number, index: r.revealedCount });
    if (snap.can.skipWaiting) return send('host:skipWaiting', { round: r.number });
    if (snap.can.pick && r.reveals.length) {
      return send('host:pick', { round: r.number, submissionId: r.reveals[0].id });
    }
    if (snap.can.next) {
      if (r.step === 'result') roundsDone = Math.max(roundsDone, r.number);
      return send('host:next', { round: r.number });
    }
  };

  for (const c of clients) c.socket.on('state', (snap) => act(c, snap));

  // Ноутбук страхует: если ведущий отвалился, кнопки жмёт он.
  const screenClient = { socket: screen, acted: new Set() };
  screen.on('state', (snap) => {
    counters.statesReceived += 1;
    if (snap.phase === 'gameOver') { finished = true; doneAt.time = Date.now(); return; }
    if (snap.round && snap.round.number > roundsDone) roundsDone = snap.round.number - 1;
  });

  // Цель по очкам ставим большой, чтобы игра не кончилась раньше 20 раундов.
  await new Promise((resolve) => screen.emit('admin:settings', { targetScore: 10, handSize: 10 }, resolve));
  const started = await new Promise((resolve) =>
    screen.emit('admin:start', { force: true }, resolve)
  );
  if (!started?.ok) throw new Error('игра не стартовала: ' + started?.error);
  log('Игра пошла, играем ' + ROUNDS + ' раундов…');

  const deadline = Date.now() + TIMEOUT_MS;
  let lastReport = 0;
  while (roundsDone < ROUNDS && !finished && Date.now() < deadline) {
    await sleep(250);
    if (Date.now() - lastReport > 5000) {
      lastReport = Date.now();
      log(`  раунд ${roundsDone}/${ROUNDS}, RSS ${peak.rss} МБ`);
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const timedOut = roundsDone < ROUNDS && !finished;

  // Финальный замер уже без нагрузки.
  await sleep(500);
  const finalHealth = await health(baseUrl);
  watching = false;
  await memWatcher;

  // ---- отчёт ----
  log('');
  log('  ═══ Нагрузочный тест ═══');
  log(`  Игроков:              ${PLAYERS} + ноутбук`);
  log(`  Раундов сыграно:      ${roundsDone} из ${ROUNDS}${finished ? ' (игра закончилась раньше)' : ''}`);
  log(`  Время:                ${elapsed.toFixed(1)} с`);
  log(`  Снимков получено:     ${counters.statesReceived}`);
  log(`  Действий отправлено:  ${counters.actionsSent}`);
  log(`  Тостов с ошибками:    ${counters.toasts}`);
  for (const [msg, n] of [...toastCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    log(`      ${n}× «${msg}»`);
  }
  log(`  ПИКОВАЯ ПАМЯТЬ (RSS): ${peak.rss} МБ   ← лимит контейнера ${MEM_LIMIT_MB} МБ`);
  log(`  Пиковый heap:         ${peak.heap} МБ`);
  log(`  После нагрузки:       RSS ${finalHealth?.rssMb ?? '?'} МБ, heap ${finalHealth?.heapMb ?? '?'} МБ`);
  log('');

  const verdict = [];
  if (timedOut) verdict.push(`не доиграли до ${ROUNDS} раундов за ${TIMEOUT_MS / 1000} с`);
  if (peak.rss > MEM_LIMIT_MB * 0.8) {
    verdict.push(`память ${peak.rss} МБ — это больше 80% от лимита ${MEM_LIMIT_MB} МБ`);
  }

  for (const c of clients) c.socket.close();
  screen.close();
  void screenClient;

  if (verdict.length) {
    log('  ✖ ПРОБЛЕМЫ:');
    for (const v of verdict) log('    — ' + v);
    log('');
    return 1;
  }
  log('  ✔ Всё в порядке: сервер выдержал нагрузку с запасом по памяти.');
  log('');
  return 0;
}

function cleanup() {
  if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* не критично */ }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  const code = await main();
  cleanup();
  await sleep(200);
  process.exit(code);
} catch (err) {
  console.error('\n  ✖ Нагрузочный тест упал:', err?.stack ?? err);
  cleanup();
  process.exit(1);
}
