// test/deck.test.js — колоды: тасовка, разбор базы, раздача, добор, вставка карт.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answersLeft,
  dealStart,
  discardAnswers,
  drawAnswers,
  drawPrompt,
  emptyDecks,
  insertAnswer,
  insertGuestPrompt,
  makeCardId,
  parseBaseFile,
  promptsLeft,
  returnPrompt,
  shuffle,
  usePrompt,
} from '../server/deck.js';

/** rng, всегда возвращающий 0 — Фишер–Йетс становится предсказуемым. */
const rngZero = () => 0;
/** rng «почти единица» — каждый элемент меняется сам с собой, порядок не меняется. */
const rngMax = () => 0.999999;
/** rng, крутящий заданную последовательность. */
function rngSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const sorted = (arr) => [...arr].sort();

// ---------------------------------------------------------------- shuffle

test('shuffle не мутирует вход и возвращает новый массив', () => {
  const input = ['a', 'b', 'c', 'd'];
  const copy = [...input];
  const out = shuffle(input, rngZero);
  assert.notEqual(out, input);
  assert.deepEqual(input, copy, 'исходный массив должен остаться нетронутым');
});

test('shuffle сохраняет все элементы', () => {
  const input = ids('x', 50);
  const out = shuffle(input);
  assert.equal(out.length, input.length);
  assert.deepEqual(sorted(out), sorted(input));
});

test('shuffle с подставным rng даёт предсказуемый результат', () => {
  // rng=0 на каждом шаге меняет последний элемент с первым.
  assert.deepEqual(shuffle(['a', 'b', 'c', 'd'], rngZero), ['b', 'c', 'd', 'a']);
  // rng≈1 выбирает j === i, то есть порядок не меняется.
  assert.deepEqual(shuffle(['a', 'b', 'c', 'd'], rngMax), ['a', 'b', 'c', 'd']);
  // Один и тот же rng — один и тот же результат.
  const seq = () => rngSeq([0.1, 0.9, 0.5, 0.3, 0.7]);
  assert.deepEqual(shuffle(ids('n', 8), seq()), shuffle(ids('n', 8), seq()));
});

test('shuffle не падает на пустом, одиночном и не-массиве', () => {
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle(['один']), ['один']);
  assert.deepEqual(shuffle(null), []);
  assert.deepEqual(shuffle(undefined), []);
});

// ----------------------------------------------------------- parseBaseFile

test('parseBaseFile убирает BOM, комментарии, пустые строки и пробелы по краям', () => {
  const content =
    '﻿# комментарий\r\n' +
    '  Оля не проживёт и дня без этого: ___.  \r\n' +
    '\r\n' +
    '   # отступ перед решёткой тоже комментарий\r\n' +
    'Что Оля прячет на дне сумки?\r' +
    '\n' +
    '\tответ с табами\t\n';
  assert.deepEqual(parseBaseFile(content), [
    'Оля не проживёт и дня без этого: ___.',
    'Что Оля прячет на дне сумки?',
    'ответ с табами',
  ]);
});

test('parseBaseFile поддерживает одиночные \\r и не теряет внутренние пробелы', () => {
  assert.deepEqual(parseBaseFile('первая\rвторая\rтретья'), ['первая', 'вторая', 'третья']);
  assert.deepEqual(parseBaseFile('  два   пробела  внутри  '), ['два   пробела  внутри']);
});

test('parseBaseFile не убирает дубли и не падает на мусоре', () => {
  assert.deepEqual(parseBaseFile('кот\nкот\nКОТ'), ['кот', 'кот', 'КОТ']);
  assert.deepEqual(parseBaseFile(''), []);
  assert.deepEqual(parseBaseFile('   \n\n#только комментарий'), []);
  assert.deepEqual(parseBaseFile(null), []);
  assert.deepEqual(parseBaseFile(42), []);
});

// --------------------------------------------------------------- dealStart

