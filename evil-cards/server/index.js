/**
 * index.js — Express + Socket.io, статика, QR, определение адреса.
 *
 * Здесь нет ни одного игрового правила: слой только принимает события,
 * зовёт методы Game и рассылает персональные снимки.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';
import { Server as SocketServer } from 'socket.io';
import QRCode from 'qrcode';

import { Game } from './game.js';
import { createStorage } from './storage.js';
import { parseBaseFile } from './deck.js';
import { createBotDriver } from './bots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FIXTURES_DIR = path.join(ROOT, 'test', 'fixtures');

/**
 * Виртуальные адаптеры, из-за которых QR уводит в никуда: WSL, VirtualBox,
 * VMware, Hyper-V, докер-мосты, VPN-туннели (ТЗ 5.6).
 */
const VIRTUAL_IFACE =
  /(vethernet|wsl|virtualbox|vmware|hyper-?v|docker|br-|veth|tap|tun\d|utun|zerotier|tailscale|wg\d|vpn|loopback|bluetooth)/i;

/** Приоритет: домашняя сеть 192.168 → 10.x → 172.16-31 → всё остальное. */
function ipRank(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

/** Все пригодные локальные IPv4, лучший — первым. */
export function localIPv4List() {
  const found = [];
  let ifaces = {};
  try {
    ifaces = os.networkInterfaces();
  } catch {
    return [];
  }
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const a of addrs ?? []) {
      const family = a.family === 'IPv4' || a.family === 4;
      if (!family || a.internal) continue;
      found.push({ ip: a.address, name, rank: ipRank(a.address) });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.ip.localeCompare(b.ip));
  return found.map((x) => x.ip);
}

