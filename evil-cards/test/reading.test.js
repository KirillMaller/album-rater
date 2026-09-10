// Экран ждёт людей, а не таймер: гость жмёт «Прочитал», и пока не нажали все,
// раунд не едет дальше. Повод — замер 10.09.2026: при боте-ведущем ответ
// держался на экране 976 мс в среднем, прочитать было невозможно.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, advanceTo, bigBase, SCREEN, asPlayer } from './helpers.js';
import { createBotDriver } from '../server/bots.js';

test('чтение экрана гостями', async (t) => {
  await t.test('экран не едет дальше, пока прочли не все', () => {
    const { game, ids } = makeGame({ players: 4, base: bigBase(20, 200), start: true });
    advanceTo(game, 'revealing');
    const r = game.state.round;
    const readers = ids.filter((id) => id !== r.hostId);
    const before = r.revealedCount;

    game.ackRead(asPlayer(readers[0]), { round: r.number, mark: game._screenMark() });
    assert.equal(game.state.round.revealedCount, before, 'один прочитал — экран не должен меняться');

    game.ackRead(asPlayer(readers[1]), { round: r.number, mark: game._screenMark() });
    assert.equal(game.state.round.revealedCount, before, 'двое из троих — всё ещё ждём');

    game.ackRead(asPlayer(readers[2]), { round: r.number, mark: game._screenMark() });
    assert.notEqual(game.state.round.revealedCount, before, 'прочли все — экран обязан поехать дальше');
  });

  await t.test('«Прочитал» по старому экрану не засчитывается новому', () => {
    const { game, ids } = makeGame({ players: 4, base: bigBase(20, 200), start: true });
    advanceTo(game, 'revealing');
    const r = game.state.round;
    const stale = game._screenMark();
    const readers = ids.filter((id) => id !== r.hostId);

    // Ведущий пролистнул сам — экран сменился.
    game.hostReveal(asPlayer(r.hostId), { round: r.number, index: r.revealedCount });
    const res = game.ackRead(asPlayer(readers[0]), { round: r.number, mark: stale });
    assert.equal(res.ok, false, 'опоздавший тап не должен засчитаться');
    assert.equal(game.state.round.readAcks.length, 0, 'счётчик прочитавших должен быть пуст');
  });

  await t.test('смена экрана сбрасывает прочитавших', () => {
    const { game, ids } = makeGame({ players: 4, base: bigBase(20, 200), start: true });
    advanceTo(game, 'revealing');
    const r = game.state.round;
    const readers = ids.filter((id) => id !== r.hostId);
    game.ackRead(asPlayer(readers[0]), { round: r.number, mark: game._screenMark() });
    assert.equal(game.state.round.readAcks.length, 1);
    game.hostReveal(asPlayer(r.hostId), { round: r.number, index: r.revealedCount });
    assert.equal(game.state.round.readAcks.length, 0, 'на новом экране читают заново');
  });

  await t.test('ведущего и ботов не ждём', () => {
    const { game, ids } = makeGame({ players: 3, base: bigBase(20, 200) });
    game.adminAddBots(SCREEN, { count: 3 });
    game.adminStart(SCREEN, { confirmNotReady: true, confirmFewAnswers: true });
    advanceTo(game, 'revealing');
    const snap = game.snapshotFor(SCREEN);
    const hostId = game.state.round.hostId;
    const expected = game.state.players.filter((p) => !p.isBot && p.connected && p.id !== hostId).length;
    assert.equal(snap.round.reading.needed, expected, 'ждём только живых игроков, кроме ведущего');
    const bot = game.state.players.find((p) => p.isBot && p.id !== hostId);
    const res = game.ackRead(asPlayer(bot.id), { round: game.state.round.number, mark: game._screenMark() });
    assert.equal(res.ok, false, 'бот не читает и подтверждать не может');
  });

  await t.test('ушедшего игрока не ждём — экран едет по оставшимся', () => {
    const { game, ids } = makeGame({ players: 4, base: bigBase(20, 200), start: true });
    advanceTo(game, 'revealing');
    const r = game.state.round;
    const readers = ids.filter((id) => id !== r.hostId);
    const before = r.revealedCount;
    game.setConnected(readers[2], false);          // телефон сел
    game.ackRead(asPlayer(readers[0]), { round: r.number, mark: game._screenMark() });
    game.ackRead(asPlayer(readers[1]), { round: r.number, mark: game._screenMark() });
    assert.notEqual(game.state.round.revealedCount, before, 'оставшиеся прочли — ждать ушедшего не надо');
  });

  // Без этого теста правка «бот ждёт людей» ничем не прикрыта: мутация
  // 10.09.2026 показала, что её можно снять и все тесты останутся зелёными.
  await t.test('бот-ведущий не листает ответы, пока живой игрок не прочёл', async () => {
    const { game, ids } = makeGame({ players: 2, base: bigBase(20, 200) });
    game.adminAddBots(SCREEN, { count: 3 });
    game.adminStart(SCREEN, { confirmNotReady: true, confirmFewAnswers: true });

    // Терпение большое: проверяем именно ожидание людей, а не таймер терпения.
    const driver = createBotDriver({ game, patienceMs: 60000 });
    game.onChange = () => driver.tick();
    try {
      let guard = 0;
      while (!game.getPlayer(game.state.round.hostId)?.isBot && guard++ < 10) {
        game.adminPassHost(SCREEN);
      }
      advanceTo(game, 'revealing');
      const r = game.state.round;
      const frozen = r.revealedCount;
      driver.tick();

      // REVEAL_DELAY = 1000 мс. Ждём заметно дольше: если бот листает
      // по таймеру, счётчик уедет и тест упадёт.
      await new Promise((res) => setTimeout(res, 1800));
      assert.equal(
        game.state.round.revealedCount,
        frozen,
        'бот пролистал ответ, не дождавшись живого игрока — человек прочитать не успеет'
      );
    } finally {
      driver.stop();
      game.onChange = null;
    }
  });

  await t.test('итог раунда тоже ждёт читателей', () => {
    const { game, ids } = makeGame({ players: 4, base: bigBase(20, 200), start: true });
    advanceTo(game, 'result');
    const r = game.state.round;
    const readers = ids.filter((id) => id !== r.hostId);
    assert.equal(game.snapshotFor(SCREEN).round.reading.active, true, 'на итоге кнопка должна работать');
    for (const id of readers.slice(0, readers.length - 1)) {
      game.ackRead(asPlayer(id), { round: r.number, mark: game._screenMark() });
    }
    assert.equal(game.state.round.number, r.number, 'пока не все — раунд тот же');
    game.ackRead(asPlayer(readers[readers.length - 1]), { round: r.number, mark: game._screenMark() });
    assert.notEqual(game.state.round?.number, r.number, 'прочли все — поехал следующий раунд');
  });
});