test('dealStart раздаёт ровно handSize каждому, остаток уходит в колоду добора', () => {
  const guestAnswerIds = ids('g', 5);
  const baseAnswerIds = ids('b', 20);
  const playerIds = ['p1', 'p2', 'p3'];
  const { decks, hands, shortBy } = dealStart({
    guestAnswerIds,
    baseAnswerIds,
    guestPromptIds: ids('gp', 3),
    basePromptIds: ids('bp', 7),
    playerIds,
    handSize: 4,
    rng: Math.random,
  });

  assert.equal(shortBy, 0);
  for (const id of playerIds) assert.equal(hands[id].length, 4, `рука ${id}`);

  const dealt = playerIds.flatMap((id) => hands[id]);
  const all = [...dealt, ...decks.answers];
  assert.equal(all.length, 25, 'ни одна карта не потерялась и не задвоилась');
  assert.deepEqual(sorted(all), sorted([...guestAnswerIds, ...baseAnswerIds]));
  assert.equal(new Set(all).size, 25);
  assert.equal(decks.answers.length, 13);

  // Заходы: гостевые и базовые перемешаны по своим очередям, сыгранных нет.
  assert.deepEqual(sorted(decks.guestPrompts), sorted(ids('gp', 3)));
  assert.deepEqual(sorted(decks.basePrompts), sorted(ids('bp', 7)));
  assert.deepEqual(decks.usedPrompts, []);
  assert.deepEqual(decks.discard, []);
});

test('dealStart при дефиците сначала раздаёт все гостевые ответы, потом базовые', () => {
  const guestAnswerIds = ids('g', 6);
  const baseAnswerIds = ids('b', 6);
  const { decks, hands, shortBy } = dealStart({
    guestAnswerIds,
    baseAnswerIds,
    playerIds: ['p1', 'p2'],
    handSize: 4, // нужно 8 карт: 6 гостевых + 2 базовых
  });

  assert.equal(shortBy, 0);
  const dealt = [...hands.p1, ...hands.p2];
  assert.equal(dealt.length, 8);
  for (const id of guestAnswerIds) {
    assert.ok(dealt.includes(id), `гостевой ответ ${id} обязан попасть в раздачу`);
  }
  // В колоде добора остались только базовые — ровно те, что не влезли.
  assert.equal(decks.answers.length, 4);
  assert.ok(decks.answers.every((id) => id.startsWith('b')));
});

test('dealStart считает shortBy, когда карт физически не хватает', () => {
  const { decks, hands, shortBy } = dealStart({
    guestAnswerIds: ids('g', 4),
    baseAnswerIds: ids('b', 6),
    playerIds: ['p1', 'p2', 'p3'],
    handSize: 5, // нужно 15, есть 10
  });

  assert.equal(shortBy, 5);
  const sizes = ['p1', 'p2', 'p3'].map((id) => hands[id].length);
  assert.equal(
    sizes.reduce((a, b) => a + b, 0),
    10,
  );
  // Раздача по кругу: разрыв между руками не больше одной карты.
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `руки: ${sizes}`);
  assert.deepEqual(decks.answers, [], 'при нехватке колода добора пуста');
});

test('dealStart не падает на нуле игроков и отрицательной руке', () => {
  const noPlayers = dealStart({
    guestAnswerIds: ids('g', 3),
    baseAnswerIds: ids('b', 3),
    playerIds: [],
    handSize: 10,
  });
  assert.deepEqual(noPlayers.hands, {});
  assert.equal(noPlayers.shortBy, 0);
  assert.equal(noPlayers.decks.answers.length, 6, 'все карты ушли в колоду добора');

  const negative = dealStart({
    guestAnswerIds: ids('g', 3),
    baseAnswerIds: [],
    playerIds: ['p1'],
    handSize: -5,
  });
  assert.deepEqual(negative.hands.p1, []);
  assert.equal(negative.shortBy, 0);
  assert.equal(negative.decks.answers.length, 3);

  const nothing = dealStart({});
  assert.deepEqual(nothing.hands, {});
  assert.equal(nothing.shortBy, 0);
  assert.deepEqual(nothing.decks, emptyDecks());
});

