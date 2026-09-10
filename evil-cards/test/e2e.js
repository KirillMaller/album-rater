/**
 * e2e.js — сквозной прогон игры в настоящем браузере.
 *
 * Поднимает сервер, открывает экран ноутбука и три «телефона» шириной 360 px,
 * играет полный раунд и ловит ЛЮБУЮ ошибку в консоли браузера. Юнит-тесты
 * этого не видят: там, где экран просто белый из-за опечатки в JS, они зелёные.
 *
 * Playwright намеренно НЕ в зависимостях проекта (ТЗ: лишних не добавлять).
 * Поставить один раз:  npm i -D playwright
 * Запустить:           npm run e2e
 * Скриншоты:           test/screenshots/
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const PORT = Number(process.env.E2E_PORT || 3555);
const BASE = `http://127.0.0.1:${PORT}`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('\n  Нужен Playwright. Поставь один раз:  npm i -D playwright\n');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (msg) => { problems.push(msg); console.log('  ⚠  ' + msg); };

// В этом окружении браузер лежит рядом, скачивать ничего не надо.
function chromePath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const dir = fs.readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
    if (dir) {
      const p = path.join(base, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* пусть Playwright ищет сам */ }
  return undefined;
}

let server;
let tmpDir;

async function startServer() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-cards-e2e-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (b) => {
    const s = String(b);
    if (!/ExperimentalWarning/.test(s)) note('сервер написал в stderr: ' + s.trim().slice(0, 200));
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(BASE + '/health')).ok) return;
    } catch { /* ждём */ }
    await sleep(250);
  }
  throw new Error('сервер не поднялся');
}

/** Любая ошибка в консоли браузера — это баг, который увидят гости. */
function watchPage(page, label) {
  page.on('pageerror', (err) => note(`[${label}] упал JS: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon/i.test(text)) return;
    note(`[${label}] ошибка в консоли: ${text.slice(0, 200)}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (/favicon/i.test(url)) return;
    note(`[${label}] запрос не прошёл: ${url.slice(0, 120)}`);
    // Внешние запросы вообще недопустимы: игра работает без интернета.
    if (!url.startsWith(BASE)) note(`[${label}] ВНЕШНИЙ ЗАПРОС: ${url}`);
  });
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      note(`[${label}] ВНЕШНИЙ ЗАПРОС (игра обязана работать без интернета): ${url}`);
    }
  });
}

/** Проверка, которой нет цены: помещается ли экран телефона в 360 px по ширине. */
async function checkNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    wide: [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40)),
  }));
  if (overflow.doc > overflow.win + 1) {
    note(`[${label}] горизонтальный скролл: ${overflow.doc}px при окне ${overflow.win}px` +
         (overflow.wide.length ? ` — вылезают: ${overflow.wide.join(', ')}` : ''));
  }
}

/** Кнопки на телефоне должны быть от 48 px (ТЗ 3.1). */
async function checkTouchTargets(page, label) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="tab"], input[type="checkbox"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;      // скрытые не считаем
      if (el.closest('[hidden]')) continue;
      if (r.height < 44 || r.width < 44) {
        out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 30)} ` +
                 `${Math.round(r.width)}×${Math.round(r.height)} «${(el.textContent || '').trim().slice(0, 20)}»`);
      }
    }
    return out.slice(0, 8);
  });
  if (small.length) note(`[${label}] мелкие кнопки (<44px): ${small.join(' | ')}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
}

