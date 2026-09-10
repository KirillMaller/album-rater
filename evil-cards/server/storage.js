// server/storage.js — сохранение состояния игры и базы карт на диск.
//
// Состояние пишется после каждого изменения, поэтому запись:
//   * с дебаунсом (пачка изменений подряд = одна запись),
//   * атомарная (пишем в .tmp, потом rename — прерванная запись не портит файл),
//   * последовательная (внутренняя очередь из одной операции, два rename
//     никогда не идут параллельно).
//
// Ошибки записи не роняют процесс: они логируются по-русски, а наружу
// уходят только отклонённым промисом из flush()/clear()/saveBase(),
// чтобы организатор увидел тост. save() не бросает и не отклоняется никогда.

import fs from 'node:fs';
import path from 'node:path';
import { parseBaseFile } from './deck.js';

const STATE_FILE = 'state.json';
const PROMPTS_FILE = 'base-prompts.txt';
const ANSWERS_FILE = 'base-answers.txt';

/** Текст ошибки для лога — не хочется печатать весь stack на каждый чих. */
function reason(err) {
  if (!err) return 'неизвестная ошибка';
  return err.message || String(err);
}

/**
 * @param {{ dataDir: string, debounceMs?: number }} opts
 */
export function createStorage(opts = {}) {
  const dataDir = opts.dataDir ? String(opts.dataDir) : process.cwd();
  const rawDebounce = Number(opts.debounceMs);
  const debounceMs = Number.isFinite(rawDebounce) && rawDebounce >= 0 ? rawDebounce : 300;

  const statePath = path.join(dataDir, STATE_FILE);
  const tmpPath = `${statePath}.tmp`;
  const brokenPath = `${statePath}.broken`;

  // Последнее состояние, переданное в save()/flush(). undefined — писать нечего.
  let lastState;
  let timer = null;
  // Очередь записей: любая операция ждёт предыдущую, поэтому rename'ы
  // не накладываются друг на друга.
  let chain = Promise.resolve();

  function enqueue(task) {
    // then(task, task) — очередь не «залипает» после чужой ошибки.
    const result = chain.then(task, task);
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** Атомарная запись одного файла: tmp → rename. */
  async function writeAtomic(filePath, content) {
    const tmp = `${filePath}.tmp`;
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(tmp, content, 'utf8');
    await fs.promises.rename(tmp, filePath);
  }

  /** Собственно запись состояния — всегда пишет ПОСЛЕДНЕЕ переданное. */
  async function writeState() {
    if (lastState === undefined) return; // save() ни разу не звали
    try {
      await writeAtomic(statePath, JSON.stringify(lastState, null, 2));
    } catch (err) {
      console.error(`[storage] Не удалось сохранить ${STATE_FILE}: ${reason(err)}`);
      throw err;
    }
  }

  function cancelTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Читает state.json. Нет файла → null. Битый JSON → .broken и null. */
  function load() {
    let raw;
    try {
      raw = fs.readFileSync(statePath, 'utf8');
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[storage] Не удалось прочитать ${STATE_FILE}: ${reason(err)}`);
      }
      return null;
    }
    try {
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('в файле не объект состояния');
      }
      return parsed;
    } catch (err) {
      console.warn(
        `[storage] ${STATE_FILE} битый (${reason(err)}), переименовываю в ${STATE_FILE}.broken, игра стартует с чистого листа`,
      );
      try {
        // Старый .broken перезаписываем: на Windows rename поверх файла падает.
        fs.rmSync(brokenPath, { force: true });
        fs.renameSync(statePath, brokenPath);
      } catch (renameErr) {
        console.warn(`[storage] Не удалось отложить битый ${STATE_FILE}: ${reason(renameErr)}`);
      }
      return null;
    }
  }

  /**
   * Ставит запись в очередь с дебаунсом. Несколько вызовов подряд —
   * одна запись с последним состоянием. Таймер заводится по ПЕРВОМУ вызову
   * и не продлевается следующими: при потоке изменений состояние всё равно
   * ляжет на диск не позже debounceMs. Не бросает и не возвращает промис.
   */
  function save(state) {
    lastState = state;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      enqueue(writeState).catch(() => {
        /* уже залогировано в writeState, save() наружу не падает */
      });
    }, debounceMs);
  }

  /** Пишет немедленно: отменяет отложенную запись и ждёт завершения. */
  function flush(state) {
    if (state !== undefined) lastState = state;
    cancelTimer();
    return enqueue(writeState);
  }

  /** Полный сброс: удаляет state.json и его tmp. Нет файла — не страшно. */
  function clear() {
    cancelTimer();
    lastState = undefined;
    return enqueue(async () => {
      try {
        await fs.promises.rm(statePath, { force: true });
        await fs.promises.rm(tmpPath, { force: true });
      } catch (err) {
        console.error(`[storage] Не удалось удалить ${STATE_FILE}: ${reason(err)}`);
        throw err;
      }
    });
  }

  function readBaseFile(fileName) {
    try {
      return parseBaseFile(fs.readFileSync(path.join(dataDir, fileName), 'utf8'));
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[storage] Не удалось прочитать ${fileName}: ${reason(err)}`);
      }
      return [];
    }
  }

  /** База карт из txt-файлов. Файлов нет → пустые массивы, без падений. */
  function loadBase() {
    return {
      prompts: readBaseFile(PROMPTS_FILE),
      answers: readBaseFile(ANSWERS_FILE),
    };
  }

  /**
   * Принимаем и массив строк, и одну строку с переносами —
   * из панели организатора приходит текст textarea как есть.
   */
  function toFileText(value) {
    let lines;
    if (typeof value === 'string') lines = value.split(/\r\n|\r|\n/);
    else if (Array.isArray(value)) lines = value.map((line) => (line == null ? '' : String(line)));
    else lines = [];
    // Одна карта — одна строка: перенос внутри элемента массива схлопываем.
    lines = lines.map((line) => line.replace(/[\r\n]+/g, ' ').trimEnd());
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
  }

  /** «Сохранить базу» из панели организатора. Атомарно, оба файла подряд. */
  function saveBase(data = {}) {
    const promptsText = toFileText(data && data.prompts);
    const answersText = toFileText(data && data.answers);
    return enqueue(async () => {
      try {
        await writeAtomic(path.join(dataDir, PROMPTS_FILE), promptsText);
        await writeAtomic(path.join(dataDir, ANSWERS_FILE), answersText);
      } catch (err) {
        console.error(`[storage] Не удалось сохранить базу карт: ${reason(err)}`);
        throw err;
      }
    });
  }

  return { load, save, flush, clear, loadBase, saveBase };
}