function readFixtures() {
  const read = (file) => {
    try {
      return parseBaseFile(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    } catch {
      return [];
    }
  };
  return { prompts: read('prompts.txt'), answers: read('answers.txt') };
}

export function createApp({ port = Number(process.env.PORT) || 3000,
                            publicUrl = process.env.PUBLIC_URL || '',
                            dataDir = DATA_DIR,
                            quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  fs.mkdirSync(dataDir, { recursive: true });

  const storage = createStorage({ dataDir });
  // Объявляем заранее: onChange может сработать раньше, чем драйвер создан.
  let bots = { tick() {}, stop() {} };

  const game = new Game({
    storage,
    fixtures: readFixtures(),
    onChange: () => {
      storage.save(game.state);
      scheduleBroadcast();
      bots.tick();
    },
  });

  const restored = storage.load();
  if (restored && game.restore(restored)) {
    log('[игра] состояние восстановлено из data/state.json');
  }

  bots = createBotDriver({ game, log: (m) => log(m) });

  // ---------------------------------------------------------------- адреса
  function candidateUrls() {
    const urls = [];
    if (publicUrl) urls.push(publicUrl.replace(/\/+$/, ''));
    for (const ip of localIPv4List()) urls.push(`http://${ip}:${port}`);
    if (urls.length === 0) urls.push(`http://localhost:${port}`);
    return [...new Set(urls)];
  }

  function activeUrl() {
    const urls = candidateUrls();
    const chosen = game.state.selectedUrl;
    return chosen && urls.includes(chosen) ? chosen : urls[0];
  }

  function networkInfo() {
    return { publicUrl, urls: candidateUrls(), selectedUrl: activeUrl() };
  }

  // -------------------------------------------------------------------- QR
  let qrCache = { url: null, dataUrl: null };
  async function getQr() {
    const url = activeUrl();
    if (qrCache.url === url && qrCache.dataUrl) return qrCache;
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 900,
        color: { dark: '#000000', light: '#ffffff' },
      });
      qrCache = { url, dataUrl };
    } catch (err) {
      log('[qr] не удалось сгенерировать:', err?.message);
      qrCache = { url, dataUrl: null };
    }
    return qrCache;
  }

  // --------------------------------------------------------------- express
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      phase: game.state.phase,
      players: game.state.players.length,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
    });
  });

  // Игра идёт один вечер и часто правится — кеш только мешает.
  app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: true, index: false }));

  app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/screen', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'screen.html')));

  const server = http.createServer(app);
  const io = new SocketServer(server, {
    maxHttpBufferSize: 1e6,
    pingTimeout: 25000,
    pingInterval: 20000,
    // Оставляем и polling: если WebSocket не проксируется, игра всё равно работает.
    transports: ['polling', 'websocket'],
  });

  // ---------------------------------------------------- рассылка снимков
  let broadcastQueued = false;
  function scheduleBroadcast() {
    if (broadcastQueued) return;
    broadcastQueued = true;
    setImmediate(() => {
      broadcastQueued = false;
      broadcast();
    });
  }

  function socketActor(socket) {
    if (socket.data.role === 'screen') return { role: 'screen' };
    return { role: 'player', playerId: socket.data.playerId ?? null };
  }

  function broadcast() {
    let base;
    let network;
    try {
      base = game.baseCounts();
      network = networkInfo();
    } catch (err) {
      log('[state] не собрался контекст снимка:', err?.message);
      base = { prompts: 0, answers: 0 };
      network = { publicUrl, urls: [], selectedUrl: '' };
    }
    for (const socket of io.of('/').sockets.values()) {
      try {
        socket.emit('state', game.snapshotFor(socketActor(socket), { base, network }));
      } catch (err) {
        log('[state] снимок не отправился:', err?.message);
      }
    }
  }

  async function sendQr(socket) {
    const { dataUrl, url } = await getQr();
    socket.emit('qr', { dataUrl, url });
  }

  function broadcastQr() {
    getQr().then(({ dataUrl, url }) => {
      for (const socket of io.of('/').sockets.values()) {
        if (socket.data.role === 'screen') socket.emit('qr', { dataUrl, url });
      }
    });
  }

  // ------------------------------------------------------------- действия
  /** Действия игрока: обычные методы Game, первым аргументом actor. */
  const PLAYER_ACTIONS = {
    'card:add': 'addCard',
    'card:edit': 'editCard',
    'card:delete': 'deleteCard',
    'prep:ready': 'setReady',
    'answer:submit': 'submitAnswer',
    'answer:retract': 'retractAnswer',
  };

  /** Действия ведущего — их может нажать и ноутбук вместо ведущего (ТЗ 3.2). */
  const HOST_ACTIONS = {
    'host:draw': 'hostDraw',
    'host:redraw': 'hostRedraw',
    'host:skipWaiting': 'hostSkipWaiting',
    'host:reveal': 'hostReveal',
    'host:pick': 'hostPick',
    'host:next': 'hostNext',
  };

  /** Действия организатора — только с ноутбука, Game это ещё раз проверяет. */
  const ADMIN_ACTIONS = {
    'admin:start': 'adminStart',
    'admin:settings': 'adminSettings',
    'admin:kick': 'adminKick',
    'admin:passHost': 'adminPassHost',
    'admin:newGame': 'adminNewGame',
    'admin:reset': 'adminReset',
    'admin:setIp': 'adminSetIp',
    'admin:addBots': 'adminAddBots',
    'admin:removeBots': 'adminRemoveBots',
    'admin:saveBase': 'adminSaveBase',
  };

  io.on('connection', (socket) => {
    socket.data.role = 'player';
    socket.data.playerId = null;

    /** Единый ответ на действие: ack всегда, тост — на всё кроме «устаревшего». */
    const reply = (ack, result) => {
      if (typeof ack === 'function') {
        try {
          ack(result);
        } catch { /* клиент отвалился — не наша беда */ }
      }
      if (!result.ok && !result.stale && result.error) {
        socket.emit('toast', { message: result.error, kind: 'error' });
      }
      return result;
    };

    const guard = (fn) => (payload, ack) => {
      try {
        fn(payload ?? {}, ack);
      } catch (err) {
        log('[socket] обработчик упал:', err?.stack ?? err);
        reply(ack, { ok: false, error: 'Что-то пошло не так' });
      }
    };

    socket.on('hello', guard(({ role, token }, ack) => {
      socket.data.role = role === 'screen' ? 'screen' : 'player';

      if (socket.data.role === 'player' && token) {
        const res = game.resume({ token });
        if (res.ok) {
          socket.data.playerId = res.playerId;
          const player = game.getPlayer(res.playerId);
          socket.emit('identity', { playerId: player.id, token: player.token });
        }
      }

      if (socket.data.role === 'screen') sendQr(socket);
      reply(ack, { ok: true, role: socket.data.role });
      socket.emit('state', game.snapshotFor(socketActor(socket), {
        base: game.baseCounts(),
        network: networkInfo(),
      }));
    }));

    socket.on('join', guard(({ name }, ack) => {
      const res = game.join({ name });
      if (res.ok) {
        socket.data.role = 'player';
        socket.data.playerId = res.playerId;
        socket.emit('identity', { playerId: res.playerId, token: res.token });
      }
      reply(ack, res);
    }));

    socket.on('claim', guard(({ playerId }, ack) => {
      const res = game.claim({ playerId });
      if (res.ok) {
        socket.data.role = 'player';
        socket.data.playerId = res.playerId;
        socket.emit('identity', { playerId: res.playerId, token: res.token });
      }
      reply(ack, res);
    }));

    socket.on('sync', guard((_payload, ack) => {
      // Телефон разблокировали — отдаём свежий снимок.
      socket.emit('state', game.snapshotFor(socketActor(socket), {
        base: game.baseCounts(),
        network: networkInfo(),
      }));
      if (socket.data.role === 'screen') sendQr(socket);
      reply(ack, { ok: true });
    }));

    for (const [event, method] of Object.entries({
      ...PLAYER_ACTIONS,
      ...HOST_ACTIONS,
      ...ADMIN_ACTIONS,
    })) {
      socket.on(event, guard((payload, ack) => {
        const before = game.state.selectedUrl;
        const res = game[method](socketActor(socket), payload);
        // Сменили адрес для QR — перерисовать его на всех ноутбуках.
        if (res.ok && game.state.selectedUrl !== before) broadcastQr();
        reply(ack, res);
      }));
    }

    socket.on('disconnect', () => {
      if (socket.data.role !== 'player' || !socket.data.playerId) return;
      // Тот же игрок мог открыть вторую вкладку — тогда он всё ещё в сети.
      const stillHere = [...io.of('/').sockets.values()].some(
        (s) => s !== socket && s.data.playerId === socket.data.playerId
      );
      if (!stillHere) game.setConnected(socket.data.playerId, false);
    });
  });

  // Боты могли остаться в восстановленном состоянии — сразу их оживляем.
  bots.tick();

  async function listen() {
    await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
    const urls = candidateUrls();
    log('');
    log('  ♠  Злобные карты запущены');
    log('  ─────────────────────────────────────────────');
    log(`  Ноутбук (общий экран):  http://localhost:${port}/screen`);
    log(`  Телефоны гостей:        ${urls[0]}`);
    if (urls.length > 1) {
      log(`  Другие адреса:          ${urls.slice(1).join(', ')}`);
      log('  Не тот адрес? Поменяй в панели организатора (шестерёнка).');
    }
    log('');
    return server;
  }

  async function close() {
    bots.stop();
    try {
      await storage.flush(game.state);
    } catch (err) {
      log('[игра] не удалось сохранить состояние:', err?.message);
    }
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }

  return { app, server, io, game, storage, bots, listen, close, networkInfo, port };
}

// Автозапуск только при прямом вызове (`node server/index.js`),
// чтобы тесты и нагрузочный тест могли импортировать модуль.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const instance = createApp();
  await instance.listen();

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n[игра] ${signal} — сохраняю состояние и выключаюсь`);
    try {
      await instance.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('[игра] необработанная ошибка:', err?.stack ?? err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[игра] необработанный отказ промиса:', err?.stack ?? err);
  });
}