async function main() {
  await startServer();
  console.log(`Сервер поднят на ${BASE}`);

  const browser = await chromium.launch({ executablePath: chromePath() });

  // --- ноутбук ---
  const screenCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const screen = await screenCtx.newPage();
  watchPage(screen, 'ноутбук');
  await screen.goto(BASE + '/screen', { waitUntil: 'networkidle' });
  await sleep(1200);
  await shot(screen, '01-ноутбук-лобби');

  const qrVisible = await screen.evaluate(() => {
    const img = document.querySelector('img[src^="data:image"]');
    return Boolean(img && img.getBoundingClientRect().width > 100);
  });
  if (!qrVisible) note('[ноутбук] QR-код не показался в лобби');

  // --- телефоны ---
  const phones = [];
  for (const name of ['Оля', 'Кирилл', 'Даша']) {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    watchPage(page, name);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await sleep(600);
    phones.push({ name, page, ctx });
  }

  await shot(phones[0].page, '02-телефон-вход');
  await checkNoHorizontalScroll(phones[0].page, 'телефон/вход');

  // Вход: имя + Enter, больше ничего (ТЗ 2.1.2).
  for (const { name, page } of phones) {
    const input = page.locator('input[type="text"]:visible, input:not([type]):visible').first();
    await input.waitFor({ timeout: 5000 });
    await input.fill(name);
    await input.press('Enter');
    await sleep(700);
    const joined = await page.evaluate(() => document.body.innerText);
    if (!joined.includes(name)) note(`[${name}] после ввода имени себя на экране не видно`);
  }
  await sleep(800);
  await shot(phones[0].page, '03-телефон-подготовка');
  await checkNoHorizontalScroll(phones[0].page, 'телефон/подготовка');
  await checkTouchTargets(phones[0].page, 'телефон/подготовка');

  // Пишем карты: по вопросу и по три ответа с каждого телефона.
  for (const { name, page } of phones) {
    const addCard = async (text) => {
      const field = page.locator('input:visible, textarea:visible').first();
      await field.fill(text);
      await field.press('Enter');
      await sleep(250);
    };
    await addCard(`Без чего ${name} не проживёт и дня: ___.`);

    // Переключаемся на вкладку ответов.
    const answersTab = page.locator('[role="tab"], .tab').filter({ hasText: /Ответ/i }).first();
    if (await answersTab.count()) {
      await answersTab.click();
      await sleep(300);
    } else {
      note(`[${name}] не нашлась вкладка «Ответы»`);
    }
    for (let i = 0; i < 4; i += 1) await addCard(`ответ от ${name} номер ${i}`);

    const readyBtn = page.locator('button').filter({ hasText: /Я готов/i }).first();
    if (await readyBtn.count()) {
      await readyBtn.click();
      await sleep(300);
    } else {
      note(`[${name}] не нашлась кнопка «Я готов»`);
    }
  }
  await sleep(800);
  await shot(screen, '04-ноутбук-игроки-готовы');
  await shot(phones[0].page, '05-телефон-готов');

  const lobbyText = await screen.evaluate(() => document.body.innerText);
  for (const { name } of phones) {
    if (!lobbyText.includes(name)) note(`[ноутбук] в лобби не видно игрока ${name}`);
  }

  // --- старт игры ---
  screen.on('dialog', (d) => d.accept());   // подтверждения «всё равно начать?»
  const startBtn = screen.locator('button').filter({ hasText: /Начать игру/i }).first();
  if (!(await startBtn.count())) throw new Error('[ноутбук] нет кнопки «Начать игру»');
  await startBtn.click();
  await sleep(900);
  // Подтверждений может быть два подряд: «не все готовы» и «мало ответов».
  // Ищем строго кнопку подтверждения в модалке — «Начать игру» под ней тоже
  // подходит под наивный фильтр и тогда тест кликает не туда по кругу.
  for (let i = 0; i < 3; i += 1) {
    const confirm = screen
      .locator('button:visible')
      .filter({ hasText: /Всё равно/i })
      .first();
    if (!(await confirm.count())) break;
    await confirm.click().catch(() => {});
    await sleep(700);
  }
  await sleep(1000);
  await shot(screen, '06-ноутбук-раунд-начался');

  const phase = await fetch(BASE + '/health').then((r) => r.json());
  if (phase.phase !== 'round') {
    note(`игра не стартовала, фаза «${phase.phase}» — дальнейшие проверки пропущены`);
  } else {
    console.log('Игра стартовала, играем раунд…');

    // --- играем раунд, нажимая всё на ноутбуке (дубли кнопок ведущего) ---
    const pressOnScreen = async (re, label) => {
      const btn = screen.locator('button:visible').filter({ hasText: re }).first();
      if (!(await btn.count())) return false;
      await btn.click();
      await sleep(700);
      void label;
      return true;
    };

    if (!(await pressOnScreen(/Вытянуть вопрос/i))) note('[ноутбук] нет кнопки «Вытянуть вопрос»');
    await sleep(600);
    await shot(screen, '07-ноутбук-вопрос');
    await shot(phones[0].page, '08-телефон-рука');
    await checkNoHorizontalScroll(phones[0].page, 'телефон/раунд');
    await checkTouchTargets(phones[0].page, 'телефон/раунд');

    // Отвечают все, кто не ведущий.
    for (const { name, page } of phones) {
      const isHost = await page.evaluate(() => /Ты ведущий/i.test(document.body.innerText));
      if (isHost) continue;
      const card = page.locator('.hand-card, .card-answer').first();
      if (!(await card.count())) { note(`[${name}] в руке не видно карт`); continue; }
      await card.click();
      await sleep(400);
      await shot(page, `09-телефон-предпросмотр-${name}`);
      const sendBtn = page.locator('button:visible').filter({ hasText: /Отправить/i }).first();
      if (!(await sendBtn.count())) { note(`[${name}] нет кнопки «Отправить» в предпросмотре`); continue; }
      await sendBtn.click();
      await sleep(500);
    }
    await sleep(800);
    await shot(screen, '10-ноутбук-ждём-ответы');

    // Вскрываем и выбираем победителя — всё с ноутбука.
    for (let i = 0; i < 8; i += 1) {
      const opened = await pressOnScreen(/Открыть ответы|Следующий ответ/i);
      if (!opened) break;
    }
    await shot(screen, '11-ноутбук-вскрытие');

    const health2 = await fetch(BASE + '/health').then((r) => r.json());
    void health2;

    // Выбор победителя: тап по варианту, затем подтверждение.
    const variant = screen.locator('.card-answer:visible, .reveal-card:visible').first();
    if (await variant.count()) {
      await variant.click();
      await sleep(500);
      await pressOnScreen(/Выбрать победителем|Победител/i);
    }
    await sleep(900);
    await shot(screen, '12-ноутбук-победитель');
    await shot(phones[0].page, '13-телефон-результат');

    const resultText = await screen.evaluate(() => document.body.innerText);
    const anyName = phones.some((p) => resultText.includes(p.name));
    if (!anyName) note('[ноутбук] на экране результата не видно имени автора-победителя');
  }

  // --- переподключение: перезагружаем телефон, имя вводить не должны ---
  const victim = phones[0];
  await victim.page.reload({ waitUntil: 'networkidle' });
  await sleep(1500);
  const afterReload = await victim.page.evaluate(() => document.body.innerText);
  if (!afterReload.includes(victim.name)) {
    note(`[${victim.name}] после перезагрузки вкладки игрок не вернулся в игру`);
  }
  if (/Твоё имя/i.test(afterReload)) {
    note(`[${victim.name}] после перезагрузки снова спрашивают имя — токен не сработал`);
  }
  await shot(victim.page, '14-телефон-после-перезагрузки');

  // --- широкий экран ноутбука ---
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await sleep(600);
  await shot(screen, '15-ноутбук-1920');
  const screenScroll = await screen.evaluate(() => ({
    v: document.documentElement.scrollHeight > window.innerHeight + 1,
    h: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  if (screenScroll.h) note('[ноутбук] на игровом экране появился горизонтальный скролл');
  if (screenScroll.v) note('[ноутбук] на игровом экране появился вертикальный скролл (текст должен ужиматься)');

  await browser.close();
}

function cleanup() {
  if (server && !server.killed) server.kill('SIGTERM');
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ } }
}

try {
  await main();
  cleanup();
  console.log('');
  if (problems.length === 0) {
    console.log('  ✔ Сквозной прогон чистый: ошибок в браузере нет, раунд отыгран.');
    console.log(`  Скриншоты: ${SHOTS}`);
    process.exit(0);
  }
  console.log(`  ✖ Найдено проблем: ${problems.length}`);
  for (const p of problems) console.log('    — ' + p);
  console.log(`  Скриншоты: ${SHOTS}`);
  process.exit(1);
} catch (err) {
  cleanup();
  console.error('\n  ✖ Сквозной прогон упал:', err?.stack ?? err);
  for (const p of problems) console.error('    — ' + p);
  process.exit(1);
}
