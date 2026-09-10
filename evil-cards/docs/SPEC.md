# SPEC — контракты модулей «Злобных карт»

Этот файл — **источник правды по интерфейсам**. Модули пишутся параллельно, поэтому
сигнатуры, имена событий и форма снимка менять нельзя без правки этого файла.

Всё — ES-модули (`"type": "module"`). Без TypeScript. Без сборки.
Зависимости только: `express`, `socket.io`, `qrcode` (+ `socket.io-client` в dev для нагрузочного теста).

---

## 1. `public/shared/text.js`

Работает **и в Node, и в браузере**. Никаких Node-API, никаких импортов.

```js
export const MAX_PROMPT_LEN = 150;
export const MAX_ANSWER_LEN = 80;
export const PLACEHOLDER = '___';

/** Схлопывает пробелы, обрезает края, убирает управляющие символы и BOM. */
export function normalizeText(raw: string): string

/** Сколько пропусков (групп из 2+ подряд «_») в тексте. */
export function countPlaceholders(text: string): number

/** true, если есть хотя бы один пропуск. */
export function hasPlaceholder(text: string): boolean

/**
 * Валидация текста захода (вопроса).
 * Ошибки — готовые русские строки для тоста.
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function validatePrompt(raw: string): Result

/** То же для ответа. */
export function validateAnswer(raw: string): Result

/** Ключ для поиска точных дублей: lowercase + схлопнутые пробелы. */
export function dedupeKey(text: string): string

/**
 * Собирает заход с подставленным ответом.
 * @returns {{
 *   mode: 'inline' | 'below',
 *   parts: Array<{ type: 'text' | 'answer', value: string }>,
 *   plain: string
 * }}
 *
 * mode 'inline' — в заходе был пропуск, ответ встал внутрь.
 * mode 'below'  — пропуска не было, ответ идёт отдельной строкой под вопросом;
 *                 parts = [{type:'text', ...}, {type:'answer', ...}].
 *
 * Клиенты рендерят parts в DOM: часть 'answer' оборачивается в <span class="filled">.
 * `plain` — та же строка текстом, для истории, логов и тестов
 *           (в режиме 'below' — «вопрос — ответ» через тире).
 */
export function fillPrompt(promptText: string, answerText: string): Filled
```

### Правила `fillPrompt` (режим inline)

Порядок применения важен:

1. Пропуск — первая группа `/_{2,}/`. Текст до неё — `before`, после — `after`.
2. `value = normalizeText(answerText)`.
3. **Пунктуация.** Если `after` начинается со знака из `.,!?;:…` — убрать у `value`
   завершающую точку (только `.`, не `!`/`?`).
4. **Заглавная буква.** Если `before` пустой или его обрезанный вариант заканчивается
   на `.`, `!`, `?`, `…` или переносе строки — первую букву `value` сделать заглавной.
   Понижать регистр **никогда** (в ответах бывают имена).
5. `parts = [{text, before}, {answer, value}, {text, after}]`; пустые части выкидываются.

Если пропусков в тексте больше одного (в базу такое может попасть, при вводе
запрещено) — подставлять **только в первый**, остальные оставить как есть.

---

## 2. `server/deck.js`

Оперирует **простым JSON-объектом** `decks`, чтобы всё сериализовалось в state.json.

