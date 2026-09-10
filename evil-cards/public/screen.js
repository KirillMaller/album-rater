/**
 * Экран ноутбука «Злобных карт» — общий экран для всей компании.
 *
 * Правила этого файла:
 *  - сервер единственный источник правды: тут только отрисовка снимка и отправка действий;
 *  - ни одного внешнего запроса (игра идёт в локальной Wi-Fi без интернета);
 *  - стили живут в screen.css, JS ставит только классы, атрибуты и текст.
 *    Единственное исключение — вычисленный размер шрифта в автоподгонке карт;
 *  - localStorage не используется вообще: после перезагрузки ноутбук берёт всё с сервера.
 */

import { fillPrompt } from '/shared/text.js';

/* global io */

// ---------------------------------------------------------------- состояние

/** Последний снимок с сервера. Ничего кроме него мы не помним. */
let snap = null;
/** Картинка QR: { dataUrl, url }. Приходит готовой с сервера. */
let qr = null;
let connected = false;
/** Ключи действий, по которым ждём ответ сервера — защита от двойного клика. */
const pending = new Set();
/** Ключ содержимого центральной сцены: пока не поменялся — не перерисовываем. */
let stageKey = '';
let adminOpen = false;
let confirmResolve = null;
/** Когда открылся вопрос — чтобы второй клик двойного тапа его не захлопнул. */
let confirmOpenedAt = 0;
let fitScheduled = false;

const socket = io();

// ------------------------------------------------------------------- утилиты

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Русские окончания: plural(n, ['раунд', 'раунда', 'раундов']). */
function plural(n, forms) {
  const abs = Math.abs(Math.round(n));
  const tail100 = abs % 100;
  const tail10 = abs % 10;
  if (tail100 > 10 && tail100 < 20) return forms[2];
  if (tail10 === 1) return forms[0];
  if (tail10 > 1 && tail10 < 5) return forms[1];
  return forms[2];
}

/** «1 ч 30 мин» — сокращения, чтобы фраза не спотыкалась о падежи. */
function humanMinutes(minutes) {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/** Подставленный ответ внутри захода: часть 'answer' — в <span class="filled">. */
function renderParts(target, parts, mode) {
  target.textContent = '';
  target.dataset.mode = mode || 'inline';
  for (const part of parts || []) {
    if (part && part.type === 'answer') {
      target.appendChild(el('span', 'filled', part.value));
    } else if (part) {
      target.appendChild(document.createTextNode(part.value));
    }
  }
}

/** Коробка с автоподгоняемым текстом: снаружи .fit, внутри .fit-inner. */
function fitBox(className) {
  const box = el('div', `${className} fit`);
  const inner = el('div', 'fit-inner');
  box.appendChild(inner);
  return { box, inner };
}

/** Невидимый пробник: им спрашиваем у браузера, во что разворачивается переменная. */
let probeNode = null;
function probe() {
  if (!probeNode) {
    probeNode = el('span', 'fit-probe');
    probeNode.setAttribute('aria-hidden', 'true');
  }
  return probeNode;
}

/**
 * Число в пикселях из CSS-переменной коробки.
 *
 * Переменная может прийти не только как «26px», но и как calc(...) или ещё
 * одна var(...) — parseFloat такое не разбирает и молча отдаёт NaN. Раньше в
 * этом случае бралось запасное число, из-за чего --fit-min совпадал с
 * --fit-max, и карточки ответов не ужимались вообще: текст обрезался.
 * Поэтому если разобрать не вышло — подставляем переменную в font-size
 * пробника и читаем уже вычисленный размер. Дизайн придёт позже, и в
 * theme.css легко может появиться calc — подгонка не должна от этого падать.
 */
function cssPx(box, styles, name, fallback) {
  const direct = parseFloat(styles.getPropertyValue(name));
  if (Number.isFinite(direct) && direct > 0) return direct;

  const node = probe();
  node.style.fontSize = `var(${name})`;
  box.appendChild(node);
  const resolved = parseFloat(getComputedStyle(node).fontSize);
  node.remove();
  return Number.isFinite(resolved) && resolved > 0 ? resolved : fallback;
}

/**
 * Автоподгонка размера карты: уменьшаем шрифт шагами от --fit-max до --fit-min,
 * пока текст не перестанет вылезать за коробку. Скролла на экране быть не должно.
 * Границы и шаг приходят из CSS — числа в JS не зашиты.
 */
function fitOne(box) {
  const inner = box.querySelector('.fit-inner');
  if (!inner) return;
  const boxStyles = getComputedStyle(box);
  const max = cssPx(box, boxStyles, '--fit-max', 64);
  const min = Math.min(cssPx(box, boxStyles, '--fit-min', 26), max);
  const step = Math.max(1, cssPx(box, boxStyles, '--fit-step', 4));

  box.style.fontSize = `${max}px`;
  if (box.clientHeight <= 0 || box.clientWidth <= 0) return; // коробка ещё не разложена

  const padY = parseFloat(boxStyles.paddingTop) + parseFloat(boxStyles.paddingBottom);
  const padX = parseFloat(boxStyles.paddingLeft) + parseFloat(boxStyles.paddingRight);
  const availH = box.clientHeight - padY;
  const availW = box.clientWidth - padX;

  const fits = () => inner.scrollHeight <= availH + 1 && inner.scrollWidth <= availW + 1;

  let size = max;
  while (size > min) {
    if (fits()) break;
    size = Math.max(min, size - step);
    box.style.fontSize = `${size}px`;
  }

  // Шаг подгонки грубый (обычно 4 px), из-за него текст мог остаться заметно
  // мельче, чем помещается. Добираем размер вверх по пикселю — на общем экране
  // каждый пиксель кегля виден с трёх метров.
  while (size < max && fits()) {
    box.style.fontSize = `${size + 1}px`;
    if (!fits()) { box.style.fontSize = `${size}px`; break; }
    size += 1;
  }
}

function fitAll() {
  fitScheduled = false;
  for (const box of document.querySelectorAll('.fit')) fitOne(box);
}

function scheduleFit() {
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(fitAll);
}

// ------------------------------------------------------------------ действия

/** Разрешено ли действие прямо сейчас (по флагам снимка). */
function allowed(act) {
  if (!snap) return false;
  const can = snap.can || {};
  switch (act) {
    case 'start': return Boolean(can.start);
    case 'draw': return Boolean(can.draw);
    case 'redraw': return Boolean(can.redraw);
    case 'skipWaiting': return Boolean(can.skipWaiting);
    case 'reveal': return Boolean(can.reveal);
    case 'next': return Boolean(can.next);
    case 'pick': return Boolean(can.pick);
    case 'target': return can.settings !== false && snap.phase === 'lobby';
    case 'passHost': return snap.phase === 'round';
    default: return true; // остальное — организаторское, оно всегда на ноутбуке
  }
}

/**
 * Отправка действия с защитой от двойного клика: кнопка гаснет до ответа
 * сервера или на 400 мс — что случится раньше. Свежий снимок снимает все замки.
 */
function emitGuarded(event, payload, key) {
  if (!connected || pending.has(key)) return;
  pending.add(key);
  refreshControls();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pending.delete(key);
    refreshControls();
  };
  socket.emit(event, payload, release);
  setTimeout(release, 400);
}

