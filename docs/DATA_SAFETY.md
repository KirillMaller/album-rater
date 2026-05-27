# DATA_SAFETY — Как не потерять данные R1Fрейтинга

Документ описывает **где живут данные**, **что их может разрушить**, **как делать бэкапы** и **как восстанавливаться**. Читать **до того** как делать что-либо потенциально опасное на проде.

## Главный принцип

```
Фронт (GitHub Pages)  ≠  Данные (Supabase Postgres)
обновляются каждым push     обновляются ТОЛЬКО через миграции или ручной SQL
```

**Обновление фронта (`git push origin main`) не трогает данные.** GitHub Actions пересобирает HTML/JS/CSS и кладёт в `gh-pages` ветку — Postgres даже не знает что что-то изменилось. Это безопасная операция, можно пушить столько раз сколько нужно.

## Что хранится и где

| Что | Где живёт | Можно потерять при | Как восстановить |
|---|---|---|---|
| Опубликованные карточки (альбомы / треки / баттлы), оценки, треклисты, ссылки | Supabase Postgres, таблицы `rated_items` / `track_scores` / `media_links` | Разрушающая SQL-миграция (`DROP`, `ALTER ... DROP COLUMN`); ручное удаление через Dashboard | Supabase PITR (Pro tier); локальный JSON-снапшот в `db/snapshots/`; ручное пересоздание через ту же админку |
| Аккаунты админов | Supabase Auth (`auth.users`) + наша таблица `admin_users` | Удаление через Dashboard → Authentication; `DROP TABLE admin_users` | Пересоздать админа вручную; восстановить `admin_users` из снапшота |
| Голоса зрителей за треки / альбомы / баттлы (с миграции 007) | Supabase Postgres, таблица `viewer_votes` | `DROP TABLE viewer_votes`; ручное удаление через Dashboard | Supabase PITR; локальный JSON-снапшот. Потеря голосов = пользователям нужно проголосовать заново. Самих аккаунтов это не затронет. |
| Аккаунты зрителей через Google OAuth | Supabase Auth (`auth.users`) | Удаление через Dashboard → Authentication | Зритель пройдёт OAuth снова, получит новый `user_id`. Старые голоса (привязанные к удалённому id) каскадно удалятся вместе с аккаунтом. |
| Несохранённые черновики в админке | `localStorage` в браузере Кирилла / R1Fmabes | Чистка кеша браузера; режим инкогнито | **Никак** — это локальное состояние редактора, его нет на сервере. Жми «Сохранить» чаще |
| Код фронта | git репо + GitHub Pages | `rm -rf` локально + force push | git pull, восстановить из истории; всё на GitHub |
| Прокси для Яндекс-импорта | VPS `bot-napominalka` + бэкап кода в `server/yandex-proxy/` | Удаление папки `/opt/yandex-proxy/` на VPS; падение VPS | Развернуть заново по [server/yandex-proxy/README.md](../server/yandex-proxy/README.md) |

## Что НЕ может сломать данные (безопасные операции)

- ✅ `git push origin main` — деплой фронта.
- ✅ Любые правки в `src/`, `public/`, `vite.config.ts`, `tsconfig*.json`, `package.json`.
- ✅ Добавление полей в `metadata jsonb` через код (без миграции БД) — старые записи просто не имеют этих полей.
- ✅ Добавление новых типов записей в `ItemType` на фронте — пока чек-constraint в БД не режет.
- ✅ Перезапуск `yandex-proxy.service` или `caddy` на VPS.

## Что МОЖЕТ сломать данные (опасные операции)