```js
/**
 * decks = {
 *   guestPrompts: string[],   // cardId, очередь: тянем с начала
 *   basePrompts:  string[],
 *   usedPrompts:  string[],   // сыгранные заходы
 *   answers:      string[],   // колода добора
 *   discard:      string[]    // сброс
 * }
 */

/** Фишер–Йетс, не мутирует вход. rng — для детерминированных тестов. */
export function shuffle<T>(items: T[], rng?: () => number): T[]

/** Разбор txt-базы: убрать BOM, CRLF, пустые строки и строки на «#», обрезать края. */
export function parseBaseFile(content: string): string[]

/** Пустые колоды. */
export function emptyDecks(): Decks

/**
 * Стартовая раздача.
 * Гостевые ответы идут первыми, добиваются базовыми до players*handSize,
 * всё перемешивается и раздаётся. Остаток базовых — колода добора.
 * @returns {{ decks: Decks, hands: Record<playerId, string[]>, shortBy: number }}
 *   shortBy > 0 — не хватило карт, раздали сколько было.
 */
export function dealStart({ guestAnswerIds, baseAnswerIds, guestPromptIds,
                            basePromptIds, playerIds, handSize, rng }): DealResult

/**
 * Вытянуть заход: сначала guestPrompts, потом basePrompts.
 * Обе пусты — usedPrompts перемешиваются и становятся basePrompts (второй круг).
 * @returns {string | null} cardId, либо null если заходов нет вообще.
 */
export function drawPrompt(decks: Decks, rng?): string | null

/** «Другой вопрос»: вернуть заход в конец очереди, из которой он пришёл. */
export function returnPrompt(decks: Decks, cardId: string, isGuest: boolean): void

/** Пометить заход сыгранным (в usedPrompts). */
export function usePrompt(decks: Decks, cardId: string): void

/**
 * Добрать ответы. Колода кончилась — сброс перемешивается в новую колоду.
 * Не хватило и так — вернуть сколько есть (не падать).
 */
export function drawAnswers(decks: Decks, count: number, rng?): string[]

export function discardAnswers(decks: Decks, cardIds: string[]): void

/** Новый ответ посреди игры — в случайную позицию верхней половины колоды добора. */
export function insertAnswer(decks: Decks, cardId: string, rng?): void

/** Новый заход посреди игры — в случайное место гостевой очереди. */
export function insertGuestPrompt(decks: Decks, cardId: string, rng?): void

/** Сколько заходов доступно всего (гостевые + базовые + сыгранные). */
export function promptsLeft(decks: Decks): number
export function answersLeft(decks: Decks): number
```

---

## 3. `server/storage.js`

```js
/**
 * @param {{ dataDir: string, debounceMs?: number }} opts
 */
export function createStorage(opts): {
  /** Читает state.json. Нет файла или битый JSON → null (битый переименовывается в .broken). */
  load(): object | null,
  /** Ставит запись в очередь с дебаунсом ~300 мс. */
  save(state: object): void,
  /** Пишет немедленно, ждёт завершения. Атомарно: tmp → rename. */
  flush(state?: object): Promise<void>,
  /** Удаляет state.json (полный сброс). */
  clear(): Promise<void>,
  /** Читает базу из base-prompts.txt / base-answers.txt. Нет файлов → пустые массивы. */
  loadBase(): { prompts: string[], answers: string[] },
  /** Пишет базу в те же файлы (панель организатора → «Сохранить базу»). Атомарно. */
  saveBase(data: { prompts: string[], answers: string[] }): Promise<void>
}
```

Запись атомарна: `state.json.tmp` → `fs.rename`. Ошибки записи не роняют процесс —
логируются и попадают тостом организатору.

---

## 4. `server/game.js`

Класс `Game`. **Не знает про сокеты.** Все действия возвращают одинаковый результат.

```js
export class Game {
  constructor({ storage, onChange, rng, now }) {}

  /** Полное состояние (для сохранения). */
  get state(): State

  /** Восстановиться из state.json. Мусор игнорируется, игра стартует с чистого. */
  restore(saved: object): void

  // --- Actor ---
  // actor = { role: 'player' | 'screen', playerId?: string }

  // --- Вход ---
  join({ name }): Result<{ playerId, token }>
  resume({ token }): Result<{ playerId }>
  /** «Это ты? Вернуться в игру» — по имени игрока не в сети. */
  claim({ playerId }): Result<{ playerId, token }>
  setConnected(playerId, connected: boolean): void

  // --- Подготовка ---
  addCard(actor, { kind: 'prompt'|'answer', text }): Result<{ cardId }>
  editCard(actor, { cardId, text }): Result
  deleteCard(actor, { cardId }): Result
  setReady(actor, { ready: boolean }): Result

  // --- Раунд ---
  submitAnswer(actor, { round, cardId }): Result
  retractAnswer(actor, { round }): Result

  // --- Ведущий (может звать сам ведущий ИЛИ ноутбук) ---
  hostDraw(actor, { round }): Result
  hostRedraw(actor, { round }): Result
  hostSkipWaiting(actor, { round }): Result
  hostReveal(actor, { round, index }): Result
  hostPick(actor, { round, submissionId }): Result
  hostNext(actor, { round }): Result

  // --- Организатор (только ноутбук) ---
  /** Подтверждения независимы: needConfirm в ответе = 'notReady' | 'fewAnswers'. */
  adminStart(actor, { force?, confirmNotReady?, confirmFewAnswers? }): Result
  adminSettings(actor, { targetScore?, handSize? }): Result
  adminKick(actor, { playerId }): Result
  adminPassHost(actor): Result
  adminNewGame(actor): Result
  adminReset(actor): Result
  adminSetIp(actor, { ip }): Result
  adminAddBots(actor, { count }): Result
  adminSaveBase(actor, { prompts: string, answers: string }): Result
  adminRemoveBots(actor): Result

  /** Персональный снимок. Секреты не утекают — см. раздел 5. */
  snapshotFor(actor): Snapshot
}
```

