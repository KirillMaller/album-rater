/**
 * play.js — экран телефона «Злобных карт».
 *
 * Правила игры живут на сервере. Здесь только три вещи:
 *   1) отправить действие,
 *   2) нарисовать присланный снимок (событие `state`),
 *   3) пережить блокировку экрана и потерю связи.
 *
 * Своего игрового состояния нет — из локального хранится только токен игрока.
 * Экраны переключаются показом/скрытием секций, DOM не пересоздаётся:
 * иначе теряется фокус и текст, который человек как раз печатает.
 */

import {
  fillPrompt,
  validatePrompt,
  validateAnswer,
  MAX_PROMPT_LEN,
  MAX_ANSWER_LEN,
  PLACEHOLDER
} from '/shared/text.js';

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'ec.token';
const PLAYER_KEY = 'ec.playerId';

/** Рекомендуемый минимум карт (ТЗ 2.1.3) — подсказка, а не запрет. */
// Сколько карт просим написать — решает организатор, число приходит с
// сервера. Своей копии здесь намеренно НЕТ: два числа в двух местах
// разъезжаются при первой же правке.

/** Счётчик символов показываем, когда осталось меньше стольких. */
const CHARS_WARN_AT = 30;

/** Сколько живёт тост. */
const TOAST_MS = 3500;

/** Тот же текст тоста в это окно не повторяем: сервер шлёт и ack, и toast. */
const TOAST_DEDUPE_MS = 1500;

/** На столько блокируется кнопка после нажатия, если снимок не пришёл раньше. */
const TAP_LOCK_MS = 400;

const SCREENS = [
  'screenBoot',
  'screenLogin',
  'screenPrep',
  'screenWaiting',
  'screenAnswer',
  'screenHost',
  'screenResult',
  'screenGameOver'
];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const els = {};
for (const id of [
  ...SCREENS,
  'offlineBanner', 'topbar', 'topbarName', 'topbarHost', 'topbarScore',
  'loginForm', 'loginName', 'loginBtn', 'claimBox', 'claimName', 'claimBtn',
  'tabPrompts', 'tabAnswers', 'panelPrompts', 'panelAnswers',
  'promptForm', 'promptInput', 'promptChars', 'gapBtn', 'promptAdd',
  'promptCount', 'promptList', 'promptEmpty',
  'answerForm', 'answerInput', 'answerChars', 'answerAdd',
  'answerCount', 'answerList', 'answerEmpty',
  'readyBtn', 'unreadyBtn', 'waitPlayers',
  'answerRoundLine', 'answerPrompt', 'answerStatus', 'answerHandBox', 'hand', 'handEmpty',
  'answerSubmitted', 'submittedCard', 'answerWaiting', 'answerBar', 'retractBtn',
  'readBar', 'readCount', 'readBtn',
  'hostRoundLine', 'hostStatus', 'hostPrompt', 'hostAnswering', 'hostAnsweredCount',
  'hostWho', 'hostRevealing', 'hostRevealCounter', 'hostRevealCard',
  'hostJudging', 'hostOptions', 'hostResult', 'hostWinnerLine', 'hostWinnerCard',
  'hostBar', 'hostSecondaryRow', 'btnRedraw', 'btnSkip', 'btnDraw', 'btnReveal', 'btnPick', 'btnNext',
  'resultRoundLine', 'resultWinnerLine', 'resultCard', 'resultScore',
  'gameOverWinner', 'gameOverStandings',
  'preview', 'previewText', 'previewBack', 'previewSend',
  'toasts'
]) {
  els[id] = document.getElementById(id);
}

// ---------------------------------------------------------------------------
// Локальное состояние клиента (игровое — только присланный снимок)
// ---------------------------------------------------------------------------

/** Последний снимок от сервера. */
let state = null;

/** Токен игрока: localStorage может быть недоступен, поэтому дублируем в памяти. */
let myToken = lsGet(TOKEN_KEY) || '';

let currentScreen = 'screenBoot';
let offline = false;

/** Какая вкладка открыта в подготовке. */
let activeTab = 'prompts';

/** Правка своей карты и подтверждение удаления — состояние интерфейса, не игры. */
let editingCardId = null;
let confirmDeleteId = null;

/** Карта, для которой открыт предпросмотр. */
let previewCardId = null;

/** Вариант, выбранный ведущим, но ещё не подтверждённый. */
let pickedSubmissionId = null;

/** Кого предлагаем «вернуть в игру» после ошибки «Имя занято». */
let claimPlayerId = null;

/** id карты -> текст. Нужен, чтобы показать отправленный ответ: из руки он уходит. */
const cardText = new Map();

// ---------------------------------------------------------------------------
// Мелкие утилиты
// ---------------------------------------------------------------------------

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null; // приватный режим — играем без запоминания
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    /* не страшно */
  }
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function setHidden(el, hidden) {
  if (el && el.hidden !== hidden) el.hidden = hidden;
}

/** Русское склонение для счётчиков: 1 символ / 2 символа / 5 символов. */
function plural(n, one, few, many) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return many;
  if (mod10 > 1 && mod10 < 5) return few;
  if (mod10 === 1) return one;
  return many;
}

function charCount(text) {
  return Array.from(String(text ?? '')).length;
}