test('dealStart не теряет лишние гостевые ответы', () => {
  const { decks, hands } = dealStart({
    guestAnswerIds: ids('g', 10),
    baseAnswerIds: ids('b', 2),
    playerIds: ['p1'],
    handSize: 3,
  });
  assert.equal(hands.p1.length, 3);
  assert.equal(decks.answers.length, 9);
  assert.equal(new Set([...hands.p1, ...decks.answers]).size, 12);
});

// -------------------------------------------------------------- drawPrompt

test('drawPrompt берёт сначала гостевые, потом базовые', () => {
  const decks = { ...emptyDecks(), guestPrompts: ['g1', 'g2'], basePrompts: ['b1'] };
  assert.equal(drawPrompt(decks, rngZero), 'g1');
  assert.equal(drawPrompt(decks, rngZero), 'g2');
  assert.equal(drawPrompt(decks, rngZero), 'b1');
  assert.deepEqual(decks.usedPrompts, [], 'drawPrompt сам ничего не кладёт в сыгранные');
});

test('drawPrompt пускает сыгранные заходы по второму кругу', () => {
  const decks = { ...emptyDecks(), guestPrompts: ['g1'], basePrompts: ['b1'] };
  usePrompt(decks, drawPrompt(decks));
  usePrompt(decks, drawPrompt(decks));
  assert.deepEqual(sorted(decks.usedPrompts), ['b1', 'g1']);

  const second = drawPrompt(decks, rngZero);
  assert.ok(['g1', 'b1'].includes(second), 'второй круг берёт из сыгранных');
  assert.deepEqual(decks.usedPrompts, [], 'сыгранные переехали в базовую очередь');
  assert.equal(decks.basePrompts.length, 1);
  assert.notEqual(decks.basePrompts[0], second);
});

test('drawPrompt возвращает null, когда заходов нет вообще', () => {
  assert.equal(drawPrompt(emptyDecks()), null);
  assert.equal(drawPrompt(null), null);
  assert.equal(drawPrompt({}), null);
});

// ------------------------------------------------------------ returnPrompt

test('returnPrompt кладёт заход в конец той очереди, из которой он пришёл', () => {
  const decks = { ...emptyDecks(), guestPrompts: ['g1', 'g2'], basePrompts: ['b1', 'b2'] };
  returnPrompt(decks, 'g0', true);
  returnPrompt(decks, 'b0', false);
  assert.deepEqual(decks.guestPrompts, ['g1', 'g2', 'g0']);
  assert.deepEqual(decks.basePrompts, ['b1', 'b2', 'b0']);

  // «Другой вопрос» на гостевом заходе: следующим тянется не он же.
  const drawn = drawPrompt(decks);
  assert.equal(drawn, 'g1');
  returnPrompt(decks, drawn, true);
  assert.equal(decks.guestPrompts[decks.guestPrompts.length - 1], 'g1');
});

// ------------------------------------------------------------- drawAnswers

test('drawAnswers берёт карты с начала колоды добора', () => {
  const decks = { ...emptyDecks(), answers: ids('a', 5) };
  assert.deepEqual(drawAnswers(decks, 3), ['a1', 'a2', 'a3']);
  assert.deepEqual(decks.answers, ['a4', 'a5']);
  assert.deepEqual(drawAnswers(decks, 0), []);
  assert.deepEqual(drawAnswers(decks, -2), []);
  assert.deepEqual(drawAnswers(decks, NaN), []);
});

test('drawAnswers перемешивает сброс в колоду, когда добор кончился', () => {
  const decks = { ...emptyDecks(), answers: [], discard: ['d1', 'd2', 'd3', 'd4'] };
  const drawn = drawAnswers(decks, 2, rngZero);

  assert.equal(drawn.length, 2);
  assert.deepEqual(decks.discard, [], 'сброс уехал в колоду целиком');
  assert.equal(answersLeft(decks), 2, 'осталось ровно то, что не раздали');
  // rng=0 даёт предсказуемую перетасовку — значит сброс действительно тасуется.
  assert.deepEqual(drawn, ['d2', 'd3']);
  assert.deepEqual(sorted([...drawn, ...decks.answers]), ['d1', 'd2', 'd3', 'd4']);
});