/** Действие ведущего: всегда с номером раунда — устаревшие нажатия сервер отбросит. */
function hostEmit(event, key, extra) {
  if (!snap || !snap.round) return;
  emitGuarded(event, { round: snap.round.number, ...(extra || {}) }, key);
}

/** «Начать игру». Два подтверждения независимы и задаются по очереди. */
function startGame(opts) {
  const options = opts || {};
  if (!connected || pending.has('start')) return;
  pending.add('start');
  refreshControls();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pending.delete('start');
    refreshControls();
  };
  socket.emit('admin:start', options, async (res) => {
    release();
    if (!res || res.ok) return;

    if (res.needConfirm === 'notReady') {
      const go = await askConfirm({
        title: 'Не все нажали «Я готов»',
        text: res.error,
        confirmLabel: 'Всё равно начать',
      });
      if (go) startGame({ ...options, confirmNotReady: true });
      return;
    }
    if (res.needConfirm === 'fewAnswers') {
      const go = await askConfirm({
        title: 'Мало карт-ответов',
        text: res.error,
        confirmLabel: 'Всё равно начать',
      });
      if (go) startGame({ ...options, confirmFewAnswers: true });
    }
  });
  setTimeout(release, 4000);
}

async function pickWinner(submissionId, answerText) {
  if (!snap || !snap.round) return;
  const round = snap.round.number;
  const go = await askConfirm({
    title: 'Выбрать победителем?',
    text: answerText ? `«${answerText}»` : 'Этот вариант получит очко.',
    confirmLabel: 'Выбрать победителем',
  });
  if (!go) return;
  emitGuarded('host:pick', { round, submissionId }, 'pick');
}

async function kickPlayer(playerId, name) {
  const go = await askConfirm({
    title: 'Удалить игрока?',
    text: `${name} вылетит из игры. Его карты останутся в колоде, рука уйдёт в сброс.`,
    confirmLabel: 'Удалить',
    danger: true,
  });
  if (go) emitGuarded('admin:kick', { playerId }, `kick:${playerId}`);
}