**Result** — либо `{ ok: true, ...data }`, либо `{ ok: false, error: 'сообщение по-русски' }`.
Никаких throw наружу.

**Инварианты, которые обязаны соблюдаться:**

- Любое `host:*` действие проверяет `round === state.round.number`. Не совпало — тихо `{ok:false}` без тоста (это устаревший двойной тап).
- `hostReveal` проверяет ещё и `index === revealedCount`. Повтор — игнор.
- Авторство ответов (`submissions[].playerId`) не попадает ни в один снимок, пока `step !== 'result'`.
- Чужие руки не попадают ни в один снимок никогда.
- `revealOrder` строится один раз при переходе в `revealing` и перемешан случайно.
- После каждого мутирующего действия вызывается `onChange()`.

---

## 5. Снимок состояния (`snapshotFor`)

Одна форма для обоих клиентов. Телефон получает `you`, ноутбук — `you: null` и `isScreen: true`.

```js
{
  v: 1,
  phase: 'lobby' | 'round' | 'gameOver',
  isScreen: boolean,
  settings: { targetScore: number, handSize: number },

  // Только для телефона (у ноутбука null)
  you: {
    id, name, score, ready, connected,
    isHost: boolean,
    hand: [{ id, text }],
    myPrompts: [{ id, text }],
    myAnswers: [{ id, text }],
    submittedCardId: string | null
  } | null,

  players: [{
    id, name, score, connected, ready, isBot,
    isHost: boolean,
    promptCount: number, answerCount: number,
    hasSubmitted: boolean          // факт ответа, НЕ карта
  }],

  base: { prompts: number, answers: number },

  round: {
    number, hostId, hostName,
    step: 'draw' | 'answering' | 'revealing' | 'judging' | 'result',
    prompt: { id, text } | null,
    redrawUsed: boolean,
    answered: number, expected: number,
    total: number,                 // сколько всего ответов сдали
    revealedCount: number,
    reveals: [{                    // только уже вскрытые
      id, answerText,
      parts: FilledParts,
      mode: 'inline' | 'below',
      authorName: string | null,   // не null только на step==='result'
      isWinner: boolean
    }],
    winner: { submissionId, authorId, authorName, answerText, parts, mode } | null
  } | null,

  history: [{ round, promptText, answerText, winnerName, parts }],

  gameOver: {
    winnerName: string,
    standings: [{ name, score, isBot }]
  } | null,

  network: { publicUrl: string, urls: string[], selectedUrl: string },

  warnings: string[],              // «мало ответов», «карты кончились» и т.п.

  can: {                           // что этому клиенту сейчас можно
    start, draw, redraw, skipWaiting, reveal, pick, next,
    submit, retract, addCards, ready
  }
}
```

Ноутбук получает `can.draw/redraw/.../next` = true, когда это доступно **ведущему**
(ТЗ 3.2: все кнопки ведущего продублированы на ноутбуке).

---

## 6. Socket.io события

### Клиент → сервер

| Событие | Payload | Кто |
|---|---|---|
| `hello` | `{ role: 'player'\|'screen', token?: string }` | оба |
| `join` | `{ name }` | телефон |
| `claim` | `{ playerId }` | телефон |
| `card:add` | `{ kind, text }` | телефон |
| `card:edit` | `{ cardId, text }` | телефон |
| `card:delete` | `{ cardId }` | телефон |
| `prep:ready` | `{ ready }` | телефон |
| `answer:submit` | `{ round, cardId }` | телефон |
| `answer:retract` | `{ round }` | телефон |
| `host:draw` | `{ round }` | оба |
| `host:redraw` | `{ round }` | оба |
| `host:skipWaiting` | `{ round }` | оба |
| `host:reveal` | `{ round, index }` | оба |
| `host:pick` | `{ round, submissionId }` | оба |
| `host:next` | `{ round }` | оба |
| `admin:start` | `{ force?, confirmNotReady?, confirmFewAnswers? }` | ноутбук |
| `admin:settings` | `{ targetScore?, handSize? }` | ноутбук |
| `admin:kick` | `{ playerId }` | ноутбук |
| `admin:passHost` | `{}` | ноутбук |
| `admin:newGame` | `{}` | ноутбук |
| `admin:reset` | `{}` | ноутбук |
| `admin:setIp` | `{ url }` | ноутбук |
| `admin:addBots` | `{ count }` | ноутбук |
| `admin:removeBots` | `{}` | ноутбук |
| `admin:saveBase` | `{ prompts, answers }` | ноутбук |
| `sync` | `{}` | оба — «пришли свежий снимок» после разблокировки телефона |

