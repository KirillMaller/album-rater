# R1Fрейтинг

React/Vite сайт-каталог оценок стримера **R1Fmabes**: альбомы, треки, баттлы, реакции. С зрительским голосованием через Google OAuth.

Прод: **https://rifmabes.ru/**.

## Быстрый контекст

R1Fmabes стримит на YouTube / Twitch / Boosty: баттл-рэп, реакции, обзоры альбомов, фильмы и аниме по донатам. Сайт — каталог его оценок в одном месте плюс публичное голосование зрителей.

Текущий статус: рабочий прод. Публичная часть показывает каталог с двумя оценками на карточке (R1F + средняя зрителей), страницы записей с треклистами/раундами баттлов, аукционы. Админка (Кирилл, R1Fmabes) позволяет завести запись, вставить треклист, поставить оценки. Импорт с Яндекс.Музыки идёт через Node.js-прокси на российском VPS. Зрители заходят через Google, подтверждают условия один раз, дальше голосуют за треки/альбомы/баттлы.

## Документация

Если ты Claude Code — читай в таком порядке:

1. [CLAUDE.md](CLAUDE.md) — что за проект, стек, карта файлов.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — продуктовая логика, схема БД, как устроен импорт.
3. [docs/BACKLOG.md](docs/BACKLOG.md) — что в очереди по приоритетам.
4. [team/sprints/](team/sprints/) — текущий спринт с пошаговыми задачами.
5. [docs/CHANGELOG.md](docs/CHANGELOG.md) — что менялось для пользователя.
6. [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md) — runbook по сохранности данных, обязательно перед миграциями БД.
7. [docs/PRIVACY.md](docs/PRIVACY.md) — политика конфиденциальности сайта (доступна на /privacy).
8. [server/yandex-proxy/README.md](server/yandex-proxy/README.md) — как устроен и поддерживается прокси для Яндекса.

## Запуск локально

```bash
npm install
npm run dev   # http://127.0.0.1:5173/  (порт может быть выше если занят)
npm run build # tsc + vite build → dist/
```

Без `.env.local` приложение работает в демо-режиме через `localStorage`. Для Supabase и Яндекс-импорта добавьте:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_YANDEX_PROXY_URL=https://195.208.3.209.sslip.io
```

Шаблон — в [.env.example](.env.example).

Старая рабочая одностраничная версия сохранена как [index.legacy-backup.html](index.legacy-backup.html).