- ⚠️ **Разрушающие SQL-миграции** на Supabase: `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... NOT NULL` без default, `ALTER COLUMN ... TYPE` с потерей данных, `TRUNCATE TABLE`. **Никогда без снапшота.**
- ⚠️ **Очистка `admin_users`** — даже частичная. Если убрать всех админов, никто не сможет писать в каталог (RLS заблокирует). Восстановление — через service role или Supabase Dashboard.
- ⚠️ **Изменение RLS-политик** — если случайно сделать их слишком жёсткими, фронт перестанет читать данные (никаких потерь, но «всё пропало» визуально).
- ⚠️ **Чек-constraint на `type`** — если убрать значение `'battle'` (например), все баттлы перестанут читаться/писаться.
- ⚠️ **Удаление `metadata jsonb` колонки** — стирается ВСЯ информация о раундах баттлов, форматах, источниках Яндекса/YouTube.
- 🛑 **Полная переустановка VPS reg.cloud** через «Переустановить образ» — стирается всё: бот, прокси, ключи. Восстанавливать с нуля несколько часов.

## Правила миграций БД

1. **Все новые миграции — только additive.** То есть: `CREATE TABLE`, `ADD COLUMN ... NULL`, `ADD COLUMN ... NOT NULL DEFAULT ...`, `CREATE INDEX CONCURRENTLY`, `CREATE POLICY`, `GRANT`. Никаких `DROP` / `RENAME` / `TRUNCATE`.
2. **Перед любой миграцией** — снапшот (см. ниже). Даже если кажется что миграция безопасная.
3. **Миграции хранятся** в `db/migrations/` в формате `NNN_<имя>.sql` с растущим номером.
4. **Катятся через Supabase Dashboard → SQL Editor** (или через `supabase db push` в будущем). Никаких `psql` мимо системы миграций.
5. **Текущее состояние:** миграции `001_init.sql` и `002_add_track_type.sql` уже накачены вручную. Dashboard на главной показывает «No migrations» — это нормально (Supabase считает только то, что катилось через CLI).

## Как делать снапшот данных (страховка перед опасной операцией)

### Способ 1: Через Supabase Dashboard (рекомендую)

1. Зайти в https://supabase.com/dashboard/project/nfekasqbzwjelrwyxqmv
2. Слева → **Database** → **Backups**.
3. На Pro-tier работает **Point-in-Time Recovery** на 7 дней назад автоматически.
4. На Free-tier (наш случай) **автоматических бэкапов нет**, но есть `Logical Backup` — кнопка ручного дампа. Если её нет — переходим к способу 2.

### Способ 2: Локальный JSON-снапшот через Management API

Сохраняет содержимое таблиц в `db/snapshots/YYYY-MM-DD-<table>.json`. Эта папка **в gitignore**, в публичный репо не попадёт.

```bash
# Замени TOKEN на актуальный Supabase access token из ~/.claude/env/supabase.env
# или сгенерируй новый: https://supabase.com/dashboard/account/tokens
TOKEN="sbp_..."
DATE=$(date +%Y-%m-%d)
mkdir -p db/snapshots

for table in rated_items track_scores media_links admin_users auction_items auction_rules viewer_votes; do
  curl -s -X POST "https://api.supabase.com/v1/projects/nfekasqbzwjelrwyxqmv/database/query" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"SELECT json_agg(row_to_json(t)) AS data FROM (SELECT * FROM $table) t;\"}" \
    > "db/snapshots/$DATE-$table.json"
done

ls -la db/snapshots/
```

Из PowerShell (Windows) — то же самое, но через переменную и цикл `foreach`. Или сделать .ps1 скрипт.

### Способ 3: pg_dump (если когда-нибудь будет доступ к connection string)

```bash
pg_dump "postgresql://postgres:<password>@db.nfekasqbzwjelrwyxqmv.supabase.co:5432/postgres" > db/snapshots/$(date +%Y-%m-%d)-full.sql
```

Сейчас не используется — у Claude нет пароля от БД, всё идёт через Management API.

## Как восстановить из локального снапшота

JSON-снапшот можно превратить в `INSERT`-запросы и прогнать через Supabase SQL Editor.