function makeButton(className, text, ariaLabel) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  return btn;
}

/**
 * Поле вопроса растёт под текст. В двух строках длинный вопрос не виден целиком:
 * при правке человек видел середину своей карты и не понимал, что правит.
 * Потолок задан в CSS (--input-area-max), дальше поле само прокручивается.
 */
function autoGrow(field) {
  if (!field) return;
  field.style.height = 'auto';
  // scrollHeight — без рамок, а height считается по border-box: без этой добавки
  // поле выходит на пару пикселей ниже текста и первая строка уезжает вверх.
  const frame = field.offsetHeight - field.clientHeight;
  field.style.height = field.scrollHeight + frame + 'px';
  field.scrollTop = 0;
}

/** Enter в поле = «Добавить»/«Сохранить», перевод строки в карте не нужен. */
function enterSubmits(event) {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  const form = event.currentTarget.form;
  if (!form) return;
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

// ---------------------------------------------------------------------------
// Тосты
// ---------------------------------------------------------------------------

const toastSeen = new Map();

/** Проглотить один конкретный тост: мы уже ответили на него экраном. */
function muteToast(message) {
  const text = String(message ?? '').trim();
  if (text) toastSeen.set(text, Date.now());
}

function toast(message, kind) {
  const text = String(message ?? '').trim();
  if (!text) return;

  // Сервер на ошибку присылает и ack, и событие toast — показываем один раз.
  const now = Date.now();
  const seenAt = toastSeen.get(text);
  if (seenAt && now - seenAt < TOAST_DEDUPE_MS) return;
  toastSeen.set(text, now);
  if (toastSeen.size > 20) {
    for (const [key, at] of toastSeen) {
      if (now - at > TOAST_DEDUPE_MS) toastSeen.delete(key);
    }
  }

  const el = document.createElement('div');
  el.className = kind === 'error' ? 'toast toast--error' : 'toast';
  el.textContent = text;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), TOAST_MS);
}

// ---------------------------------------------------------------------------
// Защита от двойного тапа
// ---------------------------------------------------------------------------

const lockedButtons = new Set();

/** Кнопка выключается до следующего снимка, но не дольше TAP_LOCK_MS. */
function lockButton(btn) {
  if (!btn) return;
  btn.disabled = true;
  lockedButtons.add(btn);
  setTimeout(() => {
    if (lockedButtons.delete(btn)) btn.disabled = false;
  }, TAP_LOCK_MS);
}

function unlockButtons() {
  for (const btn of lockedButtons) btn.disabled = false;
  lockedButtons.clear();
}

// ---------------------------------------------------------------------------
// Сокет
// ---------------------------------------------------------------------------

if (typeof io !== 'function') {
  setText(els.screenBoot.querySelector('.status'), 'Не удалось загрузить игру. Обнови страницу.');
  throw new Error('socket.io client is not loaded');
}

// Авто-реконнект включён по умолчанию — специально не трогаем.
const socket = io();

socket.on('connect', () => {
  sayHello();
  requestWakeLock();
});

socket.on('disconnect', () => setOffline(true));
socket.on('connect_error', () => setOffline(true));

socket.on('identity', (data) => {
  if (!data || typeof data !== 'object') return;
  if (data.token) {
    myToken = String(data.token);
    lsSet(TOKEN_KEY, myToken);
  }
  if (data.playerId) lsSet(PLAYER_KEY, String(data.playerId));
});

socket.on('toast', (data) => {
  if (!data) return;
  toast(data.message, data.kind);
});

socket.on('state', render);

function sayHello() {
  const payload = { role: 'player' };
  if (myToken) payload.token = myToken;
  socket.emit('hello', payload, (res) => {
    if (res && res.ok === false && res.error && !res.stale) toast(res.error, 'error');
  });
}

/** Единая отправка действия: ack обязателен, ошибка — тостом. */
function send(event, payload, onAck, quiet) {
  if (!socket.connected) {
    toast('Нет связи — сейчас переподключимся');
    return;
  }
  socket.emit(event, payload || {}, (res) => {
    const result = res && typeof res === 'object' ? res : { ok: false, error: 'Что-то пошло не так' };
    // stale — погашенный двойной тап, о нём пользователю знать незачем.
    if (!result.ok && !result.stale && result.error) {
      // quiet решает сам вызывающий: сервер шлёт тот же текст ещё и событием,
      // поэтому текст надо не «не показать», а погасить в дедупликаторе.
      if (typeof quiet === 'function' && quiet(result)) muteToast(result.error);
      else toast(result.error, 'error');
    }
    if (typeof onAck === 'function') {
      try {
        onAck(result);
      } catch (err) {
        console.error(err);
      }
    }
  });
}

/** Действие ведущего всегда с номером раунда — иначе устаревший тап сработает. */
function hostSend(event, btn, extra) {
  if (!state || !state.round) return;
  lockButton(btn);
  send(event, { round: state.round.number, ...(extra || {}) });
}

function setOffline(value) {
  if (offline === value) return;
  offline = value;
  setHidden(els.offlineBanner, !value);
  document.body.classList.toggle('is-offline', value);
}

// ---------------------------------------------------------------------------
// Экраны
// ---------------------------------------------------------------------------

