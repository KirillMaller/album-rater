// test/storage.test.js — сохранение состояния и базы карт: дебаунс, атомарность, битый файл.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStorage } from '../server/storage.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Временная папка на каждый тест, убирается через t.after. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-cards-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const statePath = (dir) => path.join(dir, 'state.json');
const exists = (file) => fs.existsSync(file);

const sampleState = {
  v: 1,
  phase: 'round',
  settings: { targetScore: 10, handSize: 10 },
  players: [{ id: 'p1', name: 'Оля', score: 3, hand: ['a1', 'a2'] }],
  decks: { guestPrompts: ['g1'], basePrompts: [], usedPrompts: [], answers: ['a3'], discard: [] },
  history: [{ round: 1, promptText: 'Заход ___', answerText: 'ночной дожор' }],
};

// ------------------------------------------------------------ state.json

test('save/flush и load работают круговым путём', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir, debounceMs: 20 });

  await storage.flush(sampleState);
  assert.ok(exists(statePath(dir)), 'файл состояния создан');
  assert.deepEqual(storage.load(), sampleState);
  assert.ok(!exists(`${statePath(dir)}.tmp`), 'временный файл после записи не остаётся');

  // Новый storage на той же папке видит то же состояние (перезапуск сервера).
  const restarted = createStorage({ dataDir: dir });
  assert.deepEqual(restarted.load(), sampleState);
});

test('load на отсутствующем файле возвращает null', (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir });
  assert.equal(storage.load(), null);
  // И на несуществующей папке тоже — без исключений.
  const missing = createStorage({ dataDir: path.join(dir, 'нет-такой-папки') });
  assert.equal(missing.load(), null);
});

test('битый JSON превращается в .broken, load отдаёт null', (t) => {
  const dir = tempDir(t);
  const broken = '{ "phase": "round", это не json';
  fs.writeFileSync(statePath(dir), broken, 'utf8');

  const storage = createStorage({ dataDir: dir });
  assert.equal(storage.load(), null);
  assert.ok(!exists(statePath(dir)), 'битый файл убран с дороги');
  assert.ok(exists(`${statePath(dir)}.broken`), 'появился state.json.broken');
  assert.equal(fs.readFileSync(`${statePath(dir)}.broken`, 'utf8'), broken);

  // Старый .broken перезаписывается новым, второй заход не падает.
  fs.writeFileSync(statePath(dir), 'снова мусор', 'utf8');
  assert.equal(storage.load(), null);
  assert.equal(fs.readFileSync(`${statePath(dir)}.broken`, 'utf8'), 'снова мусор');

  // Валидный JSON, но не объект — тоже считается битым.
  fs.writeFileSync(statePath(dir), '"строка"', 'utf8');
  assert.equal(storage.load(), null);
});

test('дебаунс: три save подряд дают одну запись с последним состоянием', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir, debounceMs: 60 });

  storage.save({ step: 1 });
  storage.save({ step: 2 });
  storage.save({ step: 3 });
  assert.ok(!exists(statePath(dir)), 'до истечения дебаунса на диск ничего не ушло');

  await sleep(180);
  assert.deepEqual(storage.load(), { step: 3 }, 'на диске последнее состояние');
  assert.ok(!exists(`${statePath(dir)}.tmp`));

  // Ещё одна пачка после срабатывания таймера пишется как обычно.
  storage.save({ step: 4 });
  await sleep(180);
  assert.deepEqual(storage.load(), { step: 4 });
});

test('flush пишет немедленно и отменяет отложенную запись', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir, debounceMs: 60 });

  storage.save({ step: 'отложенный' });
  await storage.flush({ step: 'немедленный' });
  assert.deepEqual(storage.load(), { step: 'немедленный' }, 'записалось сразу, ждать не пришлось');

  await sleep(180);
  assert.deepEqual(storage.load(), { step: 'немедленный' }, 'отложенная запись отменена');
});

test('flush без аргумента пишет последнее состояние из save', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir, debounceMs: 500 });

  storage.save({ step: 'последний' });
  await storage.flush();
  assert.deepEqual(storage.load(), { step: 'последний' });

  // flush на «пустом» storage ничего не пишет и не падает.
  const clean = createStorage({ dataDir: tempDir(t) });
  await clean.flush();
  assert.equal(clean.load(), null);
});

