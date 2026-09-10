import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ANSWER_LEN,
  MAX_PROMPT_LEN,
  PLACEHOLDER,
  countPlaceholders,
  dedupeKey,
  fillPrompt,
  hasPlaceholder,
  normalizeText,
  validateAnswer,
  validatePrompt
} from '../public/shared/text.js';

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0x00a0);

/** Значение единственной части-ответа (или undefined, если ответа в частях нет). */
const answerPart = (filled) => filled.parts.find((p) => p.type === 'answer')?.value;

/** Все части-текст подряд. */
const textParts = (filled) => filled.parts.filter((p) => p.type === 'text').map((p) => p.value);

describe('константы', () => {
  test('совпадают с контрактом SPEC', () => {
    assert.equal(MAX_PROMPT_LEN, 150);
    assert.equal(MAX_ANSWER_LEN, 80);
    assert.equal(PLACEHOLDER, '___');
    assert.ok(hasPlaceholder(PLACEHOLDER), 'кнопка «Вставить пропуск» вставляет настоящий пропуск');
  });
});

describe('normalizeText', () => {
  test('убирает BOM в начале и внутри строки', () => {
    assert.equal(normalizeText(BOM + 'ночной дожор'), 'ночной дожор');
    assert.equal(normalizeText('ночной' + BOM + ' дожор'), 'ночной дожор');
  });

  test('CRLF и CR становятся пробелом (карта — одна строка)', () => {
    assert.equal(normalizeText('ночной\r\nдожор'), 'ночной дожор');
    assert.equal(normalizeText('ночной\rдожор'), 'ночной дожор');
    assert.equal(normalizeText('ночной\nдожор'), 'ночной дожор');
  });

  test('схлопывает двойные пробелы, табы и NBSP', () => {
    assert.equal(normalizeText('ночной  дожор'), 'ночной дожор');
    assert.equal(normalizeText('ночной\t\tдожор'), 'ночной дожор');
    assert.equal(normalizeText('ночной' + NBSP + NBSP + 'дожор'), 'ночной дожор');
    assert.equal(normalizeText('а \t\n б'), 'а б');
  });

  test('обрезает края', () => {
    assert.equal(normalizeText('   ночной дожор \t\n '), 'ночной дожор');
  });

  test('убирает управляющие символы, не склеивая слова через перенос', () => {
    const withControls = 'ноч' + String.fromCharCode(0x07) + 'ной\nдожор';
    assert.equal(normalizeText(withControls), 'ночной дожор');
  });

  test('не строка и пустая строка → пустая строка', () => {
    assert.equal(normalizeText(undefined), '');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(42), '');
    assert.equal(normalizeText('   '), '');
  });
});

describe('countPlaceholders / hasPlaceholder', () => {
  test('пропуск — 2 и больше подчёркиваний, одно не считается', () => {
    assert.equal(countPlaceholders('Вот __ это да'), 1);
    assert.equal(countPlaceholders('Вот ___ это да'), 1);
    assert.equal(countPlaceholders('Вот _______ это да'), 1);
    assert.equal(countPlaceholders('Вот _ это да'), 0);
    assert.equal(countPlaceholders('snake_case_не_пропуск'), 0);
    assert.equal(hasPlaceholder('Вот __ это да'), true);
    assert.equal(hasPlaceholder('Вот _ это да'), false);
  });

  test('считает несколько пропусков и переживает мусор на входе', () => {
    assert.equal(countPlaceholders('___ и ___'), 2);
    assert.equal(countPlaceholders('Что Оля прячет на дне сумки?'), 0);
    assert.equal(countPlaceholders(undefined), 0);
  });
});