function showScreen(id) {
  if (currentScreen === id) return;
  currentScreen = id;
  for (const name of SCREENS) setHidden(els[name], name !== id);
  if (id !== 'screenPrep') document.body.classList.remove('is-typing');
  if (id !== 'screenAnswer') closePreview();
  if (id === 'screenLogin') {
    try {
      els.loginName.focus();
    } catch (err) {
      /* фокус не дали — не беда */
    }
  }
  window.scrollTo(0, 0);
}

/** Единственная точка перерисовки. */
function render(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  // Снимок рисуем оборонительно: пустой экран хуже, чем экран без одной детали.
  if (!snapshot.can || typeof snapshot.can !== 'object') snapshot.can = {};
  if (!Array.isArray(snapshot.players)) snapshot.players = [];
  if (!snapshot.settings) snapshot.settings = { targetScore: 0, handSize: 0 };
  if (snapshot.you) {
    for (const key of ['hand', 'myPrompts', 'myAnswers']) {
      if (!Array.isArray(snapshot.you[key])) snapshot.you[key] = [];
    }
  }
  if (snapshot.round && !Array.isArray(snapshot.round.reveals)) snapshot.round.reveals = [];
  state = snapshot;

  setOffline(false);
  unlockButtons();
  rememberCards(snapshot);
  renderTopbar(snapshot);

  // Вход: сервер нас не узнал.
  if (!snapshot.you) {
    showScreen('screenLogin');
    return;
  }
  hideClaim();

  if (snapshot.phase === 'gameOver') {
    renderGameOver(snapshot);
    showScreen('screenGameOver');
    return;
  }

  if (snapshot.phase === 'lobby') {
    if (snapshot.you.ready) {
      renderWaiting(snapshot);
      showScreen('screenWaiting');
    } else {
      renderPrep(snapshot);
      showScreen('screenPrep');
    }
    return;
  }

  renderReadBar(snapshot);

  if (snapshot.phase === 'round' && snapshot.round) {
    if (snapshot.you.isHost) {
      renderHost(snapshot);
      showScreen('screenHost');
    } else if (snapshot.round.step === 'result') {
      renderResult(snapshot);
      showScreen('screenResult');
    } else {
      renderAnswer(snapshot);
      showScreen('screenAnswer');
    }
    return;
  }

  showScreen('screenBoot');
}

/**
 * Панель «Прочитал». Экран переключается, когда прочли все живые игроки,
 * а не по таймеру: раньше ответы пролетали за секунду и их не успевали читать.
 */
function renderReadBar(snapshot) {
  const reading = snapshot.round?.reading;
  const active = Boolean(reading?.active) && snapshot.phase === 'round';
  setHidden(els.readBar, !active);
  if (!active) return;

  const left = Array.isArray(reading.waitingFor) ? reading.waitingFor : [];
  const iAmHost = Boolean(snapshot.you?.isHost);

  // Ведущему кнопка не нужна — он и так переключает экран. Но видеть, кого
  // ещё ждём, он обязан: иначе листает вслепую, глядя в свой телефон, и
  // гости не успевают дочитать. Ровно этого мы и добивались правкой.
  if (iAmHost) {
    els.readCount.textContent = left.length === 0
      ? 'Все прочитали — можно дальше'
      : (left.length <= 2
        ? `Ещё читают: ${left.join(' и ')}`
        : `Прочитали ${reading.acked} из ${reading.needed} — ещё читают`);
    setHidden(els.readBtn, true);
    return;
  }

  if (reading.youAcked) {
    els.readCount.textContent = left.length === 0
      ? 'Все прочитали — сейчас поедем дальше'
      : (left.length <= 2 ? `Ждём: ${left.join(' и ')}` : `Ждём ещё ${left.length}`);
  } else {
    els.readCount.textContent = reading.needed > 1
      ? `Прочитали ${reading.acked} из ${reading.needed}`
      : '';
  }
  setHidden(els.readBtn, Boolean(reading.youAcked));
  els.readBtn.disabled = !snapshot.can?.ackRead;
}

function rememberCards(snapshot) {
  const you = snapshot.you;
  if (!you) return;
  for (const list of [you.hand, you.myAnswers, you.myPrompts]) {
    if (!Array.isArray(list)) continue;
    for (const card of list) cardText.set(card.id, card.text);
  }
}

function renderTopbar(snapshot) {
  const you = snapshot.you;
  setHidden(els.topbar, !you);
  if (!you) return;
  setText(els.topbarName, you.name);
  // Голая цифра в углу ни о чём не говорит — пишем словом.
  setText(els.topbarScore, `${you.score} ${plural(you.score, 'очко', 'очка', 'очков')}`);
  setHidden(els.topbarHost, !you.isHost);
}

// ---------------------------------------------------------------------------
// 1. Вход
// ---------------------------------------------------------------------------

function showClaim(playerId, name) {
  claimPlayerId = playerId;
  setText(els.claimName, name || 'ты');
  setHidden(els.claimBox, false);
}

function hideClaim() {
  claimPlayerId = null;
  setHidden(els.claimBox, true);
}

