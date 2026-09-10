// server/deck.js — колоды «Злобных карт»: тасовка, стартовая раздача, добор, сброс.
//
// Модуль оперирует простым JSON-объектом `decks`, чтобы всё целиком уезжало
// в state.json и поднималось обратно без оживления классов:
//
// decks = {
//   guestPrompts: string[],  // гостевые заходы, тянем с начала
//   basePrompts:  string[],  // базовые заходы
//   usedPrompts:  string[],  // сыгранные заходы (второй круг)
//   answers:      string[],  // колода добора ответов
//   discard:      string[]   // сброс ответов
// }
//
// Все функции защищены от крайних случаев: пустые колоды, ноль игроков,
// отрицательные и нечисловые размеры руки. Исключений наружу не бросаем.

/** Имена очередей — по ним же чиним битые/неполные колоды из state.json. */
const DECK_KEYS = ['guestPrompts', 'basePrompts', 'usedPrompts', 'answers', 'discard'];

/** Пустые колоды. */
export function emptyDecks() {
  return {
    guestPrompts: [],
    basePrompts: [],
    usedPrompts: [],
    answers: [],
    discard: [],
  };
}

/**
 * Приводит объект колод к рабочему виду прямо на месте: пропавшие или
 * испорченные поля становятся пустыми массивами. Нужно после restore()
 * из чужого state.json — иначе один битый ключ уронил бы весь раунд.
 */
function ensure(decks) {
  if (!decks || typeof decks !== 'object') return emptyDecks();
  for (const key of DECK_KEYS) {
    if (!Array.isArray(decks[key])) decks[key] = [];
  }
  return decks;
}

/** Неотрицательное целое из чего угодно (NaN, null, «-3» → 0). */
function toCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Случайный индекс в диапазоне [0, max] включительно.
 * Кривой rng (вернул NaN, отрицательное или >= 1) не должен выбрасывать
 * индекс за границы массива, поэтому результат зажимаем.
 */
function pickIndex(max, rng) {
  if (max <= 0) return 0;
  const roll = typeof rng === 'function' ? Number(rng()) : Math.random();
  const value = Number.isFinite(roll) ? roll : 0;
  const idx = Math.floor(value * (max + 1));
  if (!Number.isFinite(idx) || idx < 0) return 0;
  return idx > max ? max : idx;
}

/** Перекладывает элементы в конец очереди, не теряя ссылку на массив. */
function pushAll(target, items) {
  for (let i = 0; i < items.length; i += 1) target.push(items[i]);
  return target;
}

/**
 * Фишер–Йетс с конца. Вход НЕ мутируется — возвращается новый массив.
 * rng подставляется в тестах, чтобы результат был предсказуемым.
 */
export function shuffle(items, rng = Math.random) {
  const out = Array.isArray(items) ? items.slice() : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i, rng);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Разбор txt-базы, которую пишет человек.
 * Убираем BOM, поддерживаем \r\n и \r, режем края строк,
 * пропускаем пустые строки и комментарии (первый непробельный символ «#»).
 * Дубли НЕ убираем — это забота вызывающего (там свой dedupeKey).
 */
export function parseBaseFile(content) {
  if (typeof content !== 'string' || content === '') return [];
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const out = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) continue;
    out.push(line);
  }
  return out;
}

/**
 * Стартовая раздача ответов и тасовка заходов.
 *
 * Сначала в раздачу идут ВСЕ гостевые ответы (они личные и самые смешные),
 * потом добираем базовыми до playerIds.length * handSize, всё вместе
 * перемешиваем и раздаём по кругу. Остаток (неразданные базовые, а если
 * гостевых оказалось больше нужного — и они тоже) перемешивается и
 * становится колодой добора.
 *
 * @returns {{ decks: object, hands: Record<string, string[]>, shortBy: number }}
 *   shortBy > 0 — столько карт не хватило до полной раздачи.
 */
export function dealStart({
  guestAnswerIds = [],
  baseAnswerIds = [],
  guestPromptIds = [],
  basePromptIds = [],
  playerIds = [],
  handSize = 10,
  rng = Math.random,
} = {}) {
  const guestAnswers = Array.isArray(guestAnswerIds) ? guestAnswerIds.slice() : [];
  const baseAnswers = Array.isArray(baseAnswerIds) ? baseAnswerIds.slice() : [];
  // Один и тот же id в списке игроков сломал бы счёт рук — оставляем уникальные.
  const players = Array.isArray(playerIds) ? [...new Set(playerIds)] : [];
  const perHand = toCount(handSize);
  const need = players.length * perHand;

  // Сколько базовых уходит в раздачу: только чтобы добить до need.
  const baseTaken = Math.max(0, Math.min(baseAnswers.length, need - guestAnswers.length));
  const pool = shuffle(guestAnswers.concat(baseAnswers.slice(0, baseTaken)), rng);

  const hands = {};
  for (const id of players) hands[id] = [];

  const dealt = Math.min(need, pool.length);
  for (let i = 0; i < dealt; i += 1) {
    // По кругу: при нехватке карты распределяются ровно, а не «первым всё».
    hands[players[i % players.length]].push(pool[i]);
  }

  // Хвост раздачи (если гостевых было больше, чем нужно) + нетронутая база.
  const leftover = pool.slice(dealt).concat(baseAnswers.slice(baseTaken));

  const decks = emptyDecks();
  decks.answers = shuffle(leftover, rng);
  decks.guestPrompts = shuffle(Array.isArray(guestPromptIds) ? guestPromptIds : [], rng);
  decks.basePrompts = shuffle(Array.isArray(basePromptIds) ? basePromptIds : [], rng);

  return { decks, hands, shortBy: Math.max(0, need - dealt) };
}

