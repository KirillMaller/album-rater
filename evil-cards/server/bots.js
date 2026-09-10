/**
 * bots.js — боты для отладки.
 *
 * Нужны, чтобы Кирилл мог проверить игру в одиночку: ноутбук + один телефон + боты.
 * Бот — обычный игрок на сервере: отвечает случайной картой, а когда становится
 * ведущим — сам ведёт раунд. Никакого ИИ, только таймеры (ТЗ 7).
 *
 * Драйвер не хранит своего состояния игры: после каждого изменения он смотрит
 * на актуальный снимок и планирует то, что уместно прямо сейчас. Каждый
 * запланированный шаг перед выполнением ЕЩЁ РАЗ проверяет, что мир не уехал —
 * иначе бот сделает ход в уже закончившемся раунде.
 */

const ANSWER_DELAY = [1000, 3000];   // ответить через 1–3 с
const DRAW_DELAY = [700, 1400];      // подумать перед «Вытянуть вопрос»
const REVEAL_DELAY = 1000;           // вскрывать по одному раз в секунду
const PICK_DELAY = 1200;             // выбрать победителя
const NEXT_DELAY = 3000;             // через 3 с — следующий раунд

/**
 * Сколько бот-ведущий ждёт тех, кто ещё не ответил, прежде чем нажать
 * «Не ждать» самостоятельно. Без этого прогон в одиночку встаёт намертво:
 * у Кирилла сел телефон — и бот ждёт его до конца вечера.
 */
const DEFAULT_PATIENCE = 25000;

export function createBotDriver({ game, rng = Math.random, log = () => {},
                                  patienceMs = DEFAULT_PATIENCE }) {
  /** key -> timeout. Ключ содержит раунд и шаг, поэтому один шаг планируется один раз. */
  const timers = new Map();

  const between = ([min, max]) => min + Math.floor(rng() * (max - min + 1));
  const pickRandom = (arr) => arr[Math.floor(rng() * arr.length)];

  function schedule(key, delay, fn) {
    if (timers.has(key)) return;
    const t = setTimeout(() => {
      timers.delete(key);
      try {
        fn();
      } catch (err) {
        log('[bots] шаг упал: ' + (err?.message ?? err));
      }
    }, delay);
    if (typeof t.unref === 'function') t.unref(); // боты не держат процесс живым
    timers.set(key, t);
  }

  /** Вызывать после каждого изменения состояния. */
  function tick() {
    const s = game.state;
    if (s.phase !== 'round' || !s.round) return;
    if (!s.players.some((p) => p.isBot)) return;

    const r = s.round;
    const round = r.number;
    const host = game.getPlayer(r.hostId);
    const hostIsBot = Boolean(host?.isBot);

    if (r.step === 'draw' && hostIsBot) {
      schedule(`${round}:draw`, between(DRAW_DELAY), () => {
        const cur = game.state.round;
        if (!cur || cur.number !== round || cur.step !== 'draw') return;
        game.hostDraw({ role: 'player', playerId: cur.hostId }, { round });
      });
      return;
    }

    if (r.step === 'answering') {
      // Каждый бот, который ещё не ответил, отвечает случайной картой.
      for (const bot of s.players) {
        if (!bot.isBot || bot.id === r.hostId) continue;
        if (bot.hand.length === 0) continue;
        if (r.submissions.some((x) => x.playerId === bot.id)) continue;

        schedule(`${round}:answer:${bot.id}`, between(ANSWER_DELAY), () => {
          const cur = game.state.round;
          if (!cur || cur.number !== round || cur.step !== 'answering') return;
          const me = game.getPlayer(bot.id);
          if (!me || me.hand.length === 0) return;
          if (cur.submissions.some((x) => x.playerId === me.id)) return;
          game.submitAnswer(
            { role: 'player', playerId: me.id },
            { round, cardId: pickRandom(me.hand) }
          );
        });
      }

      if (hostIsBot) {
        const waitingFor = s.players.filter(
          (p) => p.connected && p.id !== r.hostId && p.hand.length > 0
        ).length;

        const openAnswers = () => {
          const cur = game.state.round;
          if (!cur || cur.number !== round || cur.step !== 'answering') return;
          if (cur.submissions.length === 0) return;
          const host = { role: 'player', playerId: cur.hostId };
          game.hostSkipWaiting(host, { round });   // на случай, если ответили не все
          game.hostReveal(host, { round, index: 0 });
        };

        if (r.submissions.length >= waitingFor && r.submissions.length > 0) {
          // Ответили все — открываем сразу.
          schedule(`${round}:open`, REVEAL_DELAY, openAnswers);
        } else if (r.submissions.length > 0) {
          // Кто-то тормозит: ждём, но не бесконечно.
          schedule(`${round}:impatient`, patienceMs, openAnswers);
        } else if (waitingFor === 0) {
          // Отвечать физически некому — проскакиваем раунд, иначе игра встанет.
          schedule(`${round}:skip`, NEXT_DELAY, () => {
            const cur = game.state.round;
            if (!cur || cur.number !== round || cur.step !== 'answering') return;
            if (cur.submissions.length > 0) return;
            game.hostNext({ role: 'player', playerId: cur.hostId }, { round });
          });
        }
      }
      return;
    }

    if (r.step === 'revealing' && hostIsBot) {
      const index = r.revealedCount;
      // Люди ещё читают — не листаем. Переключит либо их «Прочитал»
      // (через Game.ackRead), либо это же терпение, если кто-то отвлёкся:
      // из-за одного ушедшего игра вставать не должна.
      const revealWait = game.isWaitingForReaders() ? patienceMs : REVEAL_DELAY;
      schedule(`${round}:reveal:${index}`, revealWait, () => {
        const cur = game.state.round;
        if (!cur || cur.number !== round || cur.step !== 'revealing') return;
        if (cur.revealedCount !== index) return;
        game.hostReveal({ role: 'player', playerId: cur.hostId }, { round, index });
      });
      return;
    }

    if (r.step === 'judging' && hostIsBot) {
      // Варианты на столе — даём людям прочитать их все, прежде чем выбирать.
      const pickWait = game.isWaitingForReaders() ? patienceMs : PICK_DELAY;
      schedule(`${round}:pick`, pickWait, () => {
        const cur = game.state.round;
        if (!cur || cur.number !== round || cur.step !== 'judging') return;
        if (cur.submissions.length === 0) return;
        game.hostPick(
          { role: 'player', playerId: cur.hostId },
          { round, submissionId: pickRandom(cur.submissions).id }
        );
      });
      return;
    }

    if (r.step === 'result' && hostIsBot) {
      // Итог раунда — самый важный экран: кто победил и с каким ответом.
      const nextWait = game.isWaitingForReaders() ? patienceMs : NEXT_DELAY;
      schedule(`${round}:next`, nextWait, () => {
        const cur = game.state.round;
        if (!cur || cur.number !== round || cur.step !== 'result') return;
        game.hostNext({ role: 'player', playerId: cur.hostId }, { round });
      });
    }
  }

  /** Снять все таймеры (полный сброс, новая игра, остановка сервера). */
  function stop() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  return { tick, stop, get pending() { return timers.size; } };
}