els.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = els.loginName.value.trim();
  if (!name) {
    toast('Введи имя');
    els.loginName.focus();
    return;
  }
  lockButton(els.loginBtn);
  send('join', { name }, (res) => {
    if (res.ok) {
      els.loginName.value = '';
      hideClaim();
    } else if (res.canClaim) {
      // Имя занято игроком не в сети — предлагаем вернуться в игру (ТЗ 5.4).
      showClaim(res.canClaim, res.claimName || name);
    }
  // Красная ошибка «Имя занято» рядом с «Это ты? Вернуться в игру» пугает зря:
  // человек решает, что сломал что-то, хотя ему уже предложили вернуться.
  }, (res) => Boolean(res.canClaim));
});

els.claimBtn.addEventListener('click', () => {
  if (!claimPlayerId) return;
  lockButton(els.claimBtn);
  send('claim', { playerId: claimPlayerId }, (res) => {
    if (res.ok) hideClaim();
  });
});

// ---------------------------------------------------------------------------
// 2. Подготовка: вкладки, ввод карт, свои карты
// ---------------------------------------------------------------------------

function setTab(name) {
  activeTab = name;
  const prompts = name === 'prompts';
  els.tabPrompts.classList.toggle('tab--active', prompts);
  els.tabAnswers.classList.toggle('tab--active', !prompts);
  els.tabPrompts.setAttribute('aria-selected', String(prompts));
  els.tabAnswers.setAttribute('aria-selected', String(!prompts));
  setHidden(els.panelPrompts, !prompts);
  setHidden(els.panelAnswers, prompts);
}

els.tabPrompts.addEventListener('click', () => setTab('prompts'));
els.tabAnswers.addEventListener('click', () => setTab('answers'));

function updateChars(kind) {
  const input = kind === 'prompt' ? els.promptInput : els.answerInput;
  const out = kind === 'prompt' ? els.promptChars : els.answerChars;
  const max = kind === 'prompt' ? MAX_PROMPT_LEN : MAX_ANSWER_LEN;
  const left = max - charCount(input.value);
  if (left < CHARS_WARN_AT) {
    setText(out, `Осталось ${left} ${plural(left, 'символ', 'символа', 'символов')}`);
    setHidden(out, false);
  } else {
    setHidden(out, true);
  }
}

els.promptInput.addEventListener('input', () => {
  updateChars('prompt');
  autoGrow(els.promptInput);
});
els.answerInput.addEventListener('input', () => updateChars('answer'));
els.promptInput.addEventListener('keydown', enterSubmits);

/**
 * Пока человек печатает, экранная клавиатура съедает пол-экрана, а фиксированная
 * полоса «Я готов» садится ровно на кнопку «Добавить». На время ввода прячем её.
 */
els.screenPrep.addEventListener('focusin', (event) => {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') document.body.classList.add('is-typing');
});

els.screenPrep.addEventListener('focusout', () => {
  // Пауза заметная: тап по «Добавить» сначала снимает фокус с поля и только
  // потом становится нажатием. Вернись полоса мгновенно — она перехватила бы
  // это нажатие себе. Заодно фокус не мигает при переходе между полями.
  setTimeout(() => {
    const el = document.activeElement;
    const typing = el && els.screenPrep.contains(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    document.body.classList.toggle('is-typing', Boolean(typing));
  }, 250);
});

// «Вставить пропуск» — прямо в позицию курсора.
els.gapBtn.addEventListener('click', () => {
  const input = els.promptInput;
  const value = input.value;
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  input.value = value.slice(0, start) + PLACEHOLDER + value.slice(end);
  const caret = start + PLACEHOLDER.length;
  try {
    input.focus();
    input.setSelectionRange(caret, caret);
  } catch (err) {
    /* поле могло не дать курсор — текст всё равно вставлен */
  }
  updateChars('prompt');
  autoGrow(input);
});

function addCard(kind) {
  const input = kind === 'prompt' ? els.promptInput : els.answerInput;
  const btn = kind === 'prompt' ? els.promptAdd : els.answerAdd;
  const check = kind === 'prompt' ? validatePrompt(input.value) : validateAnswer(input.value);
  if (!check.ok) {
    toast(check.error, 'error');
    input.focus();
    return;
  }
  lockButton(btn);
  send('card:add', { kind, text: check.text }, (res) => {
    if (!res.ok) return;
    input.value = '';
    updateChars(kind);
    if (kind === 'prompt') autoGrow(input);
  });
}

els.promptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addCard('prompt');
});

els.answerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addCard('answer');
});

els.readyBtn.addEventListener('click', () => {
  if (!state || !state.you) return;
  lockButton(els.readyBtn);
  send('prep:ready', { ready: !state.you.ready });
});

els.unreadyBtn.addEventListener('click', () => {
  if (!state || !state.you) return;
  lockButton(els.unreadyBtn);
  send('prep:ready', { ready: false });
});

