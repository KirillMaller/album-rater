# db/snapshots/

Локальные снапшоты данных с прод-Supabase. Папка **не коммитится в git** (см. `.gitignore`).

Формат — JSON-файлы из `SELECT json_agg(...) FROM <table>`. Имя файла: `YYYY-MM-DD-<имя_таблицы>.json`.

## Как сделать новый снапшот

См. подробности в [docs/DATA_SAFETY.md](../../docs/DATA_SAFETY.md). Кратко — четыре curl-команды через Supabase Management API.

## Как восстановить из снапшота

См. [docs/DATA_SAFETY.md](../../docs/DATA_SAFETY.md) → секция «Восстановление из локального снапшота».