test('drawAnswers добирает через сброс и не зацикливается при нехватке карт', () => {
  const decks = { ...emptyDecks(), answers: ['a1'], discard: ['d1'] };
  const drawn = drawAnswers(decks, 10);
  assert.equal(drawn.length, 2, 'вернули сколько было, без исключений');
  assert.deepEqual(sorted(drawn), ['a1', 'd1']);
  assert.equal(answersLeft(decks), 0);

  // Совсем пустые колоды — тоже без зависания.
  assert.deepEqual(drawAnswers(emptyDecks(), 5), []);
  assert.deepEqual(drawAnswers(null, 3), []);
});

test('discardAnswers складывает сыгранные карты в сброс', () => {
  const decks = emptyDecks();
  discardAnswers(decks, ['a1', 'a2']);
  discardAnswers(decks, [null, undefined, 'a3']);
  discardAnswers(decks, 'не массив');
  assert.deepEqual(decks.discard, ['a1', 'a2', 'a3']);
});

// ------------------------------------------------------------ insertAnswer

test('insertAnswer всегда попадает в верхнюю половину колоды добора', () => {
  for (let run = 0; run < 100; run += 1) {
    const size = 1 + (run % 12); // от 1 до 12 карт в колоде
    const decks = { ...emptyDecks(), answers: ids('a', size) };
    const limit = Math.floor(size / 2);
    insertAnswer(decks, 'новая', Math.random);
    const at = decks.answers.indexOf('новая');
    assert.ok(at >= 0 && at <= limit, `прогон ${run}: индекс ${at} при пределе ${limit}`);
    assert.equal(decks.answers.length, size + 1);
  }
});

test('insertAnswer уважает границы диапазона и пустую колоду', () => {
  const low = { ...emptyDecks(), answers: ids('a', 9) };
  insertAnswer(low, 'новая', rngZero);
  assert.equal(low.answers.indexOf('новая'), 0, 'rng=0 — самый верх колоды');

  const high = { ...emptyDecks(), answers: ids('a', 9) };
  insertAnswer(high, 'новая', rngMax);
  assert.equal(high.answers.indexOf('новая'), 4, 'rng≈1 — ровно середина (floor(9/2))');

  const empty = emptyDecks();
  insertAnswer(empty, 'первая', Math.random);
  assert.deepEqual(empty.answers, ['первая']);
});

// ------------------------------------------------------- insertGuestPrompt

test('insertGuestPrompt не теряет карты и кладёт их внутрь гостевой очереди', () => {
  const decks = emptyDecks();
  const added = [];
  for (let i = 1; i <= 20; i += 1) {
    const before = decks.guestPrompts.length;
    const id = `gp${i}`;
    insertGuestPrompt(decks, id, Math.random);
    const at = decks.guestPrompts.indexOf(id);
    assert.ok(at >= 0 && at <= before, `индекс ${at} вне [0, ${before}]`);
    assert.equal(decks.guestPrompts.length, before + 1);
    added.push(id);
  }
  assert.deepEqual(sorted(decks.guestPrompts), sorted(added));
  assert.deepEqual(decks.basePrompts, [], 'базовая очередь не трогается');
});

// ------------------------------------------------------------- счётчики/id

test('promptsLeft и answersLeft считают все очереди', () => {
  const decks = {
    guestPrompts: ['g1'],
    basePrompts: ['b1', 'b2'],
    usedPrompts: ['u1', 'u2', 'u3'],
    answers: ['a1', 'a2'],
    discard: ['d1'],
  };
  assert.equal(promptsLeft(decks), 6);
  assert.equal(answersLeft(decks), 3);
  assert.equal(promptsLeft(emptyDecks()), 0);
  assert.equal(answersLeft(null), 0);
});

test('makeCardId выдаёт уникальные id с нужным префиксом', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) seen.add(makeCardId());
  assert.equal(seen.size, 1000);
  assert.ok(makeCardId('p').startsWith('p'));
  assert.ok(makeCardId('a').startsWith('a'));
});
