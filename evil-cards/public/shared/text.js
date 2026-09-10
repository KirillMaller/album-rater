/**
 * Общие текстовые правила «Злобных карт»: нормализация, валидация карт
 * и вставка ответа в пропуск.
 *
 * Модуль используют и сервер, и телефон (предпросмотр), поэтому он обязан
 * работать и в Node 20+, и в браузере через <script type="module">:
 * никаких импортов, зависимостей и Node-API.
 *
 * @typedef {{ ok: true, text: string } | { ok: false, error: string }} Result
 * @typedef {{ type: 'text' | 'answer', value: string }} FilledPart
 * @typedef {{ mode: 'inline' | 'below', parts: FilledPart[], plain: string }} Filled
 */

/** Максимальная длина захода (вопроса), символов. */
export const MAX_PROMPT_LEN = 150;

/** Максимальная длина ответа, символов. */
export const MAX_ANSWER_LEN = 80;

/** Что вставляет кнопка «Вставить пропуск». */
export const PLACEHOLDER = '___';

/** Пропуск — группа из двух и более подряд идущих «_». */
const PLACEHOLDER_RE = /_{2,}/;
const PLACEHOLDER_RE_G = /_{2,}/g;

/** BOM (U+FEFF): приезжает из txt-базы и из текста, вставленного из мессенджера. */
const BOM = String.fromCharCode(0xfeff);

/** CRLF и одиночный CR. */
const CRLF_RE = /\r\n?/g;

/** Управляющие символы (категория Cc). Табуляцию и перевод строки бережём отдельно. */
const CONTROL_RE = /\p{Cc}/gu;

/** Пробельное, что схлопывается в один пробел: табы, переносы и все виды пробелов (в т.ч. NBSP). */
const SPACE_RE = /[\t\n\p{Zs}]+/gu;

/** Пробелы и табы в конце куска текста. */
const TRAILING_SPACE_RE = /[ \t]+$/;

/** Конец предложения перед пропуском → ответ начинается с заглавной. */
const SENTENCE_END_RE = /[.!?…\n]$/;

/** Своя пунктуация захода сразу после пропуска (пробелы перед знаком допускаются). */
const PUNCT_AFTER_RE = /^[ \t]*[.,!?;:…]/;

/** Длина в символах: эмодзи и суррогатные пары считаются за один символ. */
function charLength(text) {
  return Array.from(text).length;
}

/** Убирает управляющие символы, но сохраняет табы и переводы строк. */
function stripControls(text) {
  return text.replace(CONTROL_RE, (ch) => (ch === '\t' || ch === '\n' ? ch : ''));
}

/**
 * Лёгкая чистка захода перед разбором: BOM, CRLF, управляющие символы, обрезка краёв.
 * Переносы строк внутри НЕ трогаем — на них опирается правило заглавной буквы.
 */
function tidyPrompt(raw) {
  if (typeof raw !== 'string') return '';
  return stripControls(raw.split(BOM).join('').replace(CRLF_RE, '\n')).trim();
}

/** Схлопывает пробелы, обрезает края, убирает управляющие символы и BOM. */
export function normalizeText(raw) {
  if (typeof raw !== 'string') return '';
  return stripControls(raw.split(BOM).join('').replace(CRLF_RE, '\n'))
    .replace(SPACE_RE, ' ')
    .trim();
}

/** Сколько пропусков (групп из 2+ подряд «_») в тексте. */
export function countPlaceholders(text) {
  if (typeof text !== 'string') return 0;
  const found = text.match(PLACEHOLDER_RE_G);
  return found ? found.length : 0;
}

/** true, если есть хотя бы один пропуск. */
export function hasPlaceholder(text) {
  return countPlaceholders(text) > 0;
}

/**
 * Валидация текста захода (вопроса).
 * @param {string} raw
 * @returns {Result}
 */
export function validatePrompt(raw) {
  const text = normalizeText(raw);
  if (text === '') {
    return { ok: false, error: 'Вопрос не может быть пустым' };
  }
  if (charLength(text) > MAX_PROMPT_LEN) {
    return { ok: false, error: `Вопрос длиннее ${MAX_PROMPT_LEN} символов` };
  }
  if (countPlaceholders(text) > 1) {
    return { ok: false, error: 'В вопросе может быть только один пропуск' };
  }
  return { ok: true, text };
}

