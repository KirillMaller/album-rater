/**
 * helpers.js — сборка игры для тестов. Не тест-файл (glob берёт только *.test.js).
 */

import { Game } from '../server/game.js';

export const SCREEN = { role: 'screen' };
export const asPlayer = (playerId) => ({ role: 'player', playerId });

/** Детерминированный ГПСЧ, чтобы падающий тест можно было повторить. */
export function seededRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Хранилище-заглушка: база в памяти, ничего не пишет на диск. */
export function fakeStorage(base = { prompts: [], answers: [] }) {
  let current = { prompts: [...base.prompts], answers: [...base.answers] };
  return {
    loadBase: () => ({ prompts: [...current.prompts], answers: [...current.answers] }),
    saveBase: (data) => {
      const toArr = (v) => (Array.isArray(v) ? v : String(v ?? '').split('\n'));
      current = { prompts: toArr(data.prompts), answers: toArr(data.answers) };
    },
    load: () => null,
    save: () => {},
    flush: async () => {},
    clear: async () => {},
  };
}

/** Достаточно большая база, чтобы раздача была полной. */
const pad = (n) => String(n).padStart(4, '0');

export function bigBase(prompts = 40, answers = 400) {
  return {
    // Номер фиксированной ширины: иначе «ответ 4» оказывается подстрокой
    // «ответ 42» и проверки на утечку ложно срабатывают.
    prompts: Array.from({ length: prompts }, (_, i) => `Вопрос ${pad(i)} про ___.`),
    answers: Array.from({ length: answers }, (_, i) => `ответ ${pad(i)}`),
  };
}

/**
 * Игра с N вошедшими игроками, готовая к старту.
 * @returns {{ game: Game, ids: string[], names: string[] }}
 */
export function makeGame({
  players = 4,
  base = bigBase(),
  seed = 7,
  guestCards = 0,
  start = false,
  handSize = 10,
  targetScore = 10,
} = {}) {
  const game = new Game({ storage: fakeStorage(base), rng: seededRng(seed) });
  const names = Array.from({ length: players }, (_, i) => `Игрок${i + 1}`);
  const ids = names.map((name) => {
    const res = game.join({ name });
    if (!res.ok) throw new Error('join не прошёл: ' + res.error);
    return res.playerId;
  });

  for (const id of ids) {
    game.setReady(asPlayer(id), { ready: true });
    for (let i = 0; i < guestCards; i += 1) {
      game.addCard(asPlayer(id), { kind: 'prompt', text: `Личный вопрос ${id.slice(0, 5)}-${i}: ___.` });
      game.addCard(asPlayer(id), { kind: 'answer', text: `личный ответ ${id.slice(0, 5)}-${i}` });
    }
  }

  game.adminSettings(SCREEN, { handSize, targetScore });

  if (start) {
    const res = game.adminStart(SCREEN, {});
    if (!res.ok) throw new Error('старт не прошёл: ' + res.error);
  }
  return { game, ids, names };
}

/** Прогнать раунд до указанного шага. */
export function advanceTo(game, step) {
  const guard = 200;
  for (let i = 0; i < guard; i += 1) {
    const r = game.state.round;
    if (!r || r.step === step) return r;
    const host = asPlayer(r.hostId);

    if (r.step === 'draw') { game.hostDraw(host, { round: r.number }); continue; }
    if (r.step === 'answering') {
      const pending = game.state.players.filter(
        (p) => p.connected && p.id !== r.hostId && p.hand.length > 0 &&
               !r.submissions.some((x) => x.playerId === p.id)
      );
      if (pending.length > 0) {
        game.submitAnswer(asPlayer(pending[0].id), { round: r.number, cardId: pending[0].hand[0] });
        continue;
      }
      game.hostReveal(host, { round: r.number, index: 0 });
      continue;
    }
    if (r.step === 'revealing') { game.hostReveal(host, { round: r.number, index: r.revealedCount }); continue; }
    if (r.step === 'judging') { game.hostPick(host, { round: r.number, submissionId: r.submissions[0].id }); continue; }
    if (r.step === 'result') { game.hostNext(host, { round: r.number }); continue; }
  }
  throw new Error('не удалось дойти до шага ' + step);
}

/** Все снимки, которые в этот момент увидели бы все участники. */
export function allSnapshots(game) {
  const snaps = [{ who: 'screen', snap: game.snapshotFor(SCREEN) }];
  for (const p of game.state.players) {
    snaps.push({ who: p.name, snap: game.snapshotFor(asPlayer(p.id)) });
  }
  return snaps;
}