function renderPrep(snapshot) {
  const you = snapshot.you;

  // Ноль или отсутствие настройки означает «пиши сколько хочешь» — тогда
  // счётчик не давит на гостя цифрой.
  const askP = Number.isFinite(snapshot.settings?.askPrompts) ? snapshot.settings.askPrompts : 0;
  const askA = Number.isFinite(snapshot.settings?.askAnswers) ? snapshot.settings.askAnswers : 0;

  setText(
    els.promptCount,
    askP > 0
      ? `Вопросов: ${you.myPrompts.length} — лучше хотя бы ${askP}`
      : `Вопросов: ${you.myPrompts.length}`
  );
  setText(
    els.answerCount,
    askA > 0
      ? `Ответов: ${you.myAnswers.length} — лучше хотя бы ${askA}`
      : `Ответов: ${you.myAnswers.length}`
  );

  syncCardList(els.promptList, you.myPrompts, 'prompt');
  syncCardList(els.answerList, you.myAnswers, 'answer');
  setHidden(els.promptEmpty, you.myPrompts.length > 0);
  setHidden(els.answerEmpty, you.myAnswers.length > 0);

  const canAdd = Boolean(snapshot.can.addCards);
  els.promptAdd.disabled = !canAdd;
  els.answerAdd.disabled = !canAdd;
  els.gapBtn.disabled = !canAdd;

  setText(els.readyBtn, you.ready ? 'Я не готов' : 'Я готов');
  els.readyBtn.disabled = !snapshot.can.ready;
}

/** Перерисовать подготовку после локального действия (правка/удаление). */
function refreshPrep() {
  if (state && state.you && state.phase === 'lobby') renderPrep(state);
}

/**
 * Сверка списка своих карт по id: узлы переиспользуются, а не создаются заново.
 * Поле правки при этом не пересоздаётся — введённый текст и фокус остаются на месте.
 */
function syncCardList(listEl, items, kind) {
  const existing = new Map();
  for (const node of Array.from(listEl.children)) existing.set(node.dataset.cardId, node);

  items.forEach((card, index) => {
    let node = existing.get(card.id);
    if (node) existing.delete(card.id);
    else node = createCardRow(card, kind);
    updateCardRow(node, card, kind);
    if (listEl.children[index] !== node) {
      listEl.insertBefore(node, listEl.children[index] || null);
    }
  });

  for (const node of existing.values()) {
    if (editingCardId === node.dataset.cardId) editingCardId = null;
    if (confirmDeleteId === node.dataset.cardId) confirmDeleteId = null;
    node.remove();
  }
}

function createCardRow(card, kind) {
  const li = document.createElement('li');
  li.className = 'cardlist__item';
  li.dataset.cardId = card.id;

  const text = document.createElement('p');
  text.className = 'cardlist__text';

  const actions = document.createElement('div');
  actions.className = 'cardlist__actions';
  const editBtn = makeButton('btn btn--icon', '✎', 'Изменить карту');
  const deleteBtn = makeButton('btn btn--icon btn--danger', '✕', 'Удалить карту');
  actions.append(editBtn, deleteBtn);

  const panel = document.createElement('div');
  panel.className = 'cardlist__panel';
  panel.hidden = true;

  li.append(text, actions, panel);
  li._text = text;
  li._actions = actions;
  li._panel = panel;
  li._mode = 'view';

  editBtn.addEventListener('click', () => {
    editingCardId = card.id;
    confirmDeleteId = null;
    refreshPrep();
    const field = panel.querySelector('.input');
    if (!field) return;
    try {
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    } catch (err) {
      /* нет фокуса — не беда */
    }
  });

  deleteBtn.addEventListener('click', () => {
    confirmDeleteId = card.id;
    editingCardId = null;
    refreshPrep();
  });

  return li;
}

function updateCardRow(li, card, kind) {
  const mode =
    editingCardId === card.id ? 'edit' : confirmDeleteId === card.id ? 'delete' : 'view';

  if (li._mode !== mode) {
    buildRowPanel(li, card, kind, mode);
    li._mode = mode;
  }

  if (li._textValue !== card.text) {
    li._text.textContent = card.text;
    li._textValue = card.text;
  }

  setHidden(li._text, mode === 'edit');
  setHidden(li._actions, mode !== 'view');
  setHidden(li._panel, mode === 'view');
}

function buildRowPanel(li, card, kind, mode) {
  li._panel.textContent = '';
  if (mode === 'view') return;

  const row = document.createElement('div');
  row.className = 'cardlist__row';

  if (mode === 'delete') {
    const question = document.createElement('p');
    question.className = 'hint';
    question.textContent = 'Удалить карту?';
    const cancel = makeButton('btn btn--ghost', 'Отмена');
    const confirm = makeButton('btn btn--danger', 'Удалить');
    cancel.addEventListener('click', () => {
      confirmDeleteId = null;
      refreshPrep();
    });
    confirm.addEventListener('click', () => {
      lockButton(confirm);
      send('card:delete', { cardId: card.id }, (res) => {
        if (!res.ok) return;
        confirmDeleteId = null;
        refreshPrep();
      });
    });
    row.append(cancel, confirm);
    li._panel.append(question, row);
    return;
  }

  // Правка карты.
  const form = document.createElement('form');
  form.autocomplete = 'off';

  let field;
  if (kind === 'prompt') {
    field = document.createElement('textarea');
    field.className = 'input input--area';
    field.rows = 2;
    field.maxLength = MAX_PROMPT_LEN;
    field.setAttribute('aria-label', 'Текст вопроса');
    field.addEventListener('keydown', enterSubmits);
  } else {
    field = document.createElement('input');
    field.type = 'text';
    field.className = 'input';
    field.maxLength = MAX_ANSWER_LEN;
    field.setAttribute('aria-label', 'Текст ответа');
  }
  field.enterKeyHint = 'done';
  // Значение ставится один раз, при входе в режим правки: перерисовки его не трогают.
  field.value = card.text;
  if (kind === 'prompt') {
    // Длинный вопрос должен быть виден целиком, а не серединой в щели на две строки.
    field.addEventListener('input', () => autoGrow(field));
    requestAnimationFrame(() => autoGrow(field));
  }

  const cancel = makeButton('btn btn--ghost', 'Отмена');
  const save = makeButton('btn btn--primary', 'Сохранить');
  save.type = 'submit';

  cancel.addEventListener('click', () => {
    editingCardId = null;
    refreshPrep();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const check = kind === 'prompt' ? validatePrompt(field.value) : validateAnswer(field.value);
    if (!check.ok) {
      toast(check.error, 'error');
      return;
    }
    lockButton(save);
    send('card:edit', { cardId: card.id, text: check.text }, (res) => {
      if (!res.ok) return;
      editingCardId = null;
      refreshPrep();
    });
  });

  row.append(cancel, save);
  form.append(field, row);
  li._panel.append(form);
}