### Сервер → клиент

| Событие | Payload |
|---|---|
| `state` | Snapshot (см. раздел 5) |
| `toast` | `{ message: string, kind?: 'error'\|'info' }` |
| `identity` | `{ playerId, token }` — после `join`/`claim`, телефон кладёт в localStorage |
| `qr` | `{ dataUrl, url }` — data-URL картинки QR (ноутбук) |

### Как сервер отвечает на действие

Каждое клиент→сервер событие принимает **необязательный ack-колбэк** последним
аргументом (`socket.emit('join', {name}, (res) => ...)`). Правила:

- Сервер **всегда** зовёт ack с результатом `{ok:true, ...}` / `{ok:false, error}`,
  если колбэк передан.
- Сервер **дополнительно** шлёт `toast` на любую ошибку, КРОМЕ помеченных
  `stale: true` — это погашенный двойной тап, пользователю о нём знать незачем.
- Свежий снимок `state` рассылается всем после любого успешного изменения,
  отдельно запрашивать не нужно.

Ack нужен там, где важен не только факт ошибки, но и данные при ней:

- `join` → `{ok:false, error:'Имя занято', canClaim: playerId, claimName}` —
  клиент показывает «Это ты? Вернуться в игру».
- `admin:start` → `{ok:false, error, needConfirm:'notReady'|'fewAnswers'}` —
  ноутбук показывает подтверждение и повторяет вызов с
  `confirmNotReady:true` / `confirmFewAnswers:true`.

### Порядок входа клиента

1. Соединились → `hello {role, token?}` (токен из localStorage, если есть).
2. Токен подошёл → сервер шлёт `identity {playerId, token}` и `state` с заполненным `you`.
3. Токена нет или не подошёл → приходит `state` с `you: null`, клиент рисует экран имени.
4. `join {name}` → `identity` + `state`, либо ошибка с `canClaim`.
5. `claim {playerId}` → `identity` (новый токен) + `state`.

Все обработчики на сервере обёрнуты в try/catch: исключение → `toast` с текстом
«Что-то пошло не так», процесс не падает.

---

## 7. Модель состояния (в памяти и в state.json)

```js
{
  v: 1,
  phase: 'lobby' | 'round' | 'gameOver',
  settings: { targetScore: 10, handSize: 10 },
  players: [{
    id, token, name, score, connected, ready, isBot,
    hand: [cardId], joinedAt
  }],
  hostOrder: [playerId],
  hostCursor: number,
  cards: { [cardId]: { id, kind: 'prompt'|'answer', text, authorId } },  // authorId null = база
  decks: Decks,
  round: {
    number, hostId, promptId, promptIsGuest, redrawUsed,
    step, submissions: [{ id, playerId, cardId }],
    revealOrder: [submissionId], revealedCount, winnerSubmissionId
  } | null,
  history: [{ round, promptText, answerText, winnerId, winnerName }],
  warnings: string[],
  selectedUrl: string | null,
  botSeq: number
}
```

---

## 8. Классы CSS (оформление живёт только в CSS, JS его не знает)

Обязательные имена — на них завязаны стили (дизайн «винтажное приглашение»,
10.09.2026: `theme.css`, `play.css`, `screen.css`, `public/art/`, `public/fonts/`):

`.card-prompt`, `.card-answer`, `.card-answer--picked`, `.filled` (подставленный ответ),
`.hand`, `.hand-card`, `.scoreboard`, `.scoreboard-row`, `.scoreboard-row--host`,
`.scoreboard-row--offline`, `.qr`, `.qr--corner`, `.stage`, `.topbar`, `.btn`,
`.btn--primary`, `.btn--ghost`, `.btn--danger`, `.tabs`, `.tab`, `.tab--active`,
`.badge`, `.hint`, `.counter`, `.offline-banner`, `.admin-panel`, `.lobby`.

Все цвета/шрифты/отступы/скругления — переменные в `public/theme.css`.
В остальных css — **только** `var(--…)`.
