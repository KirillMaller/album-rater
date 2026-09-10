/**
 * game.js — правила и состояние «Злобных карт».
 *
 * Модуль НЕ знает про сокеты, файлы и HTTP. Он принимает действия, проверяет их
 * и отдаёт результат `{ok:true, ...}` либо `{ok:false, error:'по-русски'}`.
 * Наружу ничего не бросает.
 *
 * Контракт — docs/SPEC.md, разделы 4, 5, 7.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import {
  shuffle,
  emptyDecks,
  dealStart,
  drawPrompt,
  returnPrompt,
  usePrompt,
  drawAnswers,
  discardAnswers,
  insertAnswer,
  insertGuestPrompt,
  promptsLeft,
  answersLeft,
} from './deck.js';
import {
  validatePrompt,
  validateAnswer,
  dedupeKey,
  fillPrompt,
  normalizeText,
} from '../public/shared/text.js';

const STATE_VERSION = 1;

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MAX_NAME_LEN = 20;
const MAX_BOTS = 6;

/** Потолки на число карт от одного игрока — защита памяти, а не правило игры. */
const MAX_CARDS_PER_PLAYER = { prompt: 60, answer: 120 };

const ALLOWED_TARGET_SCORES = [5, 7, 10];
const MIN_HAND = 3;
const MAX_HAND = 15;

/** Имена ботов и заготовки их карт (боты нужны только для отладки в одиночку). */
const BOT_PROMPTS = [
  'Бот считает, что вечеринка держится на ___.',
  'Что бот сохранил бы себе на память?',
  'Единственное, чего боится бот: ___.',
];
const BOT_ANSWERS = [
  'перегретый процессор',
  'бесконечный цикл',
  'сорок вкладок в браузере',
  'вежливое «угу»',
  'кнопка, которую нельзя нажимать',
  'резервная копия чувств',
];

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error, data = {}) => ({ ok: false, error, ...data });

export class Game {
  /**
   * @param {object} opts
   * @param {() => void} [opts.onChange] вызывается после каждого изменения состояния
   * @param {() => number} [opts.rng] для детерминированных тестов
   * @param {() => number} [opts.now]
   * @param {{prompts: string[], answers: string[]}} [opts.fixtures]
   *        заглушки карт; подмешиваются, только если база пуста И в игре есть боты
   * @param {{loadBase: () => {prompts: string[], answers: string[]}}} [opts.storage]
   */
  constructor({ onChange = () => {}, rng = Math.random, now = () => Date.now(),
                fixtures = { prompts: [], answers: [] }, storage = null } = {}) {
    this.onChange = onChange;
    this.rng = rng;
    this.now = now;
    this.fixtures = fixtures;
    this.storage = storage;
    this.state = Game.freshState();
  }

  static freshState() {
    return {
      v: STATE_VERSION,
      phase: 'lobby',
      settings: { targetScore: 10, handSize: 10 },
      players: [],
      hostOrder: [],
      hostCursor: 0,
      cards: {},
      decks: emptyDecks(),
      round: null,
      history: [],
      warnings: [],
      selectedUrl: null,
      botSeq: 0,
    };
  }

  // ======================================================================
  // Восстановление
  // ======================================================================