// ---------------------------------------------------------------------------
// 3. Ожидание старта
// ---------------------------------------------------------------------------

function renderWaiting(snapshot) {
  renderPlayerList(
    els.waitPlayers,
    snapshot.players.map((p) => ({
      key: p.id,
      name: p.name,
      value: p.connected ? (p.ready ? 'готов' : 'пишет карты') : 'не в сети',
      host: false,
      offline: !p.connected,
      ok: p.ready
    }))
  );
  els.unreadyBtn.disabled = !snapshot.can.ready;
}

/** Список игроков перерисовывается только когда действительно поменялся. */
function renderPlayerList(listEl, rows) {
  const sig = JSON.stringify(rows);
  if (listEl.dataset.sig === sig) return;
  listEl.dataset.sig = sig;
  listEl.textContent = '';

  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'scoreboard-row';
    if (row.host) li.classList.add('scoreboard-row--host');
    if (row.offline) li.classList.add('scoreboard-row--offline');

    const name = document.createElement('span');
    name.className = 'scoreboard-row__name';
    name.textContent = row.name;
    li.append(name);

    if (row.host) {
      const badge = document.createElement('span');
      badge.className = 'badge badge--host';
      badge.textContent = 'ведущий';
      li.append(badge);
    }

    const value = document.createElement('span');
    value.className = row.ok ? 'badge badge--ok' : 'scoreboard-row__value';
    value.textContent = row.value;
    li.append(value);

    listEl.append(li);
  }
}

// ---------------------------------------------------------------------------
// 4. Раунд: я отвечаю
// ---------------------------------------------------------------------------

/** Рисует части заходa с подставленным ответом: ответ — в <span class="filled">. */
function renderFilled(el, filled) {
  el.textContent = '';
  const parts = filled && Array.isArray(filled.parts) ? filled.parts : [];
  parts.forEach((part, index) => {
    if (part.type === 'answer') {
      // Пропуска в заходе не было — ответ идёт отдельной строкой под вопросом.
      if (filled.mode === 'below' && index > 0) el.append(document.createElement('br'));
      const span = document.createElement('span');
      span.className = 'filled';
      span.textContent = part.value;
      el.append(span);
    } else {
      el.append(document.createTextNode(part.value));
    }
  });
}

function renderAnswer(snapshot) {
  const round = snapshot.round;
  const you = snapshot.you;

  setText(els.answerRoundLine, `Раунд ${round.number} · ведущий ${round.hostName}`);

  const hasPrompt = Boolean(round.prompt);
  setHidden(els.answerPrompt, !hasPrompt);
  if (hasPrompt) setText(els.answerPrompt, round.prompt.text);

  const submittedId = you.submittedCardId;
  const handEmpty = you.hand.length === 0;

  let status = '';
  if (round.step === 'draw') status = `${round.hostName} вытягивает вопрос…`;
  else if (round.step === 'revealing') status = 'Ведущий читает ответы';
  else if (round.step === 'judging') status = 'Ведущий выбирает победителя';
  setHidden(els.answerStatus, status === '');
  if (status) setText(els.answerStatus, status);

  const showHand = round.step === 'answering' && !submittedId && !handEmpty;
  setHidden(els.answerHandBox, !showHand);
  if (showHand) renderHand(you.hand);

  setHidden(els.handEmpty, !(round.step === 'answering' && !submittedId && handEmpty));

  setHidden(els.answerSubmitted, !submittedId);
  if (submittedId) {
    const text = cardText.get(submittedId);
    if (text && hasPrompt) {
      renderFilled(els.submittedCard, fillPrompt(round.prompt.text, text));
      setHidden(els.submittedCard, false);
    } else {
      // После перезагрузки вкладки текста своей карты у нас нет — это не беда.
      setHidden(els.submittedCard, true);
    }
    // Пустой экран после отправки пугает: говорим, чего именно ждём.
    // На остальных шагах то же самое уже сказано в answerStatus — не дублируем.
    const waiting = round.step !== 'answering'
      ? ''
      : round.answered >= round.expected
        ? 'Все ответили — ждём ведущего'
        : `Ответили ${round.answered} из ${round.expected}`;
    setText(els.answerWaiting, waiting);
    setHidden(els.answerWaiting, waiting === '');
  }

  setHidden(els.answerBar, !snapshot.can.retract);
  els.retractBtn.disabled = !snapshot.can.retract;

  // Предпросмотр закрываем, если отвечать уже нельзя или карты не стало.
  if (previewCardId) {
    const stillThere = you.hand.some((card) => card.id === previewCardId);
    if (!stillThere || !snapshot.can.submit) closePreview();
    else renderPreview(snapshot);
  }
}