test('одновременные записи не накладываются друг на друга', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir, debounceMs: 10 });

  await Promise.all([1, 2, 3, 4, 5].map((n) => storage.flush({ step: n })));
  assert.deepEqual(storage.load(), { step: 5 });
  assert.ok(!exists(`${statePath(dir)}.tmp`), 'ни один tmp не завис');
});

test('clear удаляет state.json и его tmp', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir, debounceMs: 20 });

  await storage.flush(sampleState);
  fs.writeFileSync(`${statePath(dir)}.tmp`, 'огрызок прерванной записи', 'utf8');

  await storage.clear();
  assert.ok(!exists(statePath(dir)));
  assert.ok(!exists(`${statePath(dir)}.tmp`));
  assert.equal(storage.load(), null);

  // Повторный clear на пустой папке не падает.
  await storage.clear();
  // После сброса отложенный save не должен воскресить старое состояние.
  await sleep(60);
  assert.equal(storage.load(), null);
});

test('ошибка записи не роняет процесс: save молчит, flush отклоняется', async (t) => {
  const dir = tempDir(t);
  // dataDir указывает на ФАЙЛ — mkdir и запись обязаны провалиться.
  const blocked = path.join(dir, 'это-файл');
  fs.writeFileSync(blocked, 'занято', 'utf8');
  const storage = createStorage({ dataDir: blocked, debounceMs: 10 });

  assert.doesNotThrow(() => storage.save({ step: 1 }));
  await sleep(80); // отложенная запись провалилась молча, процесс жив
  await assert.rejects(storage.flush({ step: 2 }));
  // Storage остаётся рабочим: следующая попытка снова честно отклоняется.
  await assert.rejects(storage.flush({ step: 3 }));
});

// --------------------------------------------------------------- база карт

test('loadBase на пустой папке отдаёт пустые массивы', (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir });
  assert.deepEqual(storage.loadBase(), { prompts: [], answers: [] });
});

test('saveBase/loadBase круговым путём для массивов строк', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir });

  const prompts = ['Оля не проживёт и дня без этого: ___.', 'Что Оля прячет на дне сумки?'];
  const answers = ['ночной дожор', 'голосовое на семь минут'];
  await storage.saveBase({ prompts, answers });

  assert.ok(exists(path.join(dir, 'base-prompts.txt')));
  assert.ok(exists(path.join(dir, 'base-answers.txt')));
  assert.deepEqual(storage.loadBase(), { prompts, answers });
  assert.ok(!exists(path.join(dir, 'base-prompts.txt.tmp')));
});

test('saveBase принимает текст из textarea, loadBase чистит комментарии', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir });

  await storage.saveBase({
    prompts: '# так прислали в мессенджере\r\nПервый заход: ___.\r\n\r\n  Второй заход?  \r\n',
    answers: 'ночной дожор\n\n# комментарий\nкот на клавиатуре\n',
  });

  assert.deepEqual(storage.loadBase(), {
    prompts: ['Первый заход: ___.', 'Второй заход?'],
    answers: ['ночной дожор', 'кот на клавиатуре'],
  });
  // Комментарий в файле сохраняется — чистит его только чтение.
  assert.ok(fs.readFileSync(path.join(dir, 'base-prompts.txt'), 'utf8').includes('#'));
});

test('saveBase не падает на пустых и кривых данных', async (t) => {
  const dir = tempDir(t);
  const storage = createStorage({ dataDir: dir });

  await storage.saveBase({});
  assert.deepEqual(storage.loadBase(), { prompts: [], answers: [] });

  await storage.saveBase({ prompts: '', answers: null });
  assert.deepEqual(storage.loadBase(), { prompts: [], answers: [] });

  // Перенос строки внутри элемента массива не должен разъехаться на две карты.
  await storage.saveBase({ prompts: ['карта\nс переносом'], answers: [1, 2] });
  assert.deepEqual(storage.loadBase(), {
    prompts: ['карта с переносом'],
    answers: ['1', '2'],
  });
});