// Сколько карт просим написать гостя — настройка организатора, а не число
// в коде. Раньше 3 и 5 были зашиты в телефоне и поменять их было нечем.
test('сколько карт просим написать', async (t) => {
  await t.test('организатор задаёт, снимок отдаёт', () => {
    const { game } = makeGame({ players: 3, base: bigBase(20, 200) });
    assert.equal(game.snapshotFor(SCREEN).settings.askPrompts, 3, 'по умолчанию 3 вопроса');
    assert.equal(game.snapshotFor(SCREEN).settings.askAnswers, 5, 'по умолчанию 5 ответов');

    assert.equal(game.adminSettings(SCREEN, { askPrompts: 1, askAnswers: 8 }).ok, true);
    const s = game.snapshotFor(SCREEN).settings;
    assert.equal(s.askPrompts, 1);
    assert.equal(s.askAnswers, 8);
  });

  await t.test('мусор и края не ломают настройку', () => {
    const { game } = makeGame({ players: 3, base: bigBase(20, 200) });
    game.adminSettings(SCREEN, { askPrompts: -5, askAnswers: 999 });
    const s = game.snapshotFor(SCREEN).settings;
    assert.equal(s.askPrompts, 0, 'минус зажимается в ноль');
    assert.equal(s.askAnswers, 20, 'слишком много зажимается в 20');
    game.adminSettings(SCREEN, { askPrompts: 'ерунда' });
    assert.equal(game.snapshotFor(SCREEN).settings.askPrompts, 3, 'на мусоре берём значение по умолчанию');
  });

  await t.test('настройка переживает перезапуск сервера', () => {
    const { game } = makeGame({ players: 3, base: bigBase(20, 200) });
    game.adminSettings(SCREEN, { askPrompts: 2, askAnswers: 7 });
    const saved = JSON.parse(JSON.stringify(game.state));
    const again = makeGame({ players: 0, base: bigBase(20, 200) }).game;
    again.restore(saved);
    const s = again.snapshotFor(SCREEN).settings;
    assert.equal(s.askPrompts, 2);
    assert.equal(s.askAnswers, 7);
  });
});