async function newGame(key) {
  const go = await askConfirm({
    title: 'Новая игра?',
    text: 'Игроки и карты останутся, очки обнулятся, колоды перетасуются заново.',
    confirmLabel: 'Начать заново',
    danger: true,
  });
  if (go) emitGuarded('admin:newGame', {}, key || 'newGame');
}

async function fullReset() {
  const first = await askConfirm({
    title: 'Полный сброс?',
    text: 'Удалит всё: игроков, их карты, очки и историю вечера. Отменить будет нельзя.',
    confirmLabel: 'Да, сбросить всё',
    danger: true,
  });
  if (!first) return;
  const second = await askConfirm({
    title: 'Точно сбросить всё?',
    text: 'Последняя проверка. Гостям придётся заново заходить по QR и писать карты.',
    confirmLabel: 'Стереть и начать с нуля',
    danger: true,
  });
  if (second) emitGuarded('admin:reset', {}, 'reset');
}

async function saveBase() {
  const promptsText = $('base-prompts').value;
  const answersText = $('base-answers').value;
  const promptLines = countLines(promptsText);
  const answerLines = countLines(answersText);

  if (promptLines === 0 && answerLines === 0) {
    showToast('Оба поля пустые — нечего сохранять', 'error');
    return;
  }
  const wipes = [];
  if (promptLines === 0) wipes.push('вопросов');
  if (answerLines === 0) wipes.push('ответов');
  const warn = wipes.length
    ? ` Пустое поле сотрёт базу ${wipes.join(' и ')}.`
    : '';

  const go = await askConfirm({
    title: 'Перезаписать базу?',
    text: `Файлы базы будут перезаписаны: ${promptLines} ${plural(promptLines, ['вопрос', 'вопроса', 'вопросов'])}, `
      + `${answerLines} ${plural(answerLines, ['ответ', 'ответа', 'ответов'])}.${warn}`,
    confirmLabel: 'Перезаписать',
    danger: true,
  });
  if (!go) return;
  emitGuarded('admin:saveBase', { prompts: promptsText, answers: answersText }, 'saveBase');
  $('base-hint').textContent = 'Отправлено. База подхватится при старте игры.';
}

function countLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#')).length;
}

async function passHost() {
  const go = await askConfirm({
    title: 'Передать ход следующему?',
    text: 'Раунд начнётся заново с новым ведущим. Пригодится, если у ведущего сел телефон.',
    confirmLabel: 'Передать',
  });
  if (go) emitGuarded('admin:passHost', {}, 'passHost');
}

function addBots() {
  const input = $('bots-count');
  const count = Math.min(6, Math.max(1, Math.round(Number(input.value) || 1)));
  input.value = String(count);
  emitGuarded('admin:addBots', { count }, 'addBots');
}

async function removeBots() {
  const go = await askConfirm({
    title: 'Убрать ботов?',
    text: 'Все боты выйдут из игры. Живых игроков это не тронет.',
    confirmLabel: 'Убрать',
  });
  if (go) emitGuarded('admin:removeBots', {}, 'removeBots');
}

function handleAction(act, btn) {
  if (!snap || !allowed(act)) return;
  switch (act) {
    case 'start': startGame({}); break;
    case 'draw': hostEmit('host:draw', 'draw'); break;
    case 'redraw': hostEmit('host:redraw', 'redraw'); break;
    case 'skipWaiting': hostEmit('host:skipWaiting', 'skipWaiting'); break;
    // index — сколько ответов уже вскрыто: повтор и устаревший индекс сервер игнорирует.
    case 'reveal': hostEmit('host:reveal', 'reveal', { index: snap.round ? snap.round.revealedCount : 0 }); break;
    case 'next': hostEmit('host:next', 'next'); break;
    case 'pick': pickWinner(btn.dataset.sub, btn.dataset.answer); break;
    case 'target': emitGuarded('admin:settings', { targetScore: Number(btn.dataset.value) }, btn.dataset.key); break;
    case 'kick': kickPlayer(btn.dataset.playerId, btn.dataset.playerName); break;
    case 'passHost': passHost(); break;
    case 'addBots': addBots(); break;
    case 'removeBots': removeBots(); break;
    case 'saveBase': saveBase(); break;
    case 'setIp': emitGuarded('admin:setIp', { url: btn.dataset.url }, 'setIp'); break;
    case 'newGame': newGame(btn.dataset.key); break;
    case 'reset': fullReset(); break;
    default: break;
  }
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  handleAction(btn.dataset.act, btn);
});

/** Единое место, где кнопки гаснут: нет связи, ждём сервер или действие сейчас нельзя. */
function refreshControls() {
  for (const node of document.querySelectorAll('[data-act]')) {
    const act = node.dataset.act;
    const key = node.dataset.key || act;
    node.disabled = !connected || pending.has(key) || !allowed(act);
  }
}