/**
 * Вытянуть заход: сначала гостевые, потом базовые.
 * Обе очереди пусты, но есть сыгранные — перемешиваем их в базовые
 * и идём по второму кругу. Совсем ничего нет → null.
 *
 * Карту в usedPrompts кладёт не эта функция, а usePrompt — в момент,
 * когда раунд действительно сыгран (иначе «Другой вопрос» терял бы заход).
 */
export function drawPrompt(decks, rng = Math.random) {
  const d = ensure(decks);
  if (d.guestPrompts.length > 0) return d.guestPrompts.shift();
  if (d.basePrompts.length > 0) return d.basePrompts.shift();
  if (d.usedPrompts.length > 0) {
    const reshuffled = shuffle(d.usedPrompts, rng);
    d.usedPrompts.length = 0;
    pushAll(d.basePrompts, reshuffled);
    return d.basePrompts.shift();
  }
  return null;
}

/** «Другой вопрос»: заход возвращается в конец той очереди, откуда пришёл. */
export function returnPrompt(decks, cardId, isGuest) {
  if (!cardId) return;
  const d = ensure(decks);
  if (isGuest) d.guestPrompts.push(cardId);
  else d.basePrompts.push(cardId);
}

/** Пометить заход сыгранным. Повторный вызов ничего не дублирует. */
export function usePrompt(decks, cardId) {
  if (!cardId) return;
  const d = ensure(decks);
  if (!d.usedPrompts.includes(cardId)) d.usedPrompts.push(cardId);
}

/**
 * Добрать ответы с начала колоды добора.
 * Колода кончилась, а сброс не пуст — сброс перемешивается в новую колоду.
 * Карт не хватает физически — возвращаем сколько есть, без исключений
 * и без бесконечного цикла.
 */
export function drawAnswers(decks, count, rng = Math.random) {
  const d = ensure(decks);
  const need = toCount(count);
  const out = [];
  // Страховка от зацикливания: больше карт, чем есть в игре, взять нельзя.
  let guard = need + d.answers.length + d.discard.length + 1;
  while (out.length < need && guard > 0) {
    guard -= 1;
    if (d.answers.length === 0) {
      if (d.discard.length === 0) break; // брать больше неоткуда
      const reshuffled = shuffle(d.discard, rng);
      d.discard.length = 0;
      pushAll(d.answers, reshuffled);
      if (d.answers.length === 0) break;
    }
    out.push(d.answers.shift());
  }
  return out;
}

/** Сыгранные ответы уходят в сброс. */
export function discardAnswers(decks, cardIds) {
  const d = ensure(decks);
  if (!Array.isArray(cardIds)) return;
  for (const id of cardIds) {
    if (id) d.discard.push(id);
  }
}

/**
 * Ответ, написанный посреди игры, встаёт в случайную позицию
 * верхней половины колоды добора — индекс [0, floor(answers.length / 2)],
 * чтобы автор увидел свою карту в ближайших раундах. Пустая колода → push.
 */
export function insertAnswer(decks, cardId, rng = Math.random) {
  if (!cardId) return;
  const d = ensure(decks);
  const maxIndex = Math.floor(d.answers.length / 2);
  d.answers.splice(pickIndex(maxIndex, rng), 0, cardId);
}

/** Новый заход посреди игры — в случайное место гостевой очереди целиком. */
export function insertGuestPrompt(decks, cardId, rng = Math.random) {
  if (!cardId) return;
  const d = ensure(decks);
  d.guestPrompts.splice(pickIndex(d.guestPrompts.length, rng), 0, cardId);
}

/** Сколько заходов доступно всего: гостевые + базовые + сыгранные. */
export function promptsLeft(decks) {
  const d = ensure(decks);
  return d.guestPrompts.length + d.basePrompts.length + d.usedPrompts.length;
}

/** Сколько ответов доступно всего: колода добора + сброс. */
export function answersLeft(decks) {
  const d = ensure(decks);
  return d.answers.length + d.discard.length;
}

/** Счётчик для id — растёт в пределах одного процесса. */
let cardSeq = 0;

/**
 * Короткий уникальный id карты: префикс + счётчик + случайный хвост.
 * Без зависимостей и без node:crypto, чтобы модуль оставался пригодным
 * и для браузера, если он однажды понадобится там.
 */
export function makeCardId(prefix = 'c') {
  cardSeq += 1;
  const tail = Math.random().toString(36).slice(2, 8).padStart(6, '0');
  return `${prefix}${cardSeq.toString(36)}-${tail}`;
}