describe('validatePrompt', () => {
  test('пустой вопрос', () => {
    assert.deepEqual(validatePrompt(''), { ok: false, error: 'Вопрос не может быть пустым' });
  });

  test('только пробелы — тоже пустой', () => {
    assert.deepEqual(validatePrompt('   \t\n '), {
      ok: false,
      error: 'Вопрос не может быть пустым'
    });
  });

  test('151 символ — слишком длинный, 150 — можно', () => {
    assert.deepEqual(validatePrompt('а'.repeat(151)), {
      ok: false,
      error: 'Вопрос длиннее 150 символов'
    });
    const ok = validatePrompt('а'.repeat(150));
    assert.equal(ok.ok, true);
    assert.equal(ok.text.length, 150);
  });

  test('длина считается уже после обрезки краёв', () => {
    assert.equal(validatePrompt('   ' + 'а'.repeat(150) + '   ').ok, true);
  });

  test('два пропуска запрещены', () => {
    assert.deepEqual(validatePrompt('___ и ___ — вот это поворот.'), {
      ok: false,
      error: 'В вопросе может быть только один пропуск'
    });
  });

  test('нормальный вопрос проходит и возвращается нормализованным', () => {
    assert.deepEqual(validatePrompt('  Оля не проживёт и дня без  этого: ___.  '), {
      ok: true,
      text: 'Оля не проживёт и дня без этого: ___.'
    });
  });

  test('вопрос без пропуска — это нормально', () => {
    assert.deepEqual(validatePrompt('Что Оля прячет на дне сумки?'), {
      ok: true,
      text: 'Что Оля прячет на дне сумки?'
    });
  });
});

describe('validateAnswer', () => {
  test('пустой ответ', () => {
    assert.deepEqual(validateAnswer(''), { ok: false, error: 'Ответ не может быть пустым' });
    assert.deepEqual(validateAnswer('  '), { ok: false, error: 'Ответ не может быть пустым' });
  });

  test('81 символ — слишком длинный, 80 — можно', () => {
    assert.deepEqual(validateAnswer('б'.repeat(81)), {
      ok: false,
      error: 'Ответ длиннее 80 символов'
    });
    assert.equal(validateAnswer('б'.repeat(80)).ok, true);
  });

  test('нормальный ответ проходит и возвращается нормализованным', () => {
    assert.deepEqual(validateAnswer(' ночной   дожор '), { ok: true, text: 'ночной дожор' });
  });
});

describe('dedupeKey', () => {
  test('регистр и лишние пробелы не мешают найти дубль', () => {
    assert.equal(dedupeKey('Ночной Дожор'), dedupeKey('ночной  дожор'));
    assert.equal(dedupeKey(' НОЧНОЙ\tДОЖОР '), dedupeKey('ночной дожор'));
    assert.equal(dedupeKey(BOM + 'Ночной Дожор'), 'ночной дожор');
  });

  test('разные карты дают разные ключи', () => {
    assert.notEqual(dedupeKey('ночной дожор'), dedupeKey('ночной дожор 2'));
  });
});

describe('fillPrompt — пропуск в середине', () => {
  const prompt = 'Оля не проживёт и дня без этого: ___.';

  test('ответ встаёт внутрь, точка не дублируется, ответ — отдельная часть', () => {
    const filled = fillPrompt(prompt, 'ночной дожор');
    assert.equal(filled.mode, 'inline');
    assert.equal(filled.plain, 'Оля не проживёт и дня без этого: ночной дожор.');
    assert.equal(filled.parts.length, 3);
    assert.deepEqual(filled.parts[0], {
      type: 'text',
      value: 'Оля не проживёт и дня без этого: '
    });
    assert.deepEqual(filled.parts[1], { type: 'answer', value: 'ночной дожор' });
    assert.deepEqual(filled.parts[2], { type: 'text', value: '.' });
    assert.equal(filled.plain.includes('..'), false);
  });

  test('после двоеточия регистр не поднимаем', () => {
    assert.equal(answerPart(fillPrompt(prompt, 'ночной дожор')), 'ночной дожор');
  });

  test('в частях нет пустых значений', () => {
    for (const part of fillPrompt(prompt, 'ночной дожор').parts) {
      assert.notEqual(part.value, '');
    }
  });

  test('plain — это склейка частей', () => {
    const filled = fillPrompt(prompt, 'ночной дожор');
    assert.equal(filled.parts.map((p) => p.value).join(''), filled.plain);
  });
});