/**
 * Синхронный прогон партии ботами — для тестов, без таймеров.
 * Возвращает число сыгранных раундов. Бросает, если игра зависла.
 */
export function playBotGame(game, { rng = Math.random, maxSteps = 5000 } = {}) {
  const pickRandom = (arr) => arr[Math.floor(rng() * arr.length)];
  let steps = 0;
  let rounds = 0;

  while (game.state.phase === 'round' && steps < maxSteps) {
    steps += 1;
    const r = game.state.round;
    const host = { role: 'player', playerId: r.hostId };

    if (r.step === 'draw') {
      const res = game.hostDraw(host, { round: r.number });
      if (!res.ok && !res.stale) throw new Error('бот не смог вытянуть вопрос: ' + res.error);
      continue;
    }

    if (r.step === 'answering') {
      const pending = game.state.players.filter(
        (p) => p.connected && p.id !== r.hostId && p.hand.length > 0 &&
               !r.submissions.some((x) => x.playerId === p.id)
      );
      if (pending.length > 0) {
        const p = pending[0];
        game.submitAnswer({ role: 'player', playerId: p.id }, {
          round: r.number,
          cardId: pickRandom(p.hand),
        });
        continue;
      }
      if (r.submissions.length === 0) {
        // Отвечать некому — проскакиваем раунд, иначе партия встанет.
        const res = game.hostNext(host, { round: r.number });
        if (!res.ok && !res.stale) throw new Error('партия встала на пустом раунде');
        continue;
      }
      const res = game.hostReveal(host, { round: r.number, index: 0 });
      if (!res.ok && !res.stale) throw new Error('не открылись ответы: ' + res.error);
      continue;
    }

    if (r.step === 'revealing') {
      game.hostReveal(host, { round: r.number, index: r.revealedCount });
      continue;
    }

    if (r.step === 'judging') {
      game.hostPick(host, {
        round: r.number,
        submissionId: pickRandom(r.submissions).id,
      });
      continue;
    }

    if (r.step === 'result') {
      rounds += 1;
      game.hostNext(host, { round: r.number });
      continue;
    }

    throw new Error('неизвестный шаг раунда: ' + r.step);
  }

  if (steps >= maxSteps) throw new Error('партия не закончилась за ' + maxSteps + ' шагов');
  return rounds;
}