// ------------------------------------------------------------------ отрисовка

function render() {
  if (!snap) return;
  const phase = snap.phase;
  document.body.dataset.phase = phase;

  $('view-lobby').hidden = phase !== 'lobby';
  $('view-round').hidden = phase !== 'round' || !snap.round;
  $('view-gameover').hidden = phase !== 'gameOver';

  const phaseLabels = { lobby: 'Лобби', round: 'Игра идёт', gameOver: 'Итоги' };
  $('topbar-phase').textContent = phaseLabels[phase] || '';

  applyQr();
  if (phase !== 'round') stageKey = '';
  if (phase === 'lobby') renderLobby();
  else if (phase === 'round' && snap.round) renderRound();
  else if (phase === 'gameOver') renderGameOver();

  if (adminOpen) renderAdmin();
  refreshControls();
  scheduleFit();
}

// --- QR ---------------------------------------------------------------------

function currentUrl() {
  if (qr && qr.url) return qr.url;
  const net = (snap && snap.network) || {};
  return net.selectedUrl || net.publicUrl || '';
}

function applyQr() {
  const url = currentUrl();
  $('lobby-url').textContent = url || '—';
  $('topbar-url').textContent = url;
  $('qr-corner-url').textContent = url;

  const big = $('qr-image');
  const corner = $('qr-corner-image');
  if (qr && qr.dataUrl) {
    if (big.getAttribute('src') !== qr.dataUrl) {
      big.src = qr.dataUrl;
      corner.src = qr.dataUrl;
    }
    big.hidden = false;
    corner.hidden = false;
    $('qr-wait').hidden = true;
  } else {
    big.hidden = true;
    corner.hidden = true;
    $('qr-wait').hidden = false;
  }
}

// --- Лобби ------------------------------------------------------------------