describe('fillPrompt — заглавная буква', () => {
  test('пропуск в начале строки', () => {
    const filled = fillPrompt('___ — вот что ломает прод по пятницам.', 'пятничный деплой');
    assert.equal(filled.mode, 'inline');
    assert.equal(filled.plain, 'Пятничный деплой — вот что ломает прод по пятницам.');
    assert.equal(filled.parts[0].type, 'answer');
    assert.equal(filled.parts.length, 2);
  });

  test('пропуск после точки', () => {
    const filled = fillPrompt('Всё просто. ___ решает.', 'ночной дожор');
    assert.equal(filled.plain, 'Всё просто. Ночной дожор решает.');
  });

  test('пропуск после «!», «?» и многоточия', () => {
    assert.equal(fillPrompt('Вот так! ___ решает.', 'кот').plain, 'Вот так! Кот решает.');
    assert.equal(fillPrompt('И что? ___ решает.', 'кот').plain, 'И что? Кот решает.');
    assert.equal(fillPrompt('Ну… ___ решает.', 'кот').plain, 'Ну… Кот решает.');
  });

  test('пропуск после переноса строки', () => {
    assert.equal(fillPrompt('Вопрос дня\n___ решает.', 'кот').plain, 'Вопрос дня\nКот решает.');
  });

  test('регистр не понижается — в ответах бывают имена', () => {
    assert.equal(answerPart(fillPrompt('Без ___ жизнь не та.', 'Оля')), 'Оля');
    assert.equal(
      answerPart(fillPrompt('Оля не проживёт и дня без этого: ___.', 'Тинькофф')),
      'Тинькофф'
    );
    assert.equal(answerPart(fillPrompt('Всё просто. ___ решает.', 'Оля')), 'Оля');
  });
});

describe('fillPrompt — пунктуация', () => {
  test('точка ответа убирается перед своей точкой захода', () => {
    const filled = fillPrompt('Оля не проживёт и дня без этого: ___.', 'ночной дожор.');
    assert.equal(answerPart(filled), 'ночной дожор');
    assert.equal(filled.plain, 'Оля не проживёт и дня без этого: ночной дожор.');
  });

  test('точка ответа убирается и перед запятой, и перед прочей пунктуацией', () => {
    assert.equal(answerPart(fillPrompt('Главное — ___, и всё.', 'ночной дожор.')), 'ночной дожор');
    assert.equal(answerPart(fillPrompt('Главное — ___! Точно.', 'ночной дожор.')), 'ночной дожор');
    assert.equal(answerPart(fillPrompt('Главное — ___?', 'ночной дожор.')), 'ночной дожор');
    assert.equal(answerPart(fillPrompt('Главное — ___; а дальше?', 'кот.')), 'кот');
  });

  test('восклицательный и вопросительный знаки ответа не трогаем', () => {
    assert.equal(answerPart(fillPrompt('Главное — ___.', 'ура!')), 'ура!');
    assert.equal(answerPart(fillPrompt('Главное — ___.', 'а он кто?')), 'а он кто?');
  });

  // Правка 10.09.2026. Раньше здесь ожидалось «Главное — ура!.»: знак ответа
  // оставляли, но и точку захода тоже — выходил двойной знак. На живой базе
  // так ломались 40 фраз из 4620 («…муся, это ты?.»). Теперь лишней считается
  // точка ЗАХОДА: ответ уже закончил мысль сам.
  test('ответ закончил мысль сам — точка захода не нужна', () => {
    assert.equal(fillPrompt('Главное — ___.', 'ура!').plain, 'Главное — ура!');
    assert.equal(fillPrompt('Оля не проживёт и дня без этого: ___.', 'муся, это ты?').plain,
      'Оля не проживёт и дня без этого: муся, это ты?');
    assert.equal(fillPrompt('Он сказал: ___.', 'ну такое…').plain, 'Он сказал: ну такое…');
    // Свой знак захода авторский — его не трогаем.
    assert.equal(fillPrompt('Он кричал: ___!', 'муся, это ты?').plain, 'Он кричал: муся, это ты?!');
    // Обычный ответ точку захода по-прежнему получает.
    assert.equal(fillPrompt('Главное в жизни: ___.', 'спокойствие').plain, 'Главное в жизни: спокойствие.');
  });

  test('многоточие ответа не превращается в две точки', () => {
    assert.equal(answerPart(fillPrompt('Главное — ___.', 'ну такое...')), 'ну такое...');
  });

  test('без своей пунктуации точка ответа остаётся', () => {
    assert.equal(answerPart(fillPrompt('Главное — ___', 'ночной дожор.')), 'ночной дожор.');
    assert.equal(answerPart(fillPrompt('Без ___ никак', 'ночной дожор.')), 'ночной дожор.');
  });
});