function renderHand(hand) {
  const sig = hand.map((card) => card.id).join('|');
  if (els.hand.dataset.sig === sig) return;
  els.hand.dataset.sig = sig;
  els.hand.textContent = '';

  for (const card of hand) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-answer hand-card';
    btn.textContent = card.text;
    btn.addEventListener('click', () => openPreview(card.id));
    li.append(btn);
    els.hand.append(li);
  }
}

function openPreview(cardId) {
  if (!state || !state.round || !state.can.submit) return;
  previewCardId = cardId;
  renderPreview(state);
  setHidden(els.preview, false);
}

function renderPreview(snapshot) {
  const card = snapshot.you.hand.find((item) => item.id === previewCardId);
  if (!card || !snapshot.round) {
    closePreview();
    return;
  }
  const promptText = snapshot.round.prompt ? snapshot.round.prompt.text : '';
  renderFilled(els.previewText, fillPrompt(promptText, card.text));
  els.previewSend.disabled = !snapshot.can.submit;
  setHidden(els.preview, false);
}

function closePreview() {
  previewCardId = null;
  setHidden(els.preview, true);
}

els.previewBack.addEventListener('click', closePreview);

els.previewSend.addEventListener('click', () => {
  if (!state || !state.round || !previewCardId) return;
  lockButton(els.previewSend);
  send('answer:submit', { round: state.round.number, cardId: previewCardId }, (res) => {
    if (res.ok) closePreview();
  });
});

els.readBtn.addEventListener('click', () => {
  lockButton(els.readBtn);
  send('read:ack', { round: state?.round?.number, mark: state?.round?.reading?.mark });
});

els.retractBtn.addEventListener('click', () => {
  if (!state || !state.round) return;
  lockButton(els.retractBtn);
  send('answer:retract', { round: state.round.number });
});

// ---------------------------------------------------------------------------
// 5. Раунд: я ведущий
// ---------------------------------------------------------------------------

function renderHost(snapshot) {
  const round = snapshot.round;
  const can = snapshot.can;

  setText(els.hostRoundLine, `Раунд ${round.number}`);

  const showPrompt = Boolean(round.prompt) && round.step !== 'draw';
  setHidden(els.hostPrompt, !showPrompt);
  if (showPrompt) setText(els.hostPrompt, round.prompt.text);

  const status = round.step === 'draw' ? 'Вытяни вопрос — остальные ждут' : '';
  setHidden(els.hostStatus, status === '');
  if (status) setText(els.hostStatus, status);

  // Шаг «ответы»: счётчик и кто уже сдал (какой картой — не видно никому).
  const answering = round.step === 'answering';
  setHidden(els.hostAnswering, !answering);
  if (answering) {
    setText(els.hostAnsweredCount, `Ответили ${round.answered} из ${round.expected}`);
    renderPlayerList(
      els.hostWho,
      snapshot.players
        .filter((p) => p.id !== round.hostId)
        .map((p) => ({
          key: p.id,
          name: p.name,
          value: !p.connected ? 'не в сети' : p.hasSubmitted ? 'готов' : 'думает',
          host: false,
          offline: !p.connected,
          ok: p.connected && p.hasSubmitted
        }))
    );
  }

  // Шаг «вскрытие»: текущий ответ и счётчик.
  const revealing = round.step === 'revealing';
  setHidden(els.hostRevealing, !revealing);
  if (revealing) {
    setText(els.hostRevealCounter, `Ответ ${round.revealedCount} из ${round.total}`);
    const current = round.reveals[round.revealedCount - 1];
    setHidden(els.hostRevealCard, !current);
    if (current) renderFilled(els.hostRevealCard, current);
  }

  // Шаг «выбор»: все варианты списком.
  const judging = round.step === 'judging';
  setHidden(els.hostJudging, !judging);
  if (judging) renderHostOptions(round);
  else pickedSubmissionId = null;

  // Шаг «результат».
  const result = round.step === 'result';
  setHidden(els.hostResult, !result);
  if (result) {
    if (round.winner) {
      // «Победил Даша» — половина гостей девушки. «Победитель» подходит всем.
      setText(els.hostWinnerLine, `Победитель — ${round.winner.authorName}`);
      renderFilled(els.hostWinnerCard, round.winner);
      setHidden(els.hostWinnerCard, false);
    } else {
      setText(els.hostWinnerLine, 'Раунд закончен');
      setHidden(els.hostWinnerCard, true);
    }
  }

  // Кнопки — ровно те, что разрешены в can.
  setHidden(els.btnDraw, !can.draw);
  setHidden(els.btnRedraw, !can.redraw);
  setHidden(els.btnSkip, !can.skipWaiting);
  setHidden(els.hostSecondaryRow, !can.redraw && !can.skipWaiting);

  setHidden(els.btnReveal, !can.reveal);
  setText(els.btnReveal, round.step === 'revealing' ? 'Следующий ответ' : 'Открыть ответы');

  // Кнопку показываем сразу, как только дошли до выбора: иначе ведущий видит
  // список вариантов и ни одной кнопки и не понимает, куда жать.
  // Пока вариант не отмечен — она видна, но нажать нельзя.
  setHidden(els.btnPick, !can.pick);
  els.btnPick.disabled = !pickedSubmissionId;
  setHidden(els.btnNext, !can.next);

  // Пустая полоса внизу без единой кнопки выглядит поломкой — прячем её целиком.
  const anyAction =
    can.draw || can.redraw || can.skipWaiting || can.reveal || can.pick || can.next;
  setHidden(els.hostBar, !anyAction);
}