/**
 * Валидация текста ответа.
 * @param {string} raw
 * @returns {Result}
 */
export function validateAnswer(raw) {
  const text = normalizeText(raw);
  if (text === '') {
    return { ok: false, error: 'Ответ не может быть пустым' };
  }
  if (charLength(text) > MAX_ANSWER_LEN) {
    return { ok: false, error: `Ответ длиннее ${MAX_ANSWER_LEN} символов` };
  }
  return { ok: true, text };
}

/** Ключ для поиска точных дублей: lowercase + схлопнутые пробелы. */
export function dedupeKey(text) {
  return normalizeText(text).toLocaleLowerCase('ru-RU');
}

/**
 * Собирает заход с подставленным ответом.
 * @param {string} promptText
 * @param {string} answerText
 * @returns {Filled}
 */
export function fillPrompt(promptText, answerText) {
  const prompt = tidyPrompt(promptText);
  const value = normalizeText(answerText);
  const match = PLACEHOLDER_RE.exec(prompt);

  // Ответа ещё нет (предпросмотр без выбранной карты) — отдаём заход как есть,
  // пропуск не съедаем.
  if (value === '') {
    return {
      mode: match ? 'inline' : 'below',
      parts: prompt === '' ? [] : [{ type: 'text', value: prompt }],
      plain: prompt
    };
  }

  // Пропуска нет: заход — обычный вопрос, ответ идёт отдельной строкой под ним.
  // Регистр и точку ответа здесь не трогаем: ответ — самостоятельная строка.
  if (!match) {
    const parts = [];
    if (prompt !== '') parts.push({ type: 'text', value: prompt });
    parts.push({ type: 'answer', value });
    return {
      mode: 'below',
      parts,
      plain: prompt === '' ? value : `${prompt} — ${value}`
    };
  }

  // Пропусков может быть несколько (при вводе запрещено, но в базу такое попадает) —
  // подставляем только в первый, остальные остаются текстом.
  const before = prompt.slice(0, match.index);
  let after = prompt.slice(match.index + match[0].length);
  let filled = value;

  // Пунктуация. Если сразу после пропуска идёт своя пунктуация захода — убираем
  // у ответа завершающую точку, чтобы не получилось «ночной дожор..».
  // Только одиночную: «!», «?» и многоточие «...» авторские, их не трогаем.
  if (PUNCT_AFTER_RE.test(after) && filled.endsWith('.') && !filled.endsWith('..')) {
    filled = filled.slice(0, -1);
  }

  // Обратный случай: ответ САМ кончается сильным знаком, а заход ставит после
  // него точку — выходит «муся, это ты?.». Тогда лишняя уже точка захода.
  // Замер 10.09.2026: на живой базе так ломались 40 фраз из 4620.
  // «!» и «?» самого захода не трогаем — они авторские и осмысленные.
  if (/[.!?…]$/.test(filled) && /^[ 	]*[.,;:]/.test(after)) {
    after = after.replace(/^([ 	]*)[.,;:]/, '$1');
  }

  // Заглавная буква. Пропуск в начале захода, после переноса строки или после конца
  // предложения — значит, ответ начинает предложение. Двоеточие концом не считаем:
  // «…не проживёт и дня без этого: ночной дожор» должно остаться строчным.
  // Понижать регистр нельзя никогда — в ответах бывают имена: «Оля», «Тинькофф».
  const beforeEdge = before.replace(TRAILING_SPACE_RE, '');
  if (beforeEdge === '' || SENTENCE_END_RE.test(beforeEdge)) {
    filled = filled.charAt(0).toLocaleUpperCase('ru-RU') + filled.slice(1);
  }

  const parts = [
    { type: 'text', value: before },
    { type: 'answer', value: filled },
    { type: 'text', value: after }
  ].filter((part) => part.value !== '');

  return {
    mode: 'inline',
    parts,
    plain: parts.map((part) => part.value).join('')
  };
}