  /**
   * Поднять состояние из state.json. Всё, что не сходится, чинится или
   * игнорируется — лучше начать заново, чем упасть посреди праздника.
   */
  restore(saved) {
    if (!saved || typeof saved !== 'object' || saved.v !== STATE_VERSION) return false;
    try {
      const s = Game.freshState();

      s.phase = ['lobby', 'round', 'gameOver'].includes(saved.phase) ? saved.phase : 'lobby';
      s.settings = {
        targetScore: this._clampTarget(saved.settings?.targetScore),
        handSize: this._clampHand(saved.settings?.handSize),
      };

      // Каждое поле проверяем на тип отдельно: если в state.json испортился
      // один кусок, восстанавливаем остальное, а не выбрасываем весь вечер.
      const arr = (v) => (Array.isArray(v) ? v : []);
      const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

      s.cards = {};
      for (const [id, c] of Object.entries(obj(saved.cards))) {
        if (!c || typeof c.text !== 'string') continue;
        if (c.kind !== 'prompt' && c.kind !== 'answer') continue;
        s.cards[id] = { id, kind: c.kind, text: c.text, authorId: c.authorId ?? null };
      }

      s.players = arr(saved.players)
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map((p) => ({
          id: p.id,
          token: typeof p.token === 'string' ? p.token : makeToken(),
          name: p.name,
          score: Number.isFinite(p.score) ? p.score : 0,
          connected: false, // после перезапуска все офлайн, пока не вернутся
          ready: Boolean(p.ready),
          isBot: Boolean(p.isBot),
          hand: arr(p.hand).filter((id) => s.cards[id]?.kind === 'answer'),
          joinedAt: Number.isFinite(p.joinedAt) ? p.joinedAt : this.now(),
        }));

      const ids = new Set(s.players.map((p) => p.id));
      s.hostOrder = arr(saved.hostOrder).filter((id) => ids.has(id));
      for (const p of s.players) if (!s.hostOrder.includes(p.id)) s.hostOrder.push(p.id);
      s.hostCursor = Number.isFinite(saved.hostCursor) ? saved.hostCursor : 0;

      const d = obj(saved.decks);
      const alive = (list, kind) => arr(list).filter((id) => s.cards[id]?.kind === kind);
      s.decks = {
        guestPrompts: alive(d.guestPrompts, 'prompt'),
        basePrompts: alive(d.basePrompts, 'prompt'),
        usedPrompts: alive(d.usedPrompts, 'prompt'),
        answers: alive(d.answers, 'answer'),
        discard: alive(d.discard, 'answer'),
      };

      s.history = arr(saved.history).filter((h) => h && typeof h.promptText === 'string');
      s.selectedUrl = typeof saved.selectedUrl === 'string' ? saved.selectedUrl : null;
      s.botSeq = Number.isFinite(saved.botSeq) ? saved.botSeq : 0;
      s.warnings = [];

      if (s.phase === 'round' && saved.round) {
        const r = obj(saved.round);
        const validSteps = ['draw', 'answering', 'revealing', 'judging', 'result'];
        const subs = arr(r.submissions).filter(
          (x) => x && ids.has(x.playerId) && s.cards[x.cardId]?.kind === 'answer'
        );
        s.round = {
          number: Number.isFinite(r.number) ? r.number : 1,
          hostId: ids.has(r.hostId) ? r.hostId : s.hostOrder[0] ?? null,
          promptId: s.cards[r.promptId]?.kind === 'prompt' ? r.promptId : null,
          promptIsGuest: Boolean(r.promptIsGuest),
          redrawUsed: Boolean(r.redrawUsed),
          forceReveal: Boolean(r.forceReveal),
          step: validSteps.includes(r.step) ? r.step : 'draw',
          submissions: subs,
          revealOrder: arr(r.revealOrder).filter((id) => subs.some((x) => x.id === id)),
          revealedCount: Number.isFinite(r.revealedCount) ? r.revealedCount : 0,
          winnerSubmissionId: r.winnerSubmissionId ?? null,
        };
        // Если заход потерялся — вернуть раунд на шаг «вытянуть».
        if (!s.round.promptId && s.round.step !== 'draw') {
          s.round.step = 'draw';
          s.round.submissions = [];
          s.round.revealOrder = [];
          s.round.revealedCount = 0;
          s.round.winnerSubmissionId = null;
        }
        if (!s.round.hostId) {
          s.phase = 'lobby';
          s.round = null;
        }
      } else if (s.phase === 'round') {
        s.phase = 'lobby';
      }

      this.state = s;
      return true;
    } catch (err) {
      console.error('[game] не удалось восстановить состояние:', err?.message);
      this.state = Game.freshState();
      return false;
    }
  }

  _changed() {
    try {
      this.onChange();
    } catch (err) {
      console.error('[game] onChange упал:', err?.message);
    }
  }

  // ======================================================================
  // Вход и игроки
  // ======================================================================

  getPlayer(id) {
    return this.state.players.find((p) => p.id === id) ?? null;
  }

  getPlayerByToken(token) {
    if (!token) return null;
    return this.state.players.find((p) => p.token === token) ?? null;
  }

  _findByName(name) {
    const key = name.trim().toLocaleLowerCase('ru-RU');
    return this.state.players.find((p) => p.name.toLocaleLowerCase('ru-RU') === key) ?? null;
  }

  /** Вход по имени. Опоздавший посреди игры сразу получает руку. */
  join({ name }) {
    const clean = normalizeText(String(name ?? ''));
    if (!clean) return fail('Введи имя');
    if (clean.length > MAX_NAME_LEN) return fail(`Имя длиннее ${MAX_NAME_LEN} символов`);

    const taken = this._findByName(clean);
    if (taken) {
      // ТЗ 5.4: имя занято игроком не в сети — предложить вернуться в игру.
      if (!taken.connected) {
        return fail('Имя занято', { canClaim: taken.id, claimName: taken.name });
      }
      return fail('Имя занято');
    }

    if (this.state.players.length >= MAX_PLAYERS) {
      return fail(`Больше ${MAX_PLAYERS} игроков не поместится`);
    }

    const player = {
      id: randomUUID(),
      token: makeToken(),
      name: clean,
      score: 0,
      connected: true,
      ready: false,
      isBot: false,
      hand: [],
      joinedAt: this.now(),
    };
    this.state.players.push(player);
    this.state.hostOrder.push(player.id);

    // Опоздавший: рука сразу, очередь ведущих — в конец (ТЗ 6).
    if (this.state.phase === 'round') {
      player.ready = true;
      this._refillHand(player);
    }

    this._changed();
    return ok({ playerId: player.id, token: player.token });
  }

  /** Возврат по сохранённому токену — имя вводить заново не нужно. */
  resume({ token }) {
    const player = this.getPlayerByToken(token);
    if (!player) return fail('Сессия не найдена');
    player.connected = true;
    this._changed();
    return ok({ playerId: player.id });
  }

  /** «Это ты? Вернуться в игру» — вход с другого браузера по имени. */
  claim({ playerId }) {
    const player = this.getPlayer(playerId);
    if (!player) return fail('Игрок не найден');
    if (player.isBot) return fail('Это бот');
    if (player.connected) return fail('Этот игрок уже в сети');
    // Токен обновляем: играет то устройство, которое вернулось последним.
    player.token = makeToken();
    player.connected = true;
    this._changed();
    return ok({ playerId: player.id, token: player.token });
  }