function renderHostOptions(round) {
  const sig = round.reveals.map((item) => item.id).join('|') + '#' + (pickedSubmissionId || '');
  if (els.hostOptions.dataset.sig === sig) return;
  els.hostOptions.dataset.sig = sig;
  els.hostOptions.textContent = '';

  for (const item of round.reveals) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-answer hand-card';
    const picked = pickedSubmissionId === item.id;
    // Отметка — только рамкой и кнопкой внизу, которая из серой становится
    // красной. Значок «выбран» внутри карточки менял её высоту, и весь список
    // под пальцем уезжал вниз — ведущий промахивался по соседнему варианту.
    if (picked) btn.classList.add('card-answer--picked');
    btn.setAttribute('aria-pressed', String(picked));
    btn.textContent = item.answerText;
    btn.addEventListener('click', () => {
      pickedSubmissionId = pickedSubmissionId === item.id ? null : item.id;
      if (state) renderHost(state);
    });
    li.append(btn);
    els.hostOptions.append(li);
  }
}

els.btnDraw.addEventListener('click', () => hostSend('host:draw', els.btnDraw));
els.btnRedraw.addEventListener('click', () => hostSend('host:redraw', els.btnRedraw));
els.btnSkip.addEventListener('click', () => hostSend('host:skipWaiting', els.btnSkip));

els.btnReveal.addEventListener('click', () => {
  if (!state || !state.round) return;
  // index — сколько уже вскрыто: повторный тап сервер погасит как устаревший.
  hostSend('host:reveal', els.btnReveal, { index: state.round.revealedCount });
});

els.btnPick.addEventListener('click', () => {
  if (!pickedSubmissionId) return;
  hostSend('host:pick', els.btnPick, { submissionId: pickedSubmissionId });
});

els.btnNext.addEventListener('click', () => hostSend('host:next', els.btnNext));

// ---------------------------------------------------------------------------
// 6. Результат раунда (не ведущий)
// ---------------------------------------------------------------------------

function renderResult(snapshot) {
  const round = snapshot.round;
  setText(els.resultRoundLine, `Раунд ${round.number}`);

  if (round.winner) {
    const mine = round.winner.authorId === snapshot.you.id;
    setText(
      els.resultWinnerLine,
      mine ? 'Победил твой ответ!' : `Победитель — ${round.winner.authorName}`
    );
    renderFilled(els.resultCard, round.winner);
    setHidden(els.resultCard, false);
  } else {
    setText(els.resultWinnerLine, 'Раунд закончен');
    setHidden(els.resultCard, true);
  }

  setText(els.resultScore, `Твои очки: ${snapshot.you.score} из ${snapshot.settings.targetScore}`);
}

// ---------------------------------------------------------------------------
// 7. Конец игры
// ---------------------------------------------------------------------------

function renderGameOver(snapshot) {
  const over = snapshot.gameOver;
  setText(els.gameOverWinner, over ? `Победитель — ${over.winnerName}` : 'Игра окончена');
  renderPlayerList(
    els.gameOverStandings,
    (over ? over.standings : []).map((row, index) => ({
      key: String(index),
      name: row.name,
      value: `${row.score} ${plural(row.score, 'очко', 'очка', 'очков')}`,
      host: false,
      offline: false,
      ok: false
    }))
  );
}

// ---------------------------------------------------------------------------
// Переподключение, блокировка экрана, Wake Lock (ТЗ 5.4)
// ---------------------------------------------------------------------------

let wakeLock = null;

async function requestWakeLock() {
  // По http в локальной сети Wake Lock почти наверняка недоступен — это нормально,
  // ошибку пользователю не показываем.
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    if (wakeLock && typeof wakeLock.addEventListener === 'function') {
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch (err) {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Телефон разблокировали: проверяем связь и просим свежий снимок.
  if (socket.connected) socket.emit('sync', {});
  else socket.connect();
  requestWakeLock();
});

window.addEventListener('pageshow', () => {
  if (!socket.connected) socket.connect();
});

window.addEventListener('online', () => {
  if (!socket.connected) socket.connect();
});

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------

setTab('prompts');
updateChars('prompt');
updateChars('answer');
autoGrow(els.promptInput);
requestWakeLock();