function renderLobby() {
  const players = snap.players || [];
  $('players-count').textContent = String(players.length);

  const list = $('player-list');
  list.textContent = '';
  list.dataset.dense = players.length > 7 ? '1' : '0';

  for (const p of players) {
    const row = el('li', 'player-row');
    if (!p.connected) row.classList.add('player-row--offline');
    if (p.ready) row.classList.add('player-row--ready');

    const name = el('span', 'player-name', p.name);
    name.title = p.name;
    row.appendChild(name);

    const cards = el('span', 'player-cards',
      `${p.promptCount} ${plural(p.promptCount, ['вопрос', 'вопроса', 'вопросов'])}`
      + ` · ${p.answerCount} ${plural(p.answerCount, ['ответ', 'ответа', 'ответов'])}`);
    row.appendChild(cards);

    const marks = el('span', 'player-marks');
    if (p.isBot) marks.appendChild(el('span', 'badge badge--bot', 'бот'));
    if (!p.connected) marks.appendChild(el('span', 'badge badge--offline', 'не в сети'));
    marks.appendChild(el('span', `badge ${p.ready ? 'badge--ok' : 'badge--wait'}`, p.ready ? 'готов' : 'пишет карты'));
    row.appendChild(marks);

    list.appendChild(row);
  }

  if (players.length === 0) {
    $('players-hint').textContent = 'Пока никого. Пусть гости отсканируют QR-код.';
  } else {
    const notReady = players.filter((p) => !p.ready).length;
    $('players-hint').textContent = notReady
      ? `Ещё пишут карты: ${notReady}. Рекомендуем 3 вопроса и 5 ответов с человека.`
      : 'Все готовы.';
  }

  const base = snap.base || { prompts: 0, answers: 0 };
  $('base-counts').textContent =
    `Готовых карт: ${base.prompts} ${plural(base.prompts, ['вопрос', 'вопроса', 'вопросов'])}, `
    + `${base.answers} ${plural(base.answers, ['ответ', 'ответа', 'ответов'])}`;

  const settings = snap.settings || {};
  const target = Number(settings.targetScore) || 10;
  for (const btn of document.querySelectorAll('[data-act="target"]')) {
    const active = Number(btn.dataset.value) === target;
    btn.classList.toggle('seg-btn--active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  syncNumberInput($('hand-size'), settings.handSize);
  syncNumberInput($('admin-hand-size'), settings.handSize);
  syncNumberInput($('ask-prompts'), settings.askPrompts);
  syncNumberInput($('admin-ask-prompts'), settings.askPrompts);
  syncNumberInput($('ask-answers'), settings.askAnswers);
  syncNumberInput($('admin-ask-answers'), settings.askAnswers);

  $('duration-hint').textContent = durationHint(target, (snap.players || []).length);

  const warnings = $('lobby-warnings');
  warnings.textContent = '';
  for (const text of snap.warnings || []) warnings.appendChild(el('li', 'warning', text));
  warnings.hidden = (snap.warnings || []).length === 0;

  $('start-hint').textContent = startHint();
}

function durationHint(target, playersCount) {
  if (playersCount < 1) {
    return 'Сколько продлится игра — посчитаем, когда подключатся игроки.';
  }
  // ТЗ 2.1.5: раундов ≈ 0,65 × цель × число игроков, около 2 минут на раунд.
  const rounds = Math.max(1, Math.floor(0.65 * target * playersCount));
  const minutes = rounds * 2;
  let text = `${target} ${plural(target, ['очко', 'очка', 'очков'])}`
    + ` на ${playersCount} ${plural(playersCount, ['игрока', 'игрока', 'игроков'])}`
    + ` — это ~${rounds} ${plural(rounds, ['раунд', 'раунда', 'раундов'])}, около ${humanMinutes(minutes)} и больше.`;
  if (minutes >= 90) text += ' С целью 5 или 7 вечер выйдет короче.';
  return text;
}

function startHint() {
  const players = (snap.players || []).length;
  if (players < 3) {
    return `Нужно хотя бы 3 игрока, сейчас ${players}. Можно добавить ботов в панели организатора.`;
  }
  if (!snap.can || !snap.can.start) return 'Начать игру сейчас нельзя.';
  return 'База карт читается в момент старта — можно править её до последнего.';
}

/** Правим поле, только если в нём сейчас не печатают. */
function syncNumberInput(input, value) {
  if (!input || document.activeElement === input) return;
  const next = String(value ?? '');
  if (input.value !== next) input.value = next;
}

// --- Игра -------------------------------------------------------------------

const STEP_LABELS = {
  draw: 'Вопрос',
  answering: 'Ответы',
  revealing: 'Вскрытие',
  judging: 'Выбор',
  result: 'Результат',
};

function computeStageKey(round) {
  const parts = [round.number, round.step, round.hostId];
  if (round.prompt) parts.push(round.prompt.id);
  if (round.step === 'revealing') parts.push(round.revealedCount);
  if (round.step === 'judging') parts.push(round.reveals.length);
  if (round.step === 'result') parts.push(round.winner ? round.winner.submissionId : '-', round.reveals.length);
  return parts.join('|');
}

function renderRound() {
  const round = snap.round;

  $('round-badge').textContent = `Раунд ${round.number}`;
  $('stage-host').textContent = `Ведущий: ${round.hostName}`;
  $('step-badge').textContent = STEP_LABELS[round.step] || '';

  const key = computeStageKey(round);
  if (key !== stageKey) {
    stageKey = key;
    renderStageBody(round);
  }

  $('stage-counter').textContent = stageCounter(round);
  renderReadingLine(round);
  $('stage-hint').textContent = stageHint(round);

  const labels = { reveal: round.step === 'answering' ? 'Открыть ответы' : 'Следующий ответ' };
  for (const btn of $('stage-actions').children) {
    const act = btn.dataset.act;
    btn.hidden = !allowed(act);
    if (labels[act]) btn.textContent = labels[act];
  }

  renderScoreboard(round);
}

function renderStageBody(round) {
  const body = $('stage-body');
  body.textContent = '';
  body.className = `stage-body stage-body--${round.step}`;
  const promptText = round.prompt ? round.prompt.text : '';

  if (round.step === 'draw') {
    const wrap = el('div', 'stage-draw');
    wrap.appendChild(el('p', 'stage-draw-label', 'Ведущий'));
    const host = fitBox('stage-draw-host');
    host.inner.textContent = round.hostName;
    wrap.appendChild(host.box);
    body.appendChild(wrap);
    return;
  }

  if (round.step === 'answering') {
    const card = fitBox('card-prompt');
    card.inner.textContent = promptText;
    body.appendChild(card.box);
    return;
  }

  if (round.step === 'revealing') {
    const shown = round.reveals[round.revealedCount - 1];
    const card = fitBox('card-prompt');
    if (shown) renderParts(card.inner, shown.parts, shown.mode);
    else card.inner.textContent = promptText;
    body.appendChild(card.box);
    return;
  }

  if (round.step === 'judging') {
    const strip = fitBox('prompt-strip');
    strip.inner.textContent = promptText;
    body.appendChild(strip.box);
    body.appendChild(buildAnswerGrid(round.reveals, { pickable: true }));
    return;
  }

  if (round.step === 'result') {
    const winner = round.winner;
    const card = fitBox('card-prompt card-prompt--winner');
    if (winner) renderParts(card.inner, winner.parts, winner.mode);
    else card.inner.textContent = promptText;
    body.appendChild(card.box);
    body.appendChild(el('p', 'winner-author', winner ? `Написал(а): ${winner.authorName}` : ''));
    body.appendChild(buildAnswerGrid(round.reveals, {
      showAuthors: true,
      winnerId: winner ? winner.submissionId : null,
    }));
  }
}

/** Сетка вариантов. Все влезают без скролла: карточки ужимаются, а не прячутся. */
function buildAnswerGrid(reveals, opts) {
  const options = opts || {};
  const list = el('ul', 'judge-grid');
  list.dataset.count = String(reveals.length);

  reveals.forEach((rev, index) => {
    const item = el('li', 'judge-item');
    const card = document.createElement(options.pickable ? 'button' : 'div');
    card.className = 'card-answer fit';
    if (options.winnerId && rev.id === options.winnerId) card.classList.add('card-answer--picked');
    if (options.pickable) {
      card.type = 'button';
      card.dataset.act = 'pick';
      card.dataset.sub = rev.id;
      card.dataset.answer = rev.answerText;
      card.setAttribute('aria-label', `Выбрать победителем: ${rev.answerText}`);
    }
    card.appendChild(el('span', 'card-answer__num', index + 1));
    card.appendChild(el('div', 'fit-inner', rev.answerText));
    item.appendChild(card);
    if (options.showAuthors) {
      item.appendChild(el('p', 'card-answer__author', rev.authorName || '—'));
    }
    list.appendChild(item);
  });

  return list;
}

/**
 * «Прочитали 3 из 5» — видно всей комнате, кого ещё ждём.
 * Экран переключается, когда прочли все, либо когда ведущий нажмёт сам.
 */
function renderReadingLine(round) {
  const el = $('reading-line');
  if (!el) return;
  const reading = round?.reading;
  if (!reading?.active) { el.hidden = true; return; }
  const left = Array.isArray(reading.waitingFor) ? reading.waitingFor : [];
  el.hidden = false;
  if (left.length === 0) {
    el.textContent = 'Прочитали все';
    return;
  }
  const who = left.length <= 3 ? ` — ждём: ${left.join(', ')}` : '';
  el.textContent = `Прочитали ${reading.acked} из ${reading.needed}${who}`;
}

function stageCounter(round) {
  if (round.step === 'answering') {
    return `Ответили ${round.answered} из ${round.expected}`;
  }
  if (round.step === 'revealing') {
    return `Ответ ${round.revealedCount} из ${round.total}`;
  }
  if (round.step === 'judging') {
    return `${round.total} ${plural(round.total, ['вариант', 'варианта', 'вариантов'])} на столе`;
  }
  if (round.step === 'result' && round.winner) {
    return `+1 очко: ${round.winner.authorName}`;
  }
  return '';
}

function stageHint(round) {
  switch (round.step) {
    case 'draw':
      return 'Ведущий тянет вопрос — на своём телефоне или здесь.';
    case 'answering':
      return round.expected > round.answered
        ? 'Все, кроме ведущего, выбирают карту на телефоне.'
        : 'Все ответили — можно открывать.';
    case 'revealing':
      return 'Ведущий читает вслух и жмёт «Следующий ответ».';
    case 'judging':
      return 'Нажми на вариант, чтобы выбрать его победителем.';
    case 'result':
      return 'Победитель получил очко, руки добраны. Дальше — «Следующий раунд».';
    default:
      return '';
  }
}

function renderScoreboard(round) {
  const board = $('scoreboard');
  board.textContent = '';
  const players = [...(snap.players || [])].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru')
  );
  board.dataset.dense = players.length > 7 ? '1' : '0';

  for (const p of players) {
    const row = el('li', 'scoreboard-row');
    if (p.isHost) row.classList.add('scoreboard-row--host');
    if (!p.connected) row.classList.add('scoreboard-row--offline');

    const name = el('span', 'scoreboard-name', p.name);
    name.title = p.name;
    row.appendChild(name);

    const marks = el('span', 'scoreboard-marks');
    if (p.isHost) marks.appendChild(el('span', 'badge badge--host', 'ведёт'));
    if (!p.connected) marks.appendChild(el('span', 'badge badge--offline', 'не в сети'));
    if (round.step === 'answering' && !p.isHost) {
      marks.appendChild(el(
        'span',
        `badge ${p.hasSubmitted ? 'badge--ok' : 'badge--wait'}`,
        p.hasSubmitted ? 'готов' : 'думает'
      ));
    }
    row.appendChild(marks);

    row.appendChild(el('span', 'scoreboard-score', p.score));
    board.appendChild(row);
  }
}

// --- Конец игры -------------------------------------------------------------

const HISTORY_LIMIT = 8;

function renderGameOver() {
  const over = snap.gameOver || { winnerName: '—', standings: [] };
  $('gameover-winner').textContent = over.winnerName;

  const list = $('standings');
  list.textContent = '';
  over.standings.forEach((row, index) => {
    const item = el('li', 'standings-row');
    if (index === 0) item.classList.add('standings-row--first');
    item.appendChild(el('span', 'standings-place', index + 1));
    const name = el('span', 'standings-name', row.name);
    name.title = row.name;
    item.appendChild(name);
    if (row.isBot) item.appendChild(el('span', 'badge badge--bot', 'бот'));
    item.appendChild(el('span', 'standings-score', row.score));
    list.appendChild(item);
  });

  const history = snap.history || [];
  const feed = $('history');
  feed.textContent = '';
  const shown = history.slice(-HISTORY_LIMIT).reverse();
  for (const entry of shown) {
    const item = el('li', 'history-item');
    item.appendChild(el('span', 'history-round', `#${entry.round}`));
    const text = el('p', 'history-text');
    // parts из снимка — источник правды, режим (inline/below) считаем сами:
    // в истории его нет, а от него зависит, идёт ответ строкой ниже или внутрь.
    const filled = fillPrompt(entry.promptText || '', entry.answerText || '');
    const parts = entry.parts && entry.parts.length ? entry.parts : filled.parts;
    renderParts(text, parts, filled.mode);
    item.appendChild(text);
    item.appendChild(el('p', 'history-winner', entry.winnerName));
    feed.appendChild(item);
  }

  if (history.length === 0) {
    $('history-hint').textContent = 'Победных комбинаций пока нет.';
  } else {
    const total = `Всего ${history.length} ${plural(history.length, ['раунд', 'раунда', 'раундов'])} за вечер.`;
    $('history-hint').textContent = history.length > HISTORY_LIMIT
      ? `${total} Показаны ${HISTORY_LIMIT} последних.`
      : total;
  }
}

// --- Панель организатора ----------------------------------------------------

function renderAdmin() {
  const players = snap.players || [];
  const list = $('admin-players');
  list.textContent = '';

  if (players.length === 0) {
    list.appendChild(el('li', 'hint', 'Игроков пока нет.'));
  }
  for (const p of players) {
    const row = el('li', 'admin-player');
    const name = el('span', 'admin-player-name', p.name);
    name.title = p.name;
    row.appendChild(name);

    const marks = el('span', 'admin-player-marks');
    if (p.isHost) marks.appendChild(el('span', 'badge badge--host', 'ведёт'));
    if (p.isBot) marks.appendChild(el('span', 'badge badge--bot', 'бот'));
    if (!p.connected) marks.appendChild(el('span', 'badge badge--offline', 'не в сети'));
    marks.appendChild(el('span', 'badge', `${p.score} ${plural(p.score, ['очко', 'очка', 'очков'])}`));
    row.appendChild(marks);

    const kick = el('button', 'btn btn--danger btn--small', 'Удалить');
    kick.type = 'button';
    kick.dataset.act = 'kick';
    kick.dataset.key = `kick:${p.id}`;
    kick.dataset.playerId = p.id;
    kick.dataset.playerName = p.name;
    row.appendChild(kick);

    list.appendChild(row);
  }

  const net = snap.network || { urls: [], selectedUrl: '' };
  const urls = net.urls && net.urls.length ? net.urls : [net.selectedUrl || net.publicUrl].filter(Boolean);
  const urlList = $('url-list');
  urlList.textContent = '';
  if (urls.length === 0) {
    urlList.appendChild(el('li', 'hint', 'Сервер не нашёл ни одного адреса.'));
  }
  for (const url of urls) {
    const item = el('li', 'url-item');
    const btn = el('button', 'btn btn--ghost url-btn', url);
    btn.type = 'button';
    btn.dataset.act = 'setIp';
    btn.dataset.key = `setIp:${url}`;
    btn.dataset.url = url;
    if (url === currentUrl() || url === net.selectedUrl) {
      btn.classList.add('url-btn--active');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.setAttribute('aria-pressed', 'false');
    }
    item.appendChild(btn);
    urlList.appendChild(item);
  }

  $('admin-settings-hint').textContent = snap.phase === 'lobby'
    ? 'Настройки применяются сразу.'
    : 'Настройки меняются только до старта игры.';

  const settings = snap.settings || {};
  syncNumberInput($('admin-hand-size'), settings.handSize);
  syncNumberInput($('admin-ask-prompts'), settings.askPrompts);
  syncNumberInput($('admin-ask-answers'), settings.askAnswers);
  for (const btn of document.querySelectorAll('#admin-target-buttons [data-act="target"]')) {
    const active = Number(btn.dataset.value) === Number(settings.targetScore);
    btn.classList.toggle('seg-btn--active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function setAdminOpen(open) {
  adminOpen = open;
  $('admin-overlay').hidden = !open;
  document.body.dataset.admin = open ? 'open' : 'closed';
  if (open) {
    renderAdmin();
    refreshControls();
    $('btn-admin-close').focus();
  } else {
    $('btn-admin').focus();
  }
}

// --- Диалог подтверждения ---------------------------------------------------

function askConfirm(opts) {
  const options = opts || {};
  // Один вопрос за раз: предыдущий считаем отменённым.
  if (confirmResolve) closeConfirm(false);
  confirmOpenedAt = Date.now();
  $('confirm-title').textContent = options.title || 'Точно?';
  $('confirm-text').textContent = options.text || '';
  const okBtn = $('confirm-ok');
  okBtn.textContent = options.confirmLabel || 'Да';
  okBtn.classList.toggle('btn--danger', Boolean(options.danger));
  okBtn.classList.toggle('btn--primary', !options.danger);
  $('confirm-overlay').hidden = false;
  // На опасном вопросе фокус стоит на «Отмене» — случайный Enter ничего не сломает.
  (options.danger ? $('confirm-cancel') : okBtn).focus();

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function closeConfirm(result) {
  $('confirm-overlay').hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(result);
}

// --- Тосты ------------------------------------------------------------------

function showToast(message, kind) {
  const box = $('toasts');
  const item = el('div', `toast ${kind === 'error' ? 'toast--error' : 'toast--info'}`, message);
  box.appendChild(item);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => item.remove(), 6000);
}

// --- Полный экран и сон экрана ----------------------------------------------

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    showToast('Браузер не дал включить полный экран — попробуй клавишу F11', 'error');
  }
}

let wakeLock = null;
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null; // по http его обычно нет — это нормально
  }
}