```sql
-- Пример для одной записи rated_items
INSERT INTO rated_items (id, type, slug, title, ...) VALUES
('<id>', 'album', 'donda', 'DONDA', ...)
ON CONFLICT (id) DO UPDATE SET ...;
```

Это руками. Для большого объёма данных написать одноразовый Python-скрипт который читает JSON и генерирует SQL.

## Что делать перед опасными изменениями — чек-лист

Перед: миграцией БД, рефакторингом `metadata jsonb`, изменением RLS, удалением колонки, любым `DROP`:

- [ ] Сделать снапшот данных (Способ 2).
- [ ] Проверить файл `db/snapshots/<сегодня>-rated_items.json` — есть содержимое, не пустой.
- [ ] Открыть Supabase Dashboard в браузере, чтобы Кирилл видел текущее состояние перед изменением.
- [ ] Получить от Кирилла **явное подтверждение** что операция нужна и риск понятен.
- [ ] Если операция написана сразу для нескольких таблиц — разбить на отдельные шаги и катить по одному.
- [ ] После применения — проверить что данные на месте (`SELECT count(*) FROM rated_items` и т.п.).

## Что делать если данные всё-таки потерялись

1. **Не паниковать**, ничего больше не трогать.
2. **Не пушить ничего в main** — каждый деплой это лишняя точка ввода ошибки.
3. Проверить **локальный снапшот** в `db/snapshots/` — если есть, восстановиться.
4. Если есть Pro-tier — Supabase Dashboard → Database → Backups → восстановиться через PITR на нужную дату.
5. Если **ничего нет** — карточки придётся пересоздавать вручную через админку. **Это и есть тот сценарий которого мы избегаем.**

## Передача каталога R1Fmabes — отдельный чек-лист

Перед тем как давать ссылку:

1. **Удалить тестовые / мусорные записи** в админке (на 2026-05-18 они уже удалены, проверять каждый раз перед демонстрацией).
2. **Сделать снапшот** через способ 2 выше — точка возврата на «момент перед запуском».
3. **Завести R1Fmabes собственный аккаунт** в Supabase Auth (через регистрацию на `/admin` под его email) — **не отдавать ему пароль Кирилла**. Добавить его `user_id` в `admin_users` через SQL Editor:
   ```sql
   INSERT INTO admin_users (user_id, email) VALUES (
     (SELECT id FROM auth.users WHERE email = 'rifmabes@example.com'),
     'rifmabes@example.com'
   );
   ```
4. **Проверить что сессия Кирилла отдельная от его сессии** — выйти / зайти, ничего не путается.
5. После этого можно отдавать ссылку. Если он сольёт пароль или потеряет — можно отозвать его строку из `admin_users` (`DELETE FROM admin_users WHERE email = ...`), и его аккаунт перестанет иметь права. Данные при этом останутся.

## Глобальные правила для Claude (мои)

- Никогда не катить `DROP` / `TRUNCATE` / `ALTER ... DROP` без явного «да, делай» от Кирилла, и без свежего снапшота.
- Никогда не запускать `supabase db reset` или эквивалент.
- Никогда не делать `git push --force` в `main`.
- Перед любой миграцией — отдельный диалог с Кириллом, где я ему объясняю что произойдёт.
- Любые правки в `admin_users` — только с явным согласием.
- Если что-то пошло не так — стоп, спрашиваю Кирилла, не пытаюсь «починить» молча.

## 🔗 Якоря

- Текущая схема БД: [db/migrations/001_init.sql](../db/migrations/001_init.sql)
- Аддитивная миграция: [db/migrations/002_add_track_type.sql](../db/migrations/002_add_track_type.sql)
- Snapshot-папка (gitignored): [db/snapshots/](../db/snapshots/)
- Supabase Dashboard: https://supabase.com/dashboard/project/nfekasqbzwjelrwyxqmv
- Архитектура проекта: [ARCHITECTURE.md](ARCHITECTURE.md)
