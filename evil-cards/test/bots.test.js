/**
 * bots.test.js — 50 полных партий ботами подряд (ТЗ 7) и проверка драйвера
 * на таймерах: он не должен ходить дважды и не должен ходить в чужом раунде.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../server/game.js';
import { createBotDriver, playBotGame } from '../server/bots.js';
import { SCREEN, asPlayer, fakeStorage, bigBase, seededRng } from './helpers.js';

/**
 * Инвариант: каждая карта-ответ лежит ровно в одном месте.
 * Если он нарушится, карты либо размножатся, либо исчезнут — и это надо
 * ловить сразу, а не в разгар праздника.
 */
function checkCardConservation(game, label) {
  const seen = new Map();
  const put = (id, where) => {
    if (seen.has(id)) {
      assert.fail(`${label}: карта ${id} и в «${seen.get(id)}», и в «${where}»`);
    }
    seen.set(id, where);
  };

  for (const p of game.state.players) for (const id of p.hand) put(id, `рука ${p.name}`);
  for (const id of game.state.decks.answers) put(id, 'колода');
  for (const id of game.state.decks.discard) put(id, 'сброс');
  for (const s of game.state.round?.submissions ?? []) put(s.cardId, 'сдан в раунде');

  const allAnswers = Object.values(game.state.cards).filter((c) => c.kind === 'answer');
  assert.equal(
    seen.size,
    allAnswers.length,
    `${label}: карт в обороте ${seen.size}, а всего создано ${allAnswers.length}`
  );

  // Заходы тоже не должны теряться или дублироваться.
  const d = game.state.decks;
  const promptIds = [...d.guestPrompts, ...d.basePrompts, ...d.usedPrompts];
  const current = game.state.round?.promptId;
  const uniquePrompts = new Set(promptIds);
  assert.equal(uniquePrompts.size, promptIds.length, `${label}: заход задвоился в очередях`);
  if (current) {
    assert.equal(uniquePrompts.has(current), false, `${label}: текущий заход всё ещё в очереди`);
  }
}

function makeBotGame(seed) {
  const rng = seededRng(seed);
  const playerCount = 3 + Math.floor(rng() * 10); // 3..12
  const targetScore = [5, 7, 10][Math.floor(rng() * 3)];
  const handSize = 5 + Math.floor(rng() * 8);

  const game = new Game({ storage: fakeStorage(bigBase(30, 500)), rng });
  for (let i = 0; i < playerCount; i += 1) {
    const res = game.join({ name: `Игрок ${i + 1}` });
    assert.equal(res.ok, true, `не вошёл игрок ${i + 1}`);
    game.setReady(asPlayer(res.playerId), { ready: true });
  }
  game.adminSettings(SCREEN, { targetScore, handSize });
  const started = game.adminStart(SCREEN, { force: true });
  assert.equal(started.ok, true, `сид ${seed}: старт не прошёл — ${started.error}`);
  return { game, playerCount, targetScore, handSize };
}

test('50 полных партий ботами подряд без ошибок', () => {
  const stats = { rounds: 0, players: 0 };

  for (let seed = 1; seed <= 50; seed += 1) {
    const { game, playerCount, targetScore } = makeBotGame(seed);
    checkCardConservation(game, `сид ${seed}, до партии`);

    const rounds = playBotGame(game, { rng: seededRng(seed * 31 + 7) });

    assert.equal(game.state.phase, 'gameOver', `сид ${seed}: партия не завершилась`);
    const top = Math.max(...game.state.players.map((p) => p.score));
    assert.equal(top, targetScore, `сид ${seed}: победитель набрал ${top}, а цель ${targetScore}`);
    assert.ok(rounds > 0, `сид ${seed}: не сыграно ни одного раунда`);

    checkCardConservation(game, `сид ${seed}, после партии`);

    // Итоговый снимок должен собираться и содержать победителя.
    const snap = game.snapshotFor(SCREEN);
    assert.equal(snap.phase, 'gameOver');
    assert.ok(snap.gameOver.winnerName, `сид ${seed}: нет имени победителя`);
    assert.equal(snap.gameOver.standings.length, playerCount);
    assert.ok(snap.history.length >= rounds, `сид ${seed}: история короче числа раундов`);

    stats.rounds += rounds;
    stats.players += playerCount;
  }

  assert.ok(stats.rounds > 200, `сыграно подозрительно мало раундов: ${stats.rounds}`);
});