  setConnected(playerId, connected) {
    const player = this.getPlayer(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this._changed();
  }

  // ======================================================================
  // Карты игроков
  // ======================================================================

  _cardsOf(playerId, kind) {
    return Object.values(this.state.cards).filter(
      (c) => c.authorId === playerId && c.kind === kind
    );
  }

  _isDuplicate(text, exceptCardId = null) {
    const key = dedupeKey(text);
    return Object.values(this.state.cards).some(
      (c) => c.id !== exceptCardId && dedupeKey(c.text) === key
    );
  }

  addCard(actor, { kind, text }) {
    const player = this._actorPlayer(actor);
    if (!player) return fail('Сначала войди в игру');
    if (kind !== 'prompt' && kind !== 'answer') return fail('Неизвестный тип карты');
    if (this.state.phase === 'gameOver') return fail('Игра закончилась');

    const check = kind === 'prompt' ? validatePrompt(text) : validateAnswer(text);
    if (!check.ok) return fail(check.error);

    if (this._cardsOf(player.id, kind).length >= MAX_CARDS_PER_PLAYER[kind]) {
      return fail('Столько карт уже точно хватит :)');
    }
    if (this._isDuplicate(check.text)) return fail('Такая карта уже есть');

    const card = { id: randomUUID(), kind, text: check.text, authorId: player.id };
    this.state.cards[card.id] = card;

    // Карта, написанная посреди игры, сразу идёт в дело (ТЗ 4.2 и 4.3).
    if (this.state.phase === 'round') {
      if (kind === 'prompt') insertGuestPrompt(this.state.decks, card.id, this.rng);
      else insertAnswer(this.state.decks, card.id, this.rng);
    }

    this._changed();
    return ok({ cardId: card.id });
  }

  editCard(actor, { cardId, text }) {
    const player = this._actorPlayer(actor);
    if (!player) return fail('Сначала войди в игру');
    const card = this.state.cards[cardId];
    if (!card || card.authorId !== player.id) return fail('Это не твоя карта');
    if (this._isCardBusy(cardId)) return fail('Эта карта сейчас в игре, её не поправить');

    const check = card.kind === 'prompt' ? validatePrompt(text) : validateAnswer(text);
    if (!check.ok) return fail(check.error);
    if (this._isDuplicate(check.text, cardId)) return fail('Такая карта уже есть');

    card.text = check.text;
    this._changed();
    return ok();
  }

  deleteCard(actor, { cardId }) {
    const player = this._actorPlayer(actor);
    if (!player) return fail('Сначала войди в игру');
    const card = this.state.cards[cardId];
    if (!card || card.authorId !== player.id) return fail('Это не твоя карта');
    if (this._isCardBusy(cardId)) return fail('Эта карта сейчас в игре, её не удалить');

    // Вынимаем отовсюду: из очередей, колоды, сброса и чужих рук.
    const d = this.state.decks;
    for (const key of ['guestPrompts', 'basePrompts', 'usedPrompts', 'answers', 'discard']) {
      d[key] = d[key].filter((id) => id !== cardId);
    }
    for (const p of this.state.players) {
      const before = p.hand.length;
      p.hand = p.hand.filter((id) => id !== cardId);
      // Тому, у кого карту забрали, добираем замену.
      if (p.hand.length < before && this.state.phase === 'round') this._refillHand(p);
    }
    delete this.state.cards[cardId];
    this._changed();
    return ok();
  }

  /** Карта «занята», если это текущий заход или уже сданный в этом раунде ответ. */
  _isCardBusy(cardId) {
    const r = this.state.round;
    if (!r) return false;
    if (r.promptId === cardId) return true;
    return r.submissions.some((s) => s.cardId === cardId);
  }

  setReady(actor, { ready }) {
    const player = this._actorPlayer(actor);
    if (!player) return fail('Сначала войди в игру');
    if (this.state.phase !== 'lobby') return fail('Игра уже идёт');
    player.ready = Boolean(ready);
    this._changed();
    return ok();
  }

  // ======================================================================
  // Старт игры
  // ======================================================================

  _clampTarget(v) {
    const n = Number(v);
    return ALLOWED_TARGET_SCORES.includes(n) ? n : 10;
  }

  _clampHand(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 10;
    return Math.min(MAX_HAND, Math.max(MIN_HAND, n));
  }

  adminSettings(actor, { targetScore, handSize }) {
    if (!this._isScreen(actor)) return fail('Настройки меняются на ноутбуке');
    if (this.state.phase !== 'lobby') return fail('Настройки меняются до старта игры');
    if (targetScore !== undefined) this.state.settings.targetScore = this._clampTarget(targetScore);
    if (handSize !== undefined) this.state.settings.handSize = this._clampHand(handSize);
    this._changed();
    return ok();
  }

  /**
   * «Начать игру». База читается из файлов ИМЕННО СЕЙЧАС — её можно править
   * без перезапуска сервера (ТЗ 4.1).
   */
  adminStart(actor, { force = false, confirmNotReady = false, confirmFewAnswers = false } = {}) {
    if (!this._isScreen(actor)) return fail('Игра запускается с ноутбука');
    if (this.state.phase === 'round') return fail('Игра уже идёт');

    // Два подтверждения независимы: согласие «начать без готовых» не должно
    // молча проглатывать предупреждение о нехватке ответов, и наоборот.
    const okNotReady = force || confirmNotReady;
    const okFewAnswers = force || confirmFewAnswers;

    const players = this.state.players;
    if (players.length < MIN_PLAYERS) {
      return fail(`Нужно хотя бы ${MIN_PLAYERS} игрока`);
    }
    if (!okNotReady && players.some((p) => !p.ready && !p.isBot)) {
      const notReady = players.filter((p) => !p.ready && !p.isBot).map((p) => p.name);
      return fail(`Не все готовы: ${notReady.join(', ')}. Всё равно начать?`, {
        needConfirm: 'notReady',
      });
    }

    // 1. Подтянуть базу из txt.
    const base = this._loadBaseCards();

    // 2. Собрать колоды из гостевых + базовых.
    const guestPromptIds = [];
    const guestAnswerIds = [];
    for (const c of Object.values(this.state.cards)) {
      if (c.authorId === null) continue; // старые базовые карты пересоздаются ниже
      if (c.kind === 'prompt') guestPromptIds.push(c.id);
      else guestAnswerIds.push(c.id);
    }

    if (guestPromptIds.length + base.promptIds.length === 0) {
      return fail('Нет ни одного вопроса. Попроси гостей написать или загрузи базу');
    }

    const totalAnswers = guestAnswerIds.length + base.answerIds.length;
    const need = players.length * (this.state.settings.handSize + 3);
    if (!okFewAnswers && totalAnswers < need) {
      return fail(
        `Мало ответов: есть ${totalAnswers}, нужно хотя бы ${need}. Всё равно начать?`,
        { needConfirm: 'fewAnswers' }
      );
    }

    const deal = dealStart({
      guestAnswerIds,
      baseAnswerIds: base.answerIds,
      guestPromptIds,
      basePromptIds: base.promptIds,
      playerIds: players.map((p) => p.id),
      handSize: this.state.settings.handSize,
      rng: this.rng,
    });

    this.state.decks = deal.decks;
    for (const p of players) {
      p.hand = deal.hands[p.id] ?? [];
      p.score = 0;
    }

    this.state.warnings = [];
    if (deal.shortBy > 0) {
      this.state.warnings.push(
        `Карт хватило не на всех: не хватило ${deal.shortBy}. Игра пойдёт, но раздача неполная`
      );
    }

    // 3. Порядок ведущих — порядок списка, первый ведущий случайный (ТЗ 2.1.7).
    this.state.hostOrder = players.map((p) => p.id);
    this.state.hostCursor = Math.floor(this.rng() * this.state.hostOrder.length);

    this.state.phase = 'round';
    // history НЕ чистим: это «Лучшее за вечер», лента живёт через «Новую игру»
    // и обнуляется только полным сбросом.
    this._startRound(1);
    this._changed();
    return ok();
  }

  /** Читает базу и создаёт для неё карты. Старые базовые карты выкидываются. */
  _loadBaseCards() {
    let raw = { prompts: [], answers: [] };
    try {
      raw = this.storage?.loadBase?.() ?? raw;
    } catch (err) {
      console.error('[game] база не прочиталась:', err?.message);
    }

    const hasBots = this.state.players.some((p) => p.isBot);
    const empty = raw.prompts.length === 0 && raw.answers.length === 0;
    if (empty && hasBots) {
      // ТЗ 4.1: без настоящей базы, но с ботами — подмешиваем заглушки.
      raw = { prompts: [...this.fixtures.prompts], answers: [...this.fixtures.answers] };
    }

    // Выкидываем базовые карты прошлой игры, гостевые не трогаем.
    for (const c of Object.values(this.state.cards)) {
      if (c.authorId === null) delete this.state.cards[c.id];
    }

    const promptIds = [];
    const answerIds = [];
    const add = (text, kind, bucket) => {
      const check = kind === 'prompt' ? validatePrompt(text) : validateAnswer(text);
      if (!check.ok) return;
      if (this._isDuplicate(check.text)) return;
      const card = { id: randomUUID(), kind, text: check.text, authorId: null };
      this.state.cards[card.id] = card;
      bucket.push(card.id);
    };
    for (const line of raw.prompts) add(line, 'prompt', promptIds);
    for (const line of raw.answers) add(line, 'answer', answerIds);
    return { promptIds, answerIds };
  }

  // ======================================================================
  // Раунд
  // ======================================================================

  _startRound(number) {
    const hostId = this.state.hostOrder[this.state.hostCursor] ?? this.state.players[0]?.id ?? null;
    this.state.round = {
      number,
      hostId,
      promptId: null,
      promptIsGuest: false,
      redrawUsed: false,
      forceReveal: false,
      step: 'draw',
      submissions: [],
      revealOrder: [],
      revealedCount: 0,
      winnerSubmissionId: null,
    };
  }

  /** Ведущим может нажимать сам ведущий или ноутбук (ТЗ 3.2). */
  _isHostActor(actor) {
    if (this._isScreen(actor)) return true;
    return Boolean(this.state.round && actor?.playerId === this.state.round.hostId);
  }

  _isScreen(actor) {
    return actor?.role === 'screen';
  }

  _actorPlayer(actor) {
    if (!actor || actor.role !== 'player' || !actor.playerId) return null;
    return this.getPlayer(actor.playerId);
  }

  /**
   * Проверка «действие относится к текущему раунду и шагу».
   * Устаревшее действие (двойной тап, тормознувшая сеть) гасится тихо, без тоста.
   */
  _staleGuard(round) {
    const r = this.state.round;
    if (this.state.phase !== 'round' || !r) return fail('', { stale: true });
    if (round !== undefined && round !== null && Number(round) !== r.number) {
      return fail('', { stale: true });
    }
    return null;
  }

  hostDraw(actor, { round } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    if (!this._isHostActor(actor)) return fail('Вопрос тянет ведущий');
    const r = this.state.round;
    if (r.step !== 'draw') return fail('', { stale: true });

    const wasGuest = this.state.decks.guestPrompts.length > 0;
    const promptId = drawPrompt(this.state.decks, this.rng);
    if (!promptId) return fail('Вопросы закончились. Попроси гостей написать ещё');

    r.promptId = promptId;
    r.promptIsGuest = wasGuest;
    r.step = 'answering';
    this._changed();
    return ok();
  }

  /** «Другой вопрос» — один раз за раунд. Уже сданные ответы возвращаются в руки. */
  hostRedraw(actor, { round } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    if (!this._isHostActor(actor)) return fail('Вопрос меняет ведущий');
    const r = this.state.round;
    if (r.step !== 'answering') return fail('', { stale: true });
    if (r.redrawUsed) return fail('Другой вопрос можно взять только раз за раунд');
    if (!r.promptId) return fail('', { stale: true });

    returnPrompt(this.state.decks, r.promptId, r.promptIsGuest);

    // Заход поменялся — сданные ответы больше не подходят, возвращаем их владельцам.
    for (const sub of r.submissions) {
      const p = this.getPlayer(sub.playerId);
      if (p && !p.hand.includes(sub.cardId)) p.hand.push(sub.cardId);
    }
    r.submissions = [];
    r.forceReveal = false;

    const previousId = r.promptId;
    const wasGuest = this.state.decks.guestPrompts.length > 0;
    const promptId = drawPrompt(this.state.decks, this.rng);

    r.redrawUsed = true;
    r.promptId = promptId ?? previousId;
    r.promptIsGuest = promptId ? wasGuest : r.promptIsGuest;
    this._changed();

    // Заход был единственным — он же и вернулся. Честно говорим об этом.
    if (!promptId || promptId === previousId) {
      return fail('Других вопросов не осталось, вопрос прежний');
    }
    return ok();
  }

  /** Кто в этом раунде обязан ответить: в сети, не ведущий, есть чем ходить. */
  _answerers() {
    const r = this.state.round;
    if (!r) return [];
    return this.state.players.filter(
      (p) => p.connected && p.id !== r.hostId && p.hand.length > 0
    );
  }

  submitAnswer(actor, { round, cardId } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    const player = this._actorPlayer(actor);
    if (!player) return fail('Сначала войди в игру');
    const r = this.state.round;
    if (r.step !== 'answering') return fail('Сейчас не время отвечать');
    if (player.id === r.hostId) return fail('Ты ведущий — ты выбираешь');
    if (r.submissions.some((s) => s.playerId === player.id)) {
      return fail('Ответ уже отправлен');
    }
    if (!player.hand.includes(cardId)) return fail('Такой карты нет в руке');

    player.hand = player.hand.filter((id) => id !== cardId);
    r.submissions.push({ id: randomUUID(), playerId: player.id, cardId });
    this._changed();
    return ok();
  }

  retractAnswer(actor, { round } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    const player = this._actorPlayer(actor);
    if (!player) return fail('Сначала войди в игру');
    const r = this.state.round;
    // Забрать ответ можно только пока вскрытие не началось (ТЗ 2.2.2).
    if (r.step !== 'answering') return fail('Ответы уже вскрывают, поздно');

    const idx = r.submissions.findIndex((s) => s.playerId === player.id);
    if (idx === -1) return fail('Ты ещё не отвечал');
    const [sub] = r.submissions.splice(idx, 1);
    if (!player.hand.includes(sub.cardId)) player.hand.push(sub.cardId);
    this._changed();
    return ok();
  }

  /** «Не ждать» — разрешить вскрытие, не дожидаясь тормозящих. */
  hostSkipWaiting(actor, { round } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    if (!this._isHostActor(actor)) return fail('Это делает ведущий');
    const r = this.state.round;
    if (r.step !== 'answering') return fail('', { stale: true });
    if (r.submissions.length < 1) return fail('Пока нет ни одного ответа');
    r.forceReveal = true;
    this._changed();
    return ok();
  }

  _canReveal() {
    const r = this.state.round;
    if (!r || r.step !== 'answering') return false;
    if (r.submissions.length < 1) return false;
    if (r.forceReveal) return true;
    return r.submissions.length >= this._answerers().length;
  }

  /**
   * «Открыть ответы» (index === 0) и «Следующий ответ».
   * index — сколько ответов уже вскрыто. Повтор и устаревший индекс игнорируются:
   * двойной тап не должен вскрыть две карты (ТЗ 5.3).
   */
  hostReveal(actor, { round, index } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    if (!this._isHostActor(actor)) return fail('Ответы открывает ведущий');
    const r = this.state.round;

    if (r.step === 'answering') {
      if (Number(index) !== 0) return fail('', { stale: true });
      if (!this._canReveal()) return fail('Ещё не все ответили');
      r.revealOrder = shuffle(r.submissions.map((s) => s.id), this.rng);
      r.revealedCount = 1;
      r.step = r.revealedCount >= r.revealOrder.length ? 'judging' : 'revealing';
      this._changed();
      return ok();
    }

    if (r.step !== 'revealing') return fail('', { stale: true });
    if (Number(index) !== r.revealedCount) return fail('', { stale: true });

    r.revealedCount += 1;
    if (r.revealedCount >= r.revealOrder.length) r.step = 'judging';
    this._changed();
    return ok();
  }

  hostPick(actor, { round, submissionId } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    if (!this._isHostActor(actor)) return fail('Победителя выбирает ведущий');
    const r = this.state.round;
    if (r.step !== 'judging') return fail('', { stale: true });

    const sub = r.submissions.find((s) => s.id === submissionId);
    if (!sub) return fail('', { stale: true });

    r.winnerSubmissionId = sub.id;
    r.step = 'result';

    const winner = this.getPlayer(sub.playerId);
    if (winner) winner.score += 1;

    // Заход сыгран, сданные карты — в сброс, руки добираются (ТЗ 2.2.8).
    if (r.promptId) usePrompt(this.state.decks, r.promptId);
    discardAnswers(this.state.decks, r.submissions.map((s) => s.cardId));
    for (const p of this.state.players) this._refillHand(p);

    const promptText = this.state.cards[r.promptId]?.text ?? '';
    const answerText = this.state.cards[sub.cardId]?.text ?? '';
    const filled = fillPrompt(promptText, answerText);
    this.state.history.push({
      round: r.number,
      promptText,
      answerText,
      winnerId: sub.playerId,
      winnerName: winner?.name ?? '—',
      parts: filled.parts,
    });

    this._checkDeckHealth();
    this._changed();
    return ok();
  }

  hostNext(actor, { round } = {}) {
    const stale = this._staleGuard(round);
    if (stale) return stale;
    if (!this._isHostActor(actor)) return fail('Следующий раунд запускает ведущий');
    const r = this.state.round;

    // Обычный путь — после результата.
    const normal = r.step === 'result';
    // Крайний случай: отвечать физически некому (все офлайн или без карт) —
    // даём проскочить раунд, чтобы игра не встала намертво.
    const escape =
      r.step === 'answering' && r.submissions.length === 0 && this._answerers().length === 0;
    if (!normal && !escape) return fail('', { stale: true });

    if (escape && r.promptId) {
      returnPrompt(this.state.decks, r.promptId, r.promptIsGuest);
    }

    const champion = this.state.players.find(
      (p) => p.score >= this.state.settings.targetScore
    );
    if (normal && champion) {
      this.state.phase = 'gameOver';
      this.state.round = null;
      this._changed();
      return ok({ gameOver: true });
    }

    this._advanceHost();
    this._startRound(r.number + 1);
    this._changed();
    return ok();
  }

  /** Следующий ведущий по списку, игроки не в сети пропускаются (ТЗ 6). */
  _advanceHost() {
    const order = this.state.hostOrder;
    if (order.length === 0) return;
    for (let i = 1; i <= order.length; i += 1) {
      const idx = (this.state.hostCursor + i) % order.length;
      const p = this.getPlayer(order[idx]);
      if (p && p.connected) {
        this.state.hostCursor = idx;
        return;
      }
    }
    // Все офлайн — просто следующий по кругу.
    this.state.hostCursor = (this.state.hostCursor + 1) % order.length;
  }

  _refillHand(player) {
    const need = this.state.settings.handSize - player.hand.length;
    if (need <= 0) return;
    const drawn = drawAnswers(this.state.decks, need, this.rng);
    player.hand.push(...drawn);
  }

  _checkDeckHealth() {
    const left = answersLeft(this.state.decks);
    const warning = 'Ответы почти закончились — попроси гостей дописать карт';
    const has = this.state.warnings.includes(warning);
    if (left < this.state.players.length && !has) this.state.warnings.push(warning);
    if (left >= this.state.players.length && has) {
      this.state.warnings = this.state.warnings.filter((w) => w !== warning);
    }
  }

  // ======================================================================
  // Панель организатора
  // ======================================================================

  adminKick(actor, { playerId }) {
    if (!this._isScreen(actor)) return fail('Игроков удаляют с ноутбука');
    const player = this.getPlayer(playerId);
    if (!player) return fail('Игрок не найден');

    const r = this.state.round;
    if (r) {
      // Ответ снимается, только если вскрытие ещё не началось (ТЗ 6).
      if (r.step === 'answering') {
        r.submissions = r.submissions.filter((s) => s.playerId !== player.id);
      }
      if (r.hostId === player.id) {
        this._advanceHost();
        r.hostId = this.state.hostOrder[this.state.hostCursor] ?? null;
        this._resetRoundToDraw(r);
      }
    }

    // Рука в сброс, написанные им карты остаются в игре.
    discardAnswers(this.state.decks, player.hand);
    player.hand = [];

    const orderIdx = this.state.hostOrder.indexOf(player.id);
    if (orderIdx !== -1) {
      this.state.hostOrder.splice(orderIdx, 1);
      if (orderIdx < this.state.hostCursor) this.state.hostCursor -= 1;
    }
    this.state.players = this.state.players.filter((p) => p.id !== player.id);
    if (this.state.hostOrder.length > 0) {
      this.state.hostCursor =
        ((this.state.hostCursor % this.state.hostOrder.length) + this.state.hostOrder.length) %
        this.state.hostOrder.length;
    } else {
      this.state.hostCursor = 0;
    }

    this._changed();
    return ok();
  }

  /** «Передать ход следующему» — раунд начинается заново с новым ведущим. */
  adminPassHost(actor) {
    if (!this._isScreen(actor)) return fail('Это делается с ноутбука');
    if (this.state.phase !== 'round' || !this.state.round) return fail('Игра не идёт');
    const r = this.state.round;
    this._advanceHost();
    r.hostId = this.state.hostOrder[this.state.hostCursor] ?? r.hostId;
    this._resetRoundToDraw(r);
    this._changed();
    return ok();
  }

  /** Откатить раунд на «вытянуть вопрос»: карты и заход возвращаются на места. */
  _resetRoundToDraw(r) {
    for (const sub of r.submissions) {
      const p = this.getPlayer(sub.playerId);
      if (p && !p.hand.includes(sub.cardId)) p.hand.push(sub.cardId);
    }
    if (r.promptId) returnPrompt(this.state.decks, r.promptId, r.promptIsGuest);
    r.submissions = [];
    r.revealOrder = [];
    r.revealedCount = 0;
    r.winnerSubmissionId = null;
    r.promptId = null;
    r.promptIsGuest = false;
    r.redrawUsed = false;
    r.forceReveal = false;
    r.step = 'draw';
  }

  /** «Новая игра»: те же игроки и карты, очки в ноль, колоды заново (ТЗ 2.3). */
  adminNewGame(actor) {
    if (!this._isScreen(actor)) return fail('Это делается с ноутбука');
    for (const p of this.state.players) {
      p.score = 0;
      p.hand = [];
      p.ready = true;
    }
    this.state.phase = 'lobby';
    this.state.round = null;
    this.state.decks = emptyDecks();
    this.state.warnings = [];
    this._changed();
    return this.adminStart(actor, { force: true });
  }

  adminReset(actor) {
    if (!this._isScreen(actor)) return fail('Это делается с ноутбука');
    const url = this.state.selectedUrl;
    this.state = Game.freshState();
    this.state.selectedUrl = url;
    this._changed();
    return ok();
  }

  adminSetIp(actor, { url }) {
    if (!this._isScreen(actor)) return fail('Это делается с ноутбука');
    if (typeof url !== 'string' || !url) return fail('Пустой адрес');
    this.state.selectedUrl = url;
    this._changed();
    return ok();
  }

  adminAddBots(actor, { count }) {
    if (!this._isScreen(actor)) return fail('Боты добавляются с ноутбука');
    const n = Math.min(MAX_BOTS, Math.max(1, Math.round(Number(count) || 1)));
    const room = MAX_PLAYERS - this.state.players.length;
    if (room <= 0) return fail('Мест больше нет');
    const added = [];

    for (let i = 0; i < Math.min(n, room); i += 1) {
      this.state.botSeq += 1;
      const seq = this.state.botSeq;
      const bot = {
        id: randomUUID(),
        token: makeToken(),
        name: `Бот ${seq}`,
        score: 0,
        connected: true,
        ready: true,
        isBot: true,
        hand: [],
        joinedAt: this.now(),
      };
      this.state.players.push(bot);
      this.state.hostOrder.push(bot.id);
      added.push(bot.id);

      // Бот пишет пару карт, чтобы игру можно было погонять в одиночку (ТЗ 7).
      const prompt = BOT_PROMPTS[(seq - 1) % BOT_PROMPTS.length];
      this._addBotCard(bot.id, 'prompt', `${prompt}`);
      for (let k = 0; k < 3; k += 1) {
        const a = BOT_ANSWERS[(seq * 3 + k - 3) % BOT_ANSWERS.length];
        this._addBotCard(bot.id, 'answer', `${a} №${seq}`);
      }

      if (this.state.phase === 'round') this._refillHand(bot);
    }

    this._changed();
    return ok({ added });
  }

  _addBotCard(botId, kind, text) {
    const check = kind === 'prompt' ? validatePrompt(text) : validateAnswer(text);
    if (!check.ok || this._isDuplicate(check.text)) return;
    const card = { id: randomUUID(), kind, text: check.text, authorId: botId };
    this.state.cards[card.id] = card;
    if (this.state.phase === 'round') {
      if (kind === 'prompt') insertGuestPrompt(this.state.decks, card.id, this.rng);
      else insertAnswer(this.state.decks, card.id, this.rng);
    }
  }

  adminRemoveBots(actor) {
    if (!this._isScreen(actor)) return fail('Это делается с ноутбука');
    const bots = this.state.players.filter((p) => p.isBot);
    for (const bot of bots) this.adminKick(actor, { playerId: bot.id });
    return ok({ removed: bots.length });
  }

  /** «Загрузить базу» — записать присланный текст в те же txt-файлы. */
  adminSaveBase(actor, { prompts, answers }) {
    if (!this._isScreen(actor)) return fail('База загружается с ноутбука');
    if (!this.storage?.saveBase) return fail('Сохранение базы недоступно');
    try {
      this.storage.saveBase({ prompts, answers });
    } catch (err) {
      return fail('Не удалось записать базу: ' + (err?.message ?? 'ошибка'));
    }
    this._changed();
    return ok();
  }

  /** Сколько карт в базе прямо сейчас (для лобби на ноутбуке). */
  baseCounts() {
    try {
      const base = this.storage?.loadBase?.() ?? { prompts: [], answers: [] };
      return { prompts: base.prompts.length, answers: base.answers.length };
    } catch {
      return { prompts: 0, answers: 0 };
    }
  }

  // ======================================================================
  // Снимок состояния
  // ======================================================================

  /**
   * Персональный снимок. Здесь единственное место, где решается, что клиент
   * увидит. Чужие руки — никогда. Авторство ответов — только на шаге result.
   */
  snapshotFor(actor, extra = {}) {
    const s = this.state;
    const isScreen = this._isScreen(actor);
    const me = this._actorPlayer(actor);
    const r = s.round;
    const resultShown = Boolean(r && r.step === 'result');

    const players = s.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      ready: p.ready,
      isBot: p.isBot,
      isHost: Boolean(r && r.hostId === p.id),
      promptCount: this._cardsOf(p.id, 'prompt').length,
      answerCount: this._cardsOf(p.id, 'answer').length,
      hasSubmitted: Boolean(r && r.submissions.some((x) => x.playerId === p.id)),
    }));

    let you = null;
    if (me) {
      const mySub = r?.submissions.find((x) => x.playerId === me.id) ?? null;
      you = {
        id: me.id,
        name: me.name,
        score: me.score,
        ready: me.ready,
        connected: me.connected,
        isHost: Boolean(r && r.hostId === me.id),
        hand: me.hand.map((id) => this._cardView(id)).filter(Boolean),
        myPrompts: this._cardsOf(me.id, 'prompt').map((c) => ({ id: c.id, text: c.text })),
        myAnswers: this._cardsOf(me.id, 'answer').map((c) => ({ id: c.id, text: c.text })),
        submittedCardId: mySub?.cardId ?? null,
      };
    }

    let round = null;
    if (r) {
      const promptText = r.promptId ? this.state.cards[r.promptId]?.text ?? '' : '';
      const revealed = r.revealOrder.slice(0, r.revealedCount).map((subId) => {
        const sub = r.submissions.find((x) => x.id === subId);
        const answerText = sub ? this.state.cards[sub.cardId]?.text ?? '' : '';
        const filled = fillPrompt(promptText, answerText);
        return {
          id: subId,
          answerText,
          parts: filled.parts,
          mode: filled.mode,
          // Авторство появляется строго на шаге result и ни секундой раньше.
          authorName: resultShown ? this.getPlayer(sub?.playerId)?.name ?? null : null,
          isWinner: resultShown && r.winnerSubmissionId === subId,
        };
      });

      let winner = null;
      if (resultShown && r.winnerSubmissionId) {
        const sub = r.submissions.find((x) => x.id === r.winnerSubmissionId);
        const answerText = sub ? this.state.cards[sub.cardId]?.text ?? '' : '';
        const filled = fillPrompt(promptText, answerText);
        winner = {
          submissionId: r.winnerSubmissionId,
          authorId: sub?.playerId ?? null,
          authorName: this.getPlayer(sub?.playerId)?.name ?? '—',
          answerText,
          parts: filled.parts,
          mode: filled.mode,
        };
      }

      round = {
        number: r.number,
        hostId: r.hostId,
        hostName: this.getPlayer(r.hostId)?.name ?? '—',
        step: r.step,
        prompt: r.promptId ? { id: r.promptId, text: promptText } : null,
        redrawUsed: r.redrawUsed,
        answered: r.submissions.length,
        expected: this._answerers().length,
        total: r.submissions.length,
        revealedCount: r.revealedCount,
        reveals: revealed,
        winner,
      };
    }

    let gameOver = null;
    if (s.phase === 'gameOver') {
      const standings = [...s.players]
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
        .map((p) => ({ name: p.name, score: p.score, isBot: p.isBot }));
      gameOver = { winnerName: standings[0]?.name ?? '—', standings };
    }

    return {
      v: STATE_VERSION,
      phase: s.phase,
      isScreen,
      settings: { ...s.settings },
      you,
      players,
      base: extra.base ?? this.baseCounts(),
      round,
      history: s.history.map((h) => ({
        round: h.round,
        promptText: h.promptText,
        answerText: h.answerText,
        winnerName: h.winnerName,
        parts: h.parts ?? [],
      })),
      gameOver,
      network: extra.network ?? { publicUrl: '', urls: [], selectedUrl: s.selectedUrl ?? '' },
      warnings: [...s.warnings],
      can: this._canFor(actor, me, isScreen),
    };
  }

  _cardView(id) {
    const c = this.state.cards[id];
    return c ? { id: c.id, text: c.text } : null;
  }

  _canFor(actor, me, isScreen) {
    const s = this.state;
    const r = s.round;
    const hostActor = this._isHostActor(actor);
    const inRound = s.phase === 'round' && Boolean(r);

    const iAnswer = Boolean(me && r && me.id !== r.hostId);
    const mySubmitted = Boolean(me && r?.submissions.some((x) => x.playerId === me.id));

    return {
      start: isScreen && s.phase !== 'round' && s.players.length >= MIN_PLAYERS,
      settings: isScreen && s.phase === 'lobby',
      draw: inRound && hostActor && r.step === 'draw',
      redraw: inRound && hostActor && r.step === 'answering' && !r.redrawUsed,
      skipWaiting:
        inRound &&
        hostActor &&
        r.step === 'answering' &&
        r.submissions.length >= 1 &&
        !this._canReveal(),
      reveal:
        inRound &&
        hostActor &&
        ((r.step === 'answering' && this._canReveal()) || r.step === 'revealing'),
      pick: inRound && hostActor && r.step === 'judging',
      next:
        inRound &&
        hostActor &&
        (r.step === 'result' ||
          (r.step === 'answering' && r.submissions.length === 0 && this._answerers().length === 0)),
      submit: inRound && iAnswer && r.step === 'answering' && !mySubmitted && (me?.hand.length ?? 0) > 0,
      retract: inRound && iAnswer && r.step === 'answering' && mySubmitted,
      addCards: Boolean(me) && s.phase !== 'gameOver',
      ready: Boolean(me) && s.phase === 'lobby',
      admin: isScreen,
    };
  }
}

function makeToken() {
  return randomBytes(18).toString('hex');
}

export const GAME_LIMITS = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_NAME_LEN,
  MAX_BOTS,
  ALLOWED_TARGET_SCORES,
  MIN_HAND,
  MAX_HAND,
};