describe('fillPrompt — нет пропуска (режим below)', () => {
  test('ответ идёт отдельной частью, plain — «вопрос — ответ»', () => {
    const filled = fillPrompt('Что Оля прячет на дне сумки?', 'ночной дожор');
    assert.equal(filled.mode, 'below');
    assert.deepEqual(filled.parts, [
      { type: 'text', value: 'Что Оля прячет на дне сумки?' },
      { type: 'answer', value: 'ночной дожор' }
    ]);
    assert.equal(filled.plain, 'Что Оля прячет на дне сумки? — ночной дожор');
  });

  test('одно подчёркивание — не пропуск, значит below', () => {
    const filled = fillPrompt('Что Оля прячет _ на дне сумки?', 'ночной дожор');
    assert.equal(filled.mode, 'below');
    assert.equal(answerPart(filled), 'ночной дожор');
  });

  test('регистр ответа в below не меняется', () => {
    assert.equal(answerPart(fillPrompt('Что Оля прячет?', 'ночной дожор')), 'ночной дожор');
    assert.equal(answerPart(fillPrompt('Что Оля прячет?', 'Оля')), 'Оля');
  });
});

describe('fillPrompt — крайние случаи', () => {
  test('ровно два подчёркивания — это пропуск', () => {
    const filled = fillPrompt('Без __ не начинается ни один тест.', 'кофе');
    assert.equal(filled.mode, 'inline');
    assert.equal(filled.plain, 'Без кофе не начинается ни один тест.');
  });

  test('пропуск любой длины съедается целиком', () => {
    assert.equal(fillPrompt('Без _______ никак.', 'кофе').plain, 'Без кофе никак.');
  });

  test('несколько пропусков — подставляется только первый', () => {
    const filled = fillPrompt('___ и ___ — вот это да.', 'кот');
    assert.equal(filled.mode, 'inline');
    assert.equal(filled.plain, 'Кот и ___ — вот это да.');
    assert.equal(countPlaceholders(filled.plain), 1);
    assert.equal(filled.parts.filter((p) => p.type === 'answer').length, 1);
  });

  test('ответ нормализуется перед вставкой', () => {
    const filled = fillPrompt('Без ___ никак.', BOM + ' ночной' + NBSP + ' \t дожор\n');
    assert.equal(answerPart(filled), 'ночной дожор');
    assert.equal(filled.plain, 'Без ночной дожор никак.');
  });

  test('пустой ответ — заход возвращается целиком, пропуск на месте', () => {
    const filled = fillPrompt('Без ___ никак.', '');
    assert.equal(filled.mode, 'inline');
    assert.equal(filled.plain, 'Без ___ никак.');
    assert.deepEqual(textParts(filled), ['Без ___ никак.']);
    assert.equal(answerPart(filled), undefined);
  });

  test('мусор на входе не роняет функцию', () => {
    assert.deepEqual(fillPrompt(undefined, undefined), { mode: 'below', parts: [], plain: '' });
    assert.deepEqual(fillPrompt(null, 'кот'), {
      mode: 'below',
      parts: [{ type: 'answer', value: 'кот' }],
      plain: 'кот'
    });
  });

  test('края захода обрезаются', () => {
    assert.equal(fillPrompt('  Без ___ никак.  ', 'кофе').plain, 'Без кофе никак.');
  });
});