// ------------------------------------------------------------------- события

socket.on('connect', () => {
  connected = true;
  $('offline-banner').hidden = true;
  document.body.dataset.connected = 'yes';
  socket.emit('hello', { role: 'screen' });
  refreshControls();
});

socket.on('disconnect', () => {
  connected = false;
  $('offline-banner').hidden = false;
  document.body.dataset.connected = 'no';
  refreshControls();
});

socket.on('state', (payload) => {
  snap = payload;
  // Пришёл свежий снимок — все замки от двойного клика снимаем.
  pending.clear();
  render();
});

socket.on('qr', (payload) => {
  qr = payload;
  applyQr();
});

socket.on('toast', (payload) => {
  if (payload && payload.message) showToast(payload.message, payload.kind);
});

$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('btn-fullscreen-lobby').addEventListener('click', toggleFullscreen);
$('btn-admin').addEventListener('click', () => setAdminOpen(true));
$('btn-admin-close').addEventListener('click', () => setAdminOpen(false));
$('confirm-ok').addEventListener('click', () => closeConfirm(true));
$('confirm-cancel').addEventListener('click', () => closeConfirm(false));

// Клик по фону закрывает: и панель, и вопрос.
$('admin-overlay').addEventListener('click', (event) => {
  if (event.target === $('admin-overlay')) setAdminOpen(false);
});
$('confirm-overlay').addEventListener('click', (event) => {
  if (event.target !== $('confirm-overlay')) return;
  if (Date.now() - confirmOpenedAt < 350) return;
  closeConfirm(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (confirmResolve) closeConfirm(false);
  else if (adminOpen) setAdminOpen(false);
});

// Сколько карт просим написать гостя. Ноль — «пишите сколько хотите».
for (const [ids, key] of [
  [['ask-prompts', 'admin-ask-prompts'], 'askPrompts'],
  [['ask-answers', 'admin-ask-answers'], 'askAnswers'],
]) {
  for (const id of ids) {
    const input = $(id);
    if (!input) continue;
    input.addEventListener('change', () => {
      const value = Math.min(20, Math.max(0, Math.round(Number(input.value) || 0)));
      input.value = String(value);
      emitGuarded('admin:settings', { [key]: value }, key);
    });
  }
}

for (const id of ['hand-size', 'admin-hand-size']) {
  const input = $(id);
  input.addEventListener('change', () => {
    const value = Math.min(15, Math.max(3, Math.round(Number(input.value) || 10)));
    input.value = String(value);
    emitGuarded('admin:settings', { handSize: value }, 'handSize');
  });
}

window.addEventListener('resize', scheduleFit);
document.addEventListener('fullscreenchange', scheduleFit);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  keepAwake();
  if (socket.connected) socket.emit('sync', {});
  scheduleFit();
});

// Размер центральной сцены поменялся (полный экран, второй монитор) — переподогнать текст.
if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(() => scheduleFit());
  observer.observe($('stage-body'));
}

document.body.dataset.connected = 'no';
refreshControls();
keepAwake();
