/**
 * game.test.js — правила игры, крайние случаи и защита секретов.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../server/game.js';
import {
  SCREEN, asPlayer, makeGame, advanceTo, allSnapshots,
  fakeStorage, bigBase, seededRng, assertCardsIntact,
} from './helpers.js';

// ==========================================================================
test('вход по имени', async (t) => {
  await t.test('пустое имя не принимается', () => {
    const game = new Game({ storage: fakeStorage() });
    assert.equal(game.join({ name: '   ' }).ok, false);
  });

  await t.test('имя длиннее 20 символов не принимается', () => {
    const game = new Game({ storage: fakeStorage() });
    const res = game.join({ name: 'а'.repeat(21) });
    assert.equal(res.ok, false);
    assert.match(res.error, /длиннее/);
  });

  await t.test('занятое имя игрока в сети — просто ошибка', () => {
    const game = new Game({ storage: fakeStorage() });
    game.join({ name: 'Оля' });
    const res = game.join({ name: 'оля' }); // регистр не спасает
    assert.equal(res.ok, false);
    assert.equal(res.canClaim, undefined);
  });

  await t.test('имя игрока не в сети предлагает вернуться в игру', () => {
    const game = new Game({ storage: fakeStorage() });
    const first = game.join({ name: 'Оля' });
    game.setConnected(first.playerId, false);
    const res = game.join({ name: 'Оля' });
    assert.equal(res.ok, false);
    assert.equal(res.canClaim, first.playerId);
    assert.equal(res.claimName, 'Оля');
  });
});

// ==========================================================================
test('переподключение', async (t) => {
  await t.test('возврат по токену отдаёт того же игрока со всем состоянием', () => {
    const { game, ids } = makeGame({ players: 3, start: true });
    const player = game.getPlayer(ids[0]);
    const handBefore = [...player.hand];
    player.score = 4;

    game.setConnected(ids[0], false);
    const res = game.resume({ token: player.token });

    assert.equal(res.ok, true);
    assert.equal(res.playerId, ids[0]);
    assert.equal(game.getPlayer(ids[0]).connected, true);
    assert.deepEqual(game.getPlayer(ids[0]).hand, handBefore);
    assert.equal(game.getPlayer(ids[0]).score, 4);
  });

  await t.test('чужой токен не пускает', () => {
    const { game } = makeGame({ players: 3 });
    assert.equal(game.resume({ token: 'нетакого' }).ok, false);
    assert.equal(game.resume({ token: undefined }).ok, false);
  });

  await t.test('claim работает только для игрока не в сети и меняет токен', () => {
    const { game, ids } = makeGame({ players: 3 });
    const old = game.getPlayer(ids[0]).token;

    assert.equal(game.claim({ playerId: ids[0] }).ok, false, 'в сети — нельзя');

    game.setConnected(ids[0], false);
    const res = game.claim({ playerId: ids[0] });
    assert.equal(res.ok, true);
    assert.notEqual(res.token, old, 'токен должен обновиться');
    assert.equal(game.resume({ token: old }).ok, false, 'старый токен больше не работает');
  });
});

// ==========================================================================
test('карты игроков', async (t) => {
  await t.test('точный дубль без учёта регистра не принимается', () => {
    const { game, ids } = makeGame({ players: 3 });
    const a = asPlayer(ids[0]);
    assert.equal(game.addCard(a, { kind: 'answer', text: 'ночной дожор' }).ok, true);
    assert.equal(game.addCard(a, { kind: 'answer', text: 'Ночной  Дожор' }).ok, false);
  });

  await t.test('вопрос с двумя пропусками не принимается', () => {
    const { game, ids } = makeGame({ players: 3 });
    const res = game.addCard(asPlayer(ids[0]), { kind: 'prompt', text: '___ и ещё ___.' });
    assert.equal(res.ok, false);
  });

  await t.test('чужую карту не поправить и не удалить', () => {
    const { game, ids } = makeGame({ players: 3 });
    const card = game.addCard(asPlayer(ids[0]), { kind: 'answer', text: 'моя карта' });
    assert.equal(game.editCard(asPlayer(ids[1]), { cardId: card.cardId, text: 'чужая правка' }).ok, false);
    assert.equal(game.deleteCard(asPlayer(ids[1]), { cardId: card.cardId }).ok, false);
  });

  await t.test('карта, написанная посреди игры, сразу попадает в колоду', () => {
    const { game, ids } = makeGame({ players: 3, start: true });
    const before = game.state.decks.answers.length;
    const res = game.addCard(asPlayer(ids[0]), { kind: 'answer', text: 'свежий ответ посреди игры' });
    assert.equal(res.ok, true);
    assert.equal(game.state.decks.answers.length, before + 1);
    assert.ok(game.state.decks.answers.includes(res.cardId));
  });

  await t.test('сданный в раунде ответ нельзя удалить', () => {
    const { game, ids } = makeGame({ players: 3, start: true });
    const r = game.state.round;
    game.hostDraw(asPlayer(r.hostId), { round: r.number });
    const me = game.state.players.find((p) => p.id !== r.hostId);
    const cardId = me.hand[0];
    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId });
    // Карта из базы — автор null, но проверим на своей карте.
    const own = game.addCard(asPlayer(me.id), { kind: 'answer', text: 'карта для проверки занятости' });
    game.retractAnswer(asPlayer(me.id), { round: r.number });
    const p = game.getPlayer(me.id);
    p.hand.push(own.cardId);
    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId: own.cardId });
    assert.equal(game.deleteCard(asPlayer(me.id), { cardId: own.cardId }).ok, false);
  });
});

// ==========================================================================
test('старт игры', async (t) => {
  await t.test('меньше трёх игроков — не стартуем', () => {
    const { game } = makeGame({ players: 2 });
    const res = game.adminStart(SCREEN, {});
    assert.equal(res.ok, false);
    assert.match(res.error, /хотя бы 3/);
  });

  await t.test('нет ни одного вопроса — понятная ошибка', () => {
    const game = new Game({ storage: fakeStorage({ prompts: [], answers: ['раз', 'два'] }) });
    for (const n of ['А', 'Б', 'В']) {
      const r = game.join({ name: n });
      game.setReady(asPlayer(r.playerId), { ready: true });
    }
    const res = game.adminStart(SCREEN, {});
    assert.equal(res.ok, false);
    assert.match(res.error, /Нет ни одного вопроса/);
  });

  await t.test('не все готовы — отдельное подтверждение', () => {
    const { game, ids } = makeGame({ players: 3 });
    game.setReady(asPlayer(ids[0]), { ready: false });
    const res = game.adminStart(SCREEN, {});
    assert.equal(res.ok, false);
    assert.equal(res.needConfirm, 'notReady');
    assert.equal(game.adminStart(SCREEN, { confirmNotReady: true }).ok, true);
  });

  await t.test('мало ответов — своё подтверждение, не смешивается с «не готовы»', () => {
    const base = { prompts: ['Вопрос: ___.'], answers: ['раз', 'два', 'три'] };
    const game = new Game({ storage: fakeStorage(base) });
    for (const n of ['А', 'Б', 'В']) {
      const r = game.join({ name: n });
      game.setReady(asPlayer(r.playerId), { ready: true });
    }
    const res = game.adminStart(SCREEN, {});
    assert.equal(res.needConfirm, 'fewAnswers');
    // Подтверждение «не готовы» НЕ должно проглатывать вопрос про карты.
    assert.equal(game.adminStart(SCREEN, { confirmNotReady: true }).needConfirm, 'fewAnswers');
    assert.equal(game.adminStart(SCREEN, { confirmFewAnswers: true }).ok, true);
  });

  await t.test('семь игроков получают по 10 карт', () => {
    const { game } = makeGame({ players: 7, start: true, handSize: 10 });
    for (const p of game.state.players) assert.equal(p.hand.length, 10);
    assert.equal(game.state.phase, 'round');
    assert.equal(game.state.round.number, 1);
  });

  await t.test('гостевые вопросы тянутся раньше базовых', () => {
    const { game, ids } = makeGame({ players: 3, guestCards: 2 });
    game.adminStart(SCREEN, {});
    const r = game.state.round;
    game.hostDraw(asPlayer(r.hostId), { round: r.number });
    const card = game.state.cards[game.state.round.promptId];
    assert.ok(ids.includes(card.authorId), 'первым должен идти гостевой вопрос');
  });

  await t.test('база читается в момент старта, а не при запуске сервера', () => {
    const storage = fakeStorage({ prompts: [], answers: [] });
    const game = new Game({ storage });
    for (const n of ['А', 'Б', 'В']) {
      const r = game.join({ name: n });
      game.setReady(asPlayer(r.playerId), { ready: true });
    }
    assert.equal(game.adminStart(SCREEN, { force: true }).ok, false, 'пока база пуста — вопросов нет');
    storage.saveBase({ prompts: 'Свежий вопрос: ___.', answers: 'свежий ответ' });
    assert.equal(game.adminStart(SCREEN, { force: true }).ok, true, 'база подхватилась без перезапуска');
  });
});

// ==========================================================================
test('раунд', async (t) => {
  await t.test('полный проход: заход → ответы → вскрытие → выбор → очко → добор', () => {
    const { game } = makeGame({ players: 4, start: true, handSize: 10 });
    const r = game.state.round;
    const host = asPlayer(r.hostId);

    assert.equal(r.step, 'draw');
    assert.equal(game.hostDraw(host, { round: r.number }).ok, true);
    assert.equal(game.state.round.step, 'answering');

    const answerers = game.state.players.filter((p) => p.id !== r.hostId);
    for (const p of answerers) {
      assert.equal(game.submitAnswer(asPlayer(p.id), { round: r.number, cardId: p.hand[0] }).ok, true);
      assert.equal(game.getPlayer(p.id).hand.length, 9, 'сданная карта уходит из руки');
    }

    assert.equal(game.hostReveal(host, { round: r.number, index: 0 }).ok, true);
    assert.equal(game.state.round.revealedCount, 1);
    while (game.state.round.step === 'revealing') {
      game.hostReveal(host, { round: r.number, index: game.state.round.revealedCount });
    }
    assert.equal(game.state.round.step, 'judging');
    assert.equal(game.state.round.revealedCount, 3);

    const winnerSub = game.state.round.submissions[1];
    assert.equal(game.hostPick(host, { round: r.number, submissionId: winnerSub.id }).ok, true);
    assert.equal(game.state.round.step, 'result');
    assert.equal(game.getPlayer(winnerSub.playerId).score, 1);

    for (const p of game.state.players) {
      assert.equal(p.hand.length, 10, 'после выбора руки добраны');
    }

    assert.equal(game.hostNext(host, { round: r.number }).ok, true);
    assert.equal(game.state.round.number, 2);
    assert.notEqual(game.state.round.hostId, r.hostId, 'ведущий сменился');
  });

  await t.test('ведущий не может отвечать', () => {
    const { game } = makeGame({ players: 3, start: true });
    const r = advanceTo(game, 'answering');
    const host = game.getPlayer(r.hostId);
    const res = game.submitAnswer(asPlayer(host.id), { round: r.number, cardId: host.hand[0] });
    assert.equal(res.ok, false);
  });

  await t.test('ответ можно забрать до вскрытия и нельзя после', () => {
    const { game } = makeGame({ players: 3, start: true });
    const r = advanceTo(game, 'answering');
    const me = game.state.players.find((p) => p.id !== r.hostId);
    const cardId = me.hand[0];

    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId });
    assert.equal(game.retractAnswer(asPlayer(me.id), { round: r.number }).ok, true);
    assert.ok(game.getPlayer(me.id).hand.includes(cardId), 'карта вернулась в руку');

    // Отвечают все и вскрываем.
    for (const p of game.state.players.filter((x) => x.id !== r.hostId)) {
      game.submitAnswer(asPlayer(p.id), { round: r.number, cardId: p.hand[0] });
    }
    game.hostReveal(asPlayer(r.hostId), { round: r.number, index: 0 });
    assert.equal(game.retractAnswer(asPlayer(me.id), { round: r.number }).ok, false);
  });

  await t.test('«Другой вопрос» доступен один раз и возвращает сданные ответы', () => {
    const { game } = makeGame({ players: 3, start: true });
    const r = advanceTo(game, 'answering');
    const host = asPlayer(r.hostId);
    const first = game.state.round.promptId;

    const me = game.state.players.find((p) => p.id !== r.hostId);
    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId: me.hand[0] });
    const handBefore = game.getPlayer(me.id).hand.length;

    assert.equal(game.hostRedraw(host, { round: r.number }).ok, true);
    assert.notEqual(game.state.round.promptId, first, 'вопрос сменился');
    assert.equal(game.state.round.submissions.length, 0, 'ответы сняты');
    assert.equal(game.getPlayer(me.id).hand.length, handBefore + 1, 'карта вернулась');

    assert.equal(game.hostRedraw(host, { round: r.number }).ok, false, 'второй раз нельзя');
  });

  await t.test('«Не ждать» открывает вскрытие при хотя бы одном ответе', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');
    const host = asPlayer(r.hostId);

    assert.equal(game.hostSkipWaiting(host, { round: r.number }).ok, false, 'ответов ещё нет');
    assert.equal(game.hostReveal(host, { round: r.number, index: 0 }).ok, false, 'ещё не все ответили');

    const me = game.state.players.find((p) => p.id !== r.hostId);
    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId: me.hand[0] });

    assert.equal(game.hostSkipWaiting(host, { round: r.number }).ok, true);
    assert.equal(game.hostReveal(host, { round: r.number, index: 0 }).ok, true);
  });

  await t.test('игра заканчивается на цели по очкам', () => {
    const { game } = makeGame({ players: 3, start: true, targetScore: 5 });
    let guard = 0;
    while (game.state.phase === 'round' && guard++ < 500) {
      const r = game.state.round;
      const host = asPlayer(r.hostId);
      if (r.step === 'draw') { game.hostDraw(host, { round: r.number }); continue; }
      if (r.step === 'answering') {
        const pending = game.state.players.filter(
          (p) => p.id !== r.hostId && !r.submissions.some((x) => x.playerId === p.id) && p.hand.length
        );
        if (pending.length) {
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
    assert.equal(game.state.phase, 'gameOver');
    const top = Math.max(...game.state.players.map((p) => p.score));
    assert.equal(top, 5);
    const snap = game.snapshotFor(SCREEN);
    assert.ok(snap.gameOver.winnerName);
    assert.equal(snap.gameOver.standings.length, 3);
  });
});

// ==========================================================================
test('двойные нажатия и устаревшие действия', async (t) => {
  await t.test('двойной тап «Следующий ответ» не вскрывает две карты', () => {
    const { game } = makeGame({ players: 5, start: true });
    const r = advanceTo(game, 'revealing');
    const host = asPlayer(r.hostId);
    const index = game.state.round.revealedCount;

    assert.equal(game.hostReveal(host, { round: r.number, index }).ok, true);
    const after = game.state.round.revealedCount;

    // Второй тап приходит с тем же index — он устарел.
    const again = game.hostReveal(host, { round: r.number, index });
    assert.equal(again.ok, false);
    assert.equal(again.stale, true, 'устаревшее действие гасится тихо, без тоста');
    assert.equal(game.state.round.revealedCount, after);
  });

  await t.test('действие из прошлого раунда игнорируется', () => {
    const { game } = makeGame({ players: 3, start: true });
    const r = advanceTo(game, 'result');
    const host = asPlayer(r.hostId);
    game.hostNext(host, { round: r.number });

    const res = game.hostNext(host, { round: r.number });
    assert.equal(res.ok, false);
    assert.equal(res.stale, true);
    assert.equal(game.state.round.number, 2, 'раунд не проскочил дважды');
  });

  await t.test('двойной «Выбрать победителем» не даёт два очка', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'judging');
    const host = asPlayer(r.hostId);
    const sub = game.state.round.submissions[0];

    game.hostPick(host, { round: r.number, submissionId: sub.id });
    const scoreAfter = game.getPlayer(sub.playerId).score;
    const again = game.hostPick(host, { round: r.number, submissionId: sub.id });

    assert.equal(again.ok, false);
    assert.equal(game.getPlayer(sub.playerId).score, scoreAfter);
  });

  await t.test('второй ответ от того же игрока не принимается', () => {
    const { game } = makeGame({ players: 3, start: true });
    const r = advanceTo(game, 'answering');
    const me = game.state.players.find((p) => p.id !== r.hostId);
    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId: me.hand[0] });
    const res = game.submitAnswer(asPlayer(me.id), {
      round: r.number,
      cardId: game.getPlayer(me.id).hand[0],
    });
    assert.equal(res.ok, false);
  });
});

// ==========================================================================
test('секреты не утекают', async (t) => {
  await t.test('авторства ответов нет ни в одном снимке до выбора победителя', () => {
    const { game } = makeGame({ players: 5, start: true });
    const r = advanceTo(game, 'answering');

    for (const p of game.state.players.filter((x) => x.id !== r.hostId)) {
      game.submitAnswer(asPlayer(p.id), { round: r.number, cardId: p.hand[0] });
    }

    const host = asPlayer(r.hostId);
    for (const step of ['answering', 'revealing', 'judging']) {
      if (game.state.round.step !== step) {
        if (step === 'revealing') game.hostReveal(host, { round: r.number, index: 0 });
        if (step === 'judging') {
          while (game.state.round.step === 'revealing') {
            game.hostReveal(host, { round: r.number, index: game.state.round.revealedCount });
          }
        }
      }
      for (const { who, snap } of allSnapshots(game)) {
        assert.equal(snap.round.winner, null, `${who}: победитель виден на шаге ${step}`);
        for (const rev of snap.round.reveals) {
          assert.equal(rev.authorName, null, `${who}: автор виден на шаге ${step}`);
        }
      }
    }

    // И только после выбора авторство появляется.
    const sub = game.state.round.submissions[0];
    game.hostPick(host, { round: r.number, submissionId: sub.id });
    const snap = game.snapshotFor(SCREEN);
    assert.equal(snap.round.reveals.every((x) => typeof x.authorName === 'string'), true);
    assert.equal(snap.round.winner.authorName, game.getPlayer(sub.playerId).name);
  });

  await t.test('сданные карты не видны в снимках до вскрытия', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');

    const submitted = [];
    for (const p of game.state.players.filter((x) => x.id !== r.hostId)) {
      const cardId = p.hand[0];
      submitted.push({ playerId: p.id, cardId, text: game.state.cards[cardId].text });
      game.submitAnswer(asPlayer(p.id), { round: r.number, cardId });
    }

    for (const { who, snap } of allSnapshots(game)) {
      const json = JSON.stringify(snap);
      for (const s of submitted) {
        // Свой собственный ответ игрок видеть обязан — остальные нет.
        if (snap.you && snap.you.id === s.playerId) continue;
        assert.equal(json.includes(s.cardId), false, `${who} видит id чужого ответа`);
        assert.equal(json.includes(s.text), false, `${who} видит текст чужого ответа`);
      }
    }
  });

  await t.test('чужая рука не попадает в снимок никогда', () => {
    const { game, ids } = makeGame({ players: 4, start: true });
    const victim = game.getPlayer(ids[1]);
    const secret = victim.hand.map((id) => game.state.cards[id].text);

    const snapScreen = JSON.stringify(game.snapshotFor(SCREEN));
    const snapOther = JSON.stringify(game.snapshotFor(asPlayer(ids[0])));

    for (const text of secret) {
      assert.equal(snapScreen.includes(text), false, 'ноутбук видит чужую руку');
      assert.equal(snapOther.includes(text), false, 'игрок видит чужую руку');
    }
    // А сам владелец — видит.
    assert.equal(JSON.stringify(game.snapshotFor(asPlayer(ids[1]))).includes(secret[0]), true);
  });

  await t.test('токены игроков не попадают в снимки', () => {
    const { game, ids } = makeGame({ players: 3, start: true });
    const tokens = game.state.players.map((p) => p.token);
    for (const { who, snap } of allSnapshots(game)) {
      const json = JSON.stringify(snap);
      for (const tk of tokens) {
        assert.equal(json.includes(tk), false, `${who} видит чужой токен`);
      }
    }
    assert.ok(ids.length);
  });

  await t.test('порядок вскрытия не совпадает с порядком отправки', () => {
    // На 8 ответах совпадение случайно возможно, поэтому проверяем на серии.
    let differed = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const { game } = makeGame({ players: 8, start: true, seed });
      const r = advanceTo(game, 'answering');
      for (const p of game.state.players.filter((x) => x.id !== r.hostId)) {
        game.submitAnswer(asPlayer(p.id), { round: r.number, cardId: p.hand[0] });
      }
      game.hostReveal(asPlayer(r.hostId), { round: r.number, index: 0 });
      const submitOrder = game.state.round.submissions.map((s) => s.id).join(',');
      const revealOrder = game.state.round.revealOrder.join(',');
      if (submitOrder !== revealOrder) differed += 1;
    }
    assert.ok(differed >= 18, `порядок вскрытия должен быть случайным, совпал ${20 - differed} раз из 20`);
  });
});

// ==========================================================================
test('крайние случаи из раздела 6 ТЗ', async (t) => {
  await t.test('отключившегося не ждём, вернувшийся до вскрытия успевает ответить', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');
    const others = game.state.players.filter((p) => p.id !== r.hostId);
    const sleeper = others[0];

    game.setConnected(sleeper.id, false);
    for (const p of others.slice(1)) {
      game.submitAnswer(asPlayer(p.id), { round: r.number, cardId: p.hand[0] });
    }
    let snap = game.snapshotFor(SCREEN);
    assert.equal(snap.round.expected, 2, 'офлайн игрок не считается');
    assert.equal(snap.can.reveal, true, 'можно вскрывать, не дожидаясь спящего');

    game.setConnected(sleeper.id, true);
    snap = game.snapshotFor(SCREEN);
    assert.equal(snap.round.expected, 3, 'вернулся — снова ждём');
    assert.equal(
      game.submitAnswer(asPlayer(sleeper.id), { round: r.number, cardId: sleeper.hand[0] }).ok,
      true
    );
  });

  await t.test('ноутбук может нажать за отключившегося ведущего', () => {
    const { game } = makeGame({ players: 3, start: true });
    const r = game.state.round;
    game.setConnected(r.hostId, false);
    assert.equal(game.hostDraw(SCREEN, { round: r.number }).ok, true);
    assert.equal(game.state.round.step, 'answering');
  });

  await t.test('«Передать ход следующему» меняет ведущего и откатывает раунд', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');
    const oldHost = r.hostId;
    const me = game.state.players.find((p) => p.id !== oldHost);
    game.submitAnswer(asPlayer(me.id), { round: r.number, cardId: me.hand[0] });
    const handBefore = game.getPlayer(me.id).hand.length;

    assert.equal(game.adminPassHost(SCREEN).ok, true);
    assert.notEqual(game.state.round.hostId, oldHost);
    assert.equal(game.state.round.step, 'draw');
    assert.equal(game.state.round.submissions.length, 0);
    assert.equal(game.getPlayer(me.id).hand.length, handBefore + 1, 'карта вернулась в руку');
  });

  await t.test('выбор следующего ведущего пропускает тех, кто не в сети', () => {
    const { game, ids } = makeGame({ players: 4, start: true });
    const order = game.state.hostOrder;
    const cursor = game.state.hostCursor;
    const nextId = order[(cursor + 1) % order.length];
    game.setConnected(nextId, false);

    const r = advanceTo(game, 'result');
    game.hostNext(asPlayer(r.hostId), { round: r.number });
    assert.notEqual(game.state.round.hostId, nextId, 'офлайн игрок пропущен');
    assert.ok(ids.includes(game.state.round.hostId));
  });

  await t.test('опоздавший получает руку и встаёт в конец очереди ведущих', () => {
    const { game } = makeGame({ players: 3, start: true, handSize: 10 });
    const res = game.join({ name: 'Опоздун' });
    assert.equal(res.ok, true);
    const late = game.getPlayer(res.playerId);
    assert.equal(late.hand.length, 10, 'рука выдана сразу');
    assert.equal(game.state.hostOrder.at(-1), late.id, 'в конец очереди ведущих');

    // И может ответить в текущем раунде.
    const r = advanceTo(game, 'answering');
    if (r.hostId !== late.id) {
      assert.equal(game.submitAnswer(asPlayer(late.id), { round: r.number, cardId: late.hand[0] }).ok, true);
    }
  });

  await t.test('удалённый игрок: рука в сброс, ответ снят, его карты остаются', () => {
    const { game, ids } = makeGame({ players: 4, start: true, guestCards: 2 });
    const r = advanceTo(game, 'answering');
    const victim = game.state.players.find((p) => p.id !== r.hostId);
    game.submitAnswer(asPlayer(victim.id), { round: r.number, cardId: victim.hand[0] });

    const authored = Object.values(game.state.cards).filter((c) => c.authorId === victim.id).length;
    const discardBefore = game.state.decks.discard.length;
    const handSize = game.getPlayer(victim.id).hand.length;

    assert.equal(game.adminKick(SCREEN, { playerId: victim.id }).ok, true);
    assert.equal(game.getPlayer(victim.id), null, 'игрок удалён');
    assert.equal(game.state.round.submissions.some((s) => s.playerId === victim.id), false, 'ответ снят');
    // В сброс уходит и рука, и снятая с раунда сданная карта — иначе она
    // не вернётся никуда и просто исчезнет из игры.
    assert.equal(
      game.state.decks.discard.length,
      discardBefore + handSize + 1,
      'рука и снятый ответ ушли в сброс'
    );
    assert.equal(
      Object.values(game.state.cards).filter((c) => c.authorId === victim.id).length,
      authored,
      'написанные им карты остались в игре'
    );
    assert.equal(game.state.hostOrder.includes(victim.id), false);
    assert.ok(ids.length);
  });

  await t.test('удаление ведущего передаёт ход дальше', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');
    const oldHost = r.hostId;
    assert.equal(game.adminKick(SCREEN, { playerId: oldHost }).ok, true);
    assert.notEqual(game.state.round.hostId, oldHost);
    assert.equal(game.state.round.step, 'draw');
  });

  await t.test('карты кончились — раздаём сколько есть и предупреждаем, не падаем', () => {
    const base = {
      prompts: ['Вопрос: ___.', 'Другой вопрос: ___.'],
      answers: Array.from({ length: 12 }, (_, i) => `ответ ${i}`),
    };
    const game = new Game({ storage: fakeStorage(base), rng: seededRng(3) });
    for (const n of ['А', 'Б', 'В']) {
      const res = game.join({ name: n });
      game.setReady(asPlayer(res.playerId), { ready: true });
    }
    assert.equal(game.adminStart(SCREEN, { force: true }).ok, true);
    const total = game.state.players.reduce((sum, p) => sum + p.hand.length, 0);
    assert.equal(total, 12, 'роздано ровно столько, сколько было');
    assert.ok(game.snapshotFor(SCREEN).warnings.length > 0, 'организатор предупреждён');

    // И партия всё равно доигрывается без исключений.
    let guard = 0;
    while (game.state.phase === 'round' && guard++ < 200) {
      const r = game.state.round;
      const host = asPlayer(r.hostId);
      if (r.step === 'draw') { game.hostDraw(host, { round: r.number }); continue; }
      if (r.step === 'answering') {
        const pending = game.state.players.filter(
          (p) => p.id !== r.hostId && p.hand.length && !r.submissions.some((x) => x.playerId === p.id)
        );
        if (pending.length) {
          game.submitAnswer(asPlayer(pending[0].id), { round: r.number, cardId: pending[0].hand[0] });
          continue;
        }
        if (r.submissions.length === 0) { game.hostNext(host, { round: r.number }); continue; }
        game.hostReveal(host, { round: r.number, index: 0 });
        continue;
      }
      if (r.step === 'revealing') { game.hostReveal(host, { round: r.number, index: r.revealedCount }); continue; }
      if (r.step === 'judging') { game.hostPick(host, { round: r.number, submissionId: r.submissions[0].id }); continue; }
      if (r.step === 'result') { game.hostNext(host, { round: r.number }); continue; }
    }
    assert.ok(guard < 200, 'партия не должна зависать при нехватке карт');
  });

  await t.test('вопросы кончились — идут по второму кругу, а не ломаются', () => {
    const base = { prompts: ['Единственный вопрос: ___.'], answers: bigBase().answers };
    const game = new Game({ storage: fakeStorage(base), rng: seededRng(11) });
    for (const n of ['А', 'Б', 'В']) {
      const res = game.join({ name: n });
      game.setReady(asPlayer(res.playerId), { ready: true });
    }
    game.adminStart(SCREEN, { force: true });
    for (let i = 0; i < 3; i += 1) {
      const r = advanceTo(game, 'result');
      assert.equal(typeof game.state.round.promptId, 'string', 'вопрос вытянулся');
      game.hostNext(asPlayer(r.hostId), { round: r.number });
    }
    assert.equal(game.state.phase, 'round');
  });
});

// ==========================================================================
test('сохранение и восстановление', async (t) => {
  await t.test('перезапуск посреди раунда продолжает игру с того же места', () => {
    const { game, ids } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'revealing');
    const saved = JSON.parse(JSON.stringify(game.state));

    const revived = new Game({ storage: fakeStorage(bigBase()) });
    assert.equal(revived.restore(saved), true);

    assert.equal(revived.state.phase, 'round');
    assert.equal(revived.state.round.number, r.number);
    assert.equal(revived.state.round.step, 'revealing');
    assert.equal(revived.state.round.promptId, r.promptId);
    assert.equal(revived.state.round.revealedCount, game.state.round.revealedCount);
    assert.deepEqual(
      revived.getPlayer(ids[0]).hand,
      game.getPlayer(ids[0]).hand,
      'рука сохранилась'
    );

    // Игрок возвращается по своему старому токену.
    const token = game.getPlayer(ids[0]).token;
    assert.equal(revived.resume({ token }).ok, true);
  });

  await t.test('после перезапуска все считаются не в сети, пока не вернулись', () => {
    const { game } = makeGame({ players: 3, start: true });
    const saved = JSON.parse(JSON.stringify(game.state));
    const revived = new Game({ storage: fakeStorage(bigBase()) });
    revived.restore(saved);
    assert.equal(revived.state.players.every((p) => !p.connected), true);
  });

  await t.test('битое состояние не роняет игру', () => {
    const game = new Game({ storage: fakeStorage() });
    assert.equal(game.restore(null), false);
    assert.equal(game.restore({ v: 999 }), false);
    assert.equal(game.restore({ v: 1, phase: 'мусор', players: 'нет' }), true);
    assert.equal(game.state.phase, 'lobby');
    assert.deepEqual(game.state.players, []);
  });

  await t.test('карты, пропавшие из cards, не ломают руки и колоды', () => {
    const { game } = makeGame({ players: 3, start: true });
    const saved = JSON.parse(JSON.stringify(game.state));
    const someId = saved.players[0].hand[0];
    delete saved.cards[someId];

    const revived = new Game({ storage: fakeStorage(bigBase()) });
    assert.equal(revived.restore(saved), true);
    assert.equal(revived.state.players[0].hand.includes(someId), false);
  });
});

// ==========================================================================
test('панель организатора', async (t) => {
  await t.test('игрок не может дёргать админские действия', () => {
    const { game, ids } = makeGame({ players: 3 });
    const me = asPlayer(ids[0]);
    assert.equal(game.adminStart(me, {}).ok, false);
    assert.equal(game.adminKick(me, { playerId: ids[1] }).ok, false);
    assert.equal(game.adminReset(me).ok, false);
    assert.equal(game.adminAddBots(me, { count: 2 }).ok, false);
    assert.equal(game.adminSaveBase(me, { prompts: 'х', answers: 'у' }).ok, false);
  });

  await t.test('«Новая игра»: очки в ноль, игроки и карты на месте', () => {
    const { game, ids } = makeGame({ players: 4, start: true, guestCards: 2 });
    const r = advanceTo(game, 'result');
    game.hostNext(asPlayer(r.hostId), { round: r.number });
    game.getPlayer(ids[0]).score = 3;
    const cardsBefore = Object.values(game.state.cards).filter((c) => c.authorId).length;

    assert.equal(game.adminNewGame(SCREEN).ok, true);
    assert.equal(game.state.phase, 'round');
    assert.equal(game.state.round.number, 1);
    assert.equal(game.state.players.every((p) => p.score === 0), true);
    assert.equal(game.state.players.length, 4);
    assert.equal(Object.values(game.state.cards).filter((c) => c.authorId).length, cardsBefore);
    assert.ok(game.snapshotFor(SCREEN).history.length > 0, '«Лучшее за вечер» переживает новую игру');
  });

  await t.test('полный сброс очищает всё', () => {
    const { game } = makeGame({ players: 4, start: true });
    assert.equal(game.adminReset(SCREEN).ok, true);
    assert.equal(game.state.phase, 'lobby');
    assert.deepEqual(game.state.players, []);
    assert.deepEqual(game.state.cards, {});
    assert.equal(game.state.round, null);
  });

  await t.test('настройки меняются только до старта и в допустимых границах', () => {
    const { game } = makeGame({ players: 3 });
    game.adminSettings(SCREEN, { targetScore: 7, handSize: 8 });
    assert.equal(game.state.settings.targetScore, 7);
    assert.equal(game.state.settings.handSize, 8);

    game.adminSettings(SCREEN, { targetScore: 999, handSize: 999 });
    assert.equal(game.state.settings.targetScore, 10, 'недопустимая цель → 10');
    assert.equal(game.state.settings.handSize, 15, 'размер руки ограничен сверху');

    game.adminStart(SCREEN, {});
    assert.equal(game.adminSettings(SCREEN, { targetScore: 5 }).ok, false);
  });

  await t.test('боты добавляются, пишут карты и играют', () => {
    const game = new Game({ storage: fakeStorage({ prompts: [], answers: [] }),
                            fixtures: { prompts: ['Заглушка: ___.'], answers: ['раз', 'два', 'три'] } });
    for (const n of ['А', 'Б']) {
      const res = game.join({ name: n });
      game.setReady(asPlayer(res.playerId), { ready: true });
    }
    assert.equal(game.adminAddBots(SCREEN, { count: 2 }).ok, true);
    const bots = game.state.players.filter((p) => p.isBot);
    assert.equal(bots.length, 2);
    assert.equal(bots.every((b) => b.ready), true, 'боты сразу готовы');
    assert.ok(Object.values(game.state.cards).some((c) => c.authorId === bots[0].id));

    assert.equal(game.adminStart(SCREEN, { force: true }).ok, true, 'заглушки подмешались');
    assert.equal(game.adminRemoveBots(SCREEN).ok, true);
    assert.equal(game.state.players.filter((p) => p.isBot).length, 0);
  });

  await t.test('«Загрузить базу» принимает текст с переносами', () => {
    const storage = fakeStorage();
    const game = new Game({ storage });
    const res = game.adminSaveBase(SCREEN, {
      prompts: 'Первый вопрос: ___.\n# комментарий\n\nВторой вопрос?',
      answers: 'первый ответ\nвторой ответ',
    });
    assert.equal(res.ok, true);
    const base = storage.loadBase();
    assert.ok(base.prompts.length >= 2);
    assert.ok(base.answers.length >= 2);
  });

  await t.test('выбор адреса для QR сохраняется', () => {
    const { game } = makeGame({ players: 3 });
    assert.equal(game.adminSetIp(SCREEN, { url: 'http://192.168.1.5:3000' }).ok, true);
    assert.equal(game.state.selectedUrl, 'http://192.168.1.5:3000');
    assert.equal(game.adminSetIp(SCREEN, { url: '' }).ok, false);
  });
});

// ==========================================================================
// Целостность колоды: карта не может ни раздвоиться, ни пропасть.
// Каждый тест ниже падал до правки — это регрессии, а не «на всякий случай».
test('целостность карт', async (t) => {
  await t.test('удаление игрока на шаге ответов не съедает его сданную карту', () => {
    const { game } = makeGame({ players: 4, start: true, guestCards: 2 });
    const r = advanceTo(game, 'answering');
    const victim = game.state.players.find((p) => p.id !== r.hostId);
    const cardId = victim.hand[0];
    game.submitAnswer(asPlayer(victim.id), { round: r.number, cardId });

    game.adminKick(SCREEN, { playerId: victim.id });

    assertCardsIntact(game, 'после кика на шаге ответов');
    assert.ok(game.state.decks.discard.includes(cardId), 'сданная карта ушла в сброс');
  });

  await t.test('«передать ход» на шаге результата не раздваивает карты', () => {
    const { game } = makeGame({ players: 4, start: true, guestCards: 2 });
    advanceTo(game, 'result');
    const promptId = game.state.round.promptId;
    const handsBefore = game.state.players.map((p) => p.hand.length);

    assert.equal(game.adminPassHost(SCREEN).ok, true);

    assertCardsIntact(game, 'после «передать ход» на результате');
    assert.deepEqual(
      game.state.players.map((p) => p.hand.length),
      handsBefore,
      'руки уже добраны — второй раз карты в них не возвращаются'
    );
    assert.equal(
      game.state.decks.guestPrompts.includes(promptId) ||
        game.state.decks.basePrompts.includes(promptId),
      false,
      'сыгранный вопрос не возвращается в очередь второй раз'
    );
    assert.equal(game.state.round.step, 'draw');
  });

  await t.test('удаление ведущего на шаге результата не раздваивает карты', () => {
    const { game } = makeGame({ players: 5, start: true, guestCards: 2 });
    advanceTo(game, 'result');
    game.adminKick(SCREEN, { playerId: game.state.round.hostId });
    assertCardsIntact(game, 'после кика ведущего на результате');
  });

  await t.test('карта не пропадает, если автора сдачи уже удалили', () => {
    const { game } = makeGame({ players: 5, start: true, guestCards: 2 });
    const r = advanceTo(game, 'answering');
    const victim = game.state.players.find((p) => p.id !== r.hostId);
    game.submitAnswer(asPlayer(victim.id), { round: r.number, cardId: victim.hand[0] });
    // Вскрытие началось — ответ остаётся в раунде, а игрока удаляют (ТЗ 6).
    game.hostSkipWaiting(asPlayer(r.hostId), { round: r.number });
    game.hostReveal(asPlayer(r.hostId), { round: r.number, index: 0 });
    game.adminKick(SCREEN, { playerId: victim.id });
    assertCardsIntact(game, 'после кика автора на вскрытии');

    // Откат раунда: возвращать карту некому — она обязана уйти в сброс.
    assert.equal(game.adminPassHost(SCREEN).ok, true);
    assertCardsIntact(game, 'после отката раунда без автора');
  });

  await t.test('колода цела на всём протяжении партии с киками и откатами', () => {
    const { game } = makeGame({ players: 6, start: true, guestCards: 2, seed: 42 });
    const rng = seededRng(4242);
    for (let i = 0; i < 500 && game.state.phase === 'round'; i += 1) {
      const r = game.state.round;
      const host = asPlayer(r.hostId);
      const roll = rng();
      if (roll < 0.04) game.adminPassHost(SCREEN);
      else if (roll < 0.06 && game.state.players.length > 3) {
        const v = game.state.players[Math.floor(rng() * game.state.players.length)];
        game.adminKick(SCREEN, { playerId: v.id });
      } else if (r.step === 'draw') game.hostDraw(host, { round: r.number });
      else if (r.step === 'answering') {
        const pending = game.state.players.filter(
          (p) => p.connected && p.id !== r.hostId && p.hand.length > 0 &&
                 !r.submissions.some((x) => x.playerId === p.id)
        );
        if (pending.length > 0 && roll < 0.75) {
          game.submitAnswer(asPlayer(pending[0].id), { round: r.number, cardId: pending[0].hand[0] });
        } else if (roll < 0.8 && !r.redrawUsed) game.hostRedraw(host, { round: r.number });
        else if (r.submissions.length > 0) {
          game.hostSkipWaiting(host, { round: r.number });
          game.hostReveal(host, { round: r.number, index: 0 });
        } else game.hostNext(host, { round: r.number });
      } else if (r.step === 'revealing') game.hostReveal(host, { round: r.number, index: r.revealedCount });
      else if (r.step === 'judging') game.hostPick(host, { round: r.number, submissionId: r.submissions[0].id });
      else if (r.step === 'result') game.hostNext(host, { round: r.number });

      assertCardsIntact(game, `на шаге ${i}`);
    }
  });
});

// ==========================================================================
test('раунд всегда с живым ведущим', async (t) => {
  await t.test('удаление ведущего, когда все остальные не в сети, не оставляет ведущего-призрака', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');
    for (const p of game.state.players) if (p.id !== r.hostId) game.setConnected(p.id, false);

    assert.equal(game.adminKick(SCREEN, { playerId: r.hostId }).ok, true);

    const s = game.state;
    assert.ok(
      s.players.some((p) => p.id === s.round.hostId),
      'ведущий обязан быть настоящим игроком, иначе кнопки остаются только на ноутбуке'
    );
    assert.notEqual(game.snapshotFor(SCREEN).round.hostName, '—');
    // И этот телефон действительно может вести раунд.
    assert.equal(game.snapshotFor(asPlayer(s.round.hostId)).can.draw, true);
  });

  await t.test('удаление ведущего передаёт ход строго следующему по списку', () => {
    const { game } = makeGame({ players: 4, start: true });
    const r = advanceTo(game, 'answering');
    const order = game.state.hostOrder;
    const expected = order[(game.state.hostCursor + 1) % order.length];
    game.adminKick(SCREEN, { playerId: r.hostId });
    assert.equal(game.state.round.hostId, expected, 'ход не должен перепрыгивать через игрока');
  });
});

// ==========================================================================
test('«Загрузить базу» не врёт про успех', async (t) => {
  await t.test('отказ диска возвращает ошибку, а не «сохранено»', async () => {
    const boom = new Error('EACCES: нет прав на data/');
    const game = new Game({
      storage: {
        loadBase: () => ({ prompts: [], answers: [] }),
        saveBase: () => Promise.reject(boom),
      },
    });
    const res = await game.adminSaveBase(SCREEN, { prompts: 'Вопрос: ___.', answers: 'ответ' });
    assert.equal(res.ok, false);
    assert.match(res.error, /Не удалось записать базу/);
  });

  await t.test('успешная асинхронная запись отвечает ok', async () => {
    let written = null;
    const game = new Game({
      storage: {
        loadBase: () => ({ prompts: [], answers: [] }),
        saveBase: (d) => { written = d; return Promise.resolve(); },
      },
    });
    const res = await game.adminSaveBase(SCREEN, { prompts: 'Вопрос: ___.', answers: 'ответ' });
    assert.equal(res.ok, true);
    assert.equal(written.prompts, 'Вопрос: ___.');
  });
});

// ==========================================================================
test('восстановление из битого state.json', async (t) => {
  const brokenState = (mutate) => {
    const { game } = makeGame({ players: 5, start: true, guestCards: 2 });
    advanceTo(game, 'revealing');
    const saved = JSON.parse(JSON.stringify(game.state));
    mutate(saved);
    const revived = new Game({ storage: fakeStorage(bigBase()), rng: seededRng(3) });
    revived.restore(saved);
    return revived;
  };

  await t.test('отрицательный счётчик вскрытых не показывает лишние ответы', () => {
    const revived = brokenState((s) => { s.round.revealedCount = -5; });
    assert.equal(revived.state.round.revealedCount, 0);
    assert.equal(revived.snapshotFor(SCREEN).round.reveals.length, 0);
  });

  await t.test('счётчик больше числа ответов зажимается', () => {
    const revived = brokenState((s) => { s.round.revealedCount = 999; });
    const r = revived.state.round;
    assert.equal(r.revealedCount, r.revealOrder.length);
  });

  await t.test('дубли игроков в файле не раздваивают руку', () => {
    const revived = brokenState((s) => { s.players.push({ ...s.players[0] }); });
    const ids = revived.state.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'каждый игрок ровно один раз');
    assertCardsIntact(revived, 'после восстановления с дублями игроков');
  });

  await t.test('чужой winnerSubmissionId не рисует пустого победителя', () => {
    const revived = brokenState((s) => {
      s.round.step = 'result';
      s.round.winnerSubmissionId = 'такого-нет';
    });
    assert.equal(revived.state.round.winnerSubmissionId, null);
    assert.equal(revived.snapshotFor(SCREEN).round.winner, null);
  });
});