test('партия ботами переживает уходы, возвраты и удаления игроков', () => {
  for (let seed = 101; seed <= 110; seed += 1) {
    const rng = seededRng(seed);
    const { game } = makeBotGame(seed);
    const ids = game.state.players.map((p) => p.id);

    let steps = 0;
    while (game.state.phase === 'round' && steps < 3000) {
      steps += 1;
      const r = game.state.round;

      // Кто-то случайно уходит и возвращается прямо посреди раунда.
      if (rng() < 0.08) {
        const victim = ids[Math.floor(rng() * ids.length)];
        const p = game.getPlayer(victim);
        if (p) game.setConnected(victim, !p.connected);
      }
      // Изредка организатор кого-то удаляет.
      if (rng() < 0.01 && game.state.players.length > 3) {
        const victim = game.state.players[Math.floor(rng() * game.state.players.length)];
        game.adminKick(SCREEN, { playerId: victim.id });
        continue;
      }

      const cur = game.state.round;
      if (!cur) break;
      const host = asPlayer(cur.hostId);

      if (cur.step === 'draw') { game.hostDraw(host, { round: cur.number }); continue; }
      if (cur.step === 'answering') {
        const pending = game.state.players.filter(
          (p) => p.connected && p.id !== cur.hostId && p.hand.length > 0 &&
                 !cur.submissions.some((x) => x.playerId === p.id)
        );
        if (pending.length) {
          const p = pending[0];
          game.submitAnswer(asPlayer(p.id), { round: cur.number, cardId: p.hand[0] });
          continue;
        }
        if (cur.submissions.length === 0) {
          // Все офлайн — раунд надо уметь проскочить, иначе игра встанет.
          const res = game.hostNext(host, { round: cur.number });
          if (!res.ok) {
            // Некому даже проскочить: вернём кого-нибудь в сеть.
            game.setConnected(ids[0], true);
          }
          continue;
        }
        game.hostSkipWaiting(host, { round: cur.number });
        game.hostReveal(host, { round: cur.number, index: 0 });
        continue;
      }
      if (cur.step === 'revealing') {
        game.hostReveal(host, { round: cur.number, index: cur.revealedCount });
        continue;
      }
      if (cur.step === 'judging') {
        game.hostPick(host, { round: cur.number, submissionId: cur.submissions[0].id });
        continue;
      }
      if (cur.step === 'result') { game.hostNext(host, { round: cur.number }); continue; }
      assert.fail(`сид ${seed}: неизвестный шаг ${cur.step}`);
    }

    assert.ok(steps < 3000, `сид ${seed}: партия зависла`);
    checkCardConservation(game, `сид ${seed}, хаос`);
  }
});

test('драйвер ботов на таймерах', async (t) => {
  await t.test('бот-ведущий не ждёт молчуна вечно и доигрывает раунд', async () => {
    const game = new Game({ storage: fakeStorage(bigBase(20, 300)), rng: seededRng(5) });
    const human = game.join({ name: 'Человек' });
    game.setReady(asPlayer(human.playerId), { ready: true });
    game.adminAddBots(SCREEN, { count: 3 });
    game.adminSettings(SCREEN, { targetScore: 5, handSize: 6 });

    // Терпение укорочено, чтобы тест не шёл 25 секунд.
    const driver = createBotDriver({ game, rng: seededRng(9), patienceMs: 400 });
    game.onChange = () => driver.tick();

    assert.equal(game.adminStart(SCREEN, { force: true }).ok, true);
    // Первый ведущий выбирается случайно — нам нужен именно бот-ведущий.
    let guard = 0;
    while (!game.getPlayer(game.state.round.hostId)?.isBot && guard++ < 10) {
      game.adminPassHost(SCREEN);
    }
    assert.equal(game.getPlayer(game.state.round.hostId).isBot, true, 'не нашёлся бот-ведущий');
    driver.tick();

    // Человек не отвечает — боты обязаны доиграть без него.
    const startedAt = Date.now();
    while (game.state.round?.number === 1 && Date.now() - startedAt < 15000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    driver.stop();

    assert.notEqual(
      game.state.round?.number,
      1,
      'бот-ведущий завис в ожидании игрока, который не отвечает'
    );
    checkCardConservation(game, 'после раунда ботов');
  });

  await t.test('таймер, доживший до чужого раунда, ничего не ломает', async () => {
    const game = new Game({ storage: fakeStorage(bigBase(20, 300)), rng: seededRng(21) });
    for (const n of ['А', 'Б', 'В']) {
      const res = game.join({ name: n });
      game.setReady(asPlayer(res.playerId), { ready: true });
    }
    game.adminAddBots(SCREEN, { count: 1 });
    game.adminStart(SCREEN, { force: true });

    const driver = createBotDriver({ game, rng: seededRng(3), patienceMs: 400 });
    driver.tick();

    // Пока бот «думает», раунд насильно уезжает вперёд.
    const before = game.state.round.number;
    game.adminPassHost(SCREEN);
    const r = game.state.round;
    game.hostDraw(asPlayer(r.hostId), { round: r.number });

    await new Promise((res) => setTimeout(res, 3500));
    driver.stop();

    assert.equal(game.state.round.number, before, 'раунд не должен был смениться сам');
    checkCardConservation(game, 'после устаревшего таймера');
  });
});
