# CLAUDE.md — album-rater (R1fрейтинг)

Локальная шпаргалка для Claude Code. Глобальные правила Кирилла берутся из `~/.claude/CLAUDE.md` — здесь только то, что специфично для **этого** репо.

## Что это вообще

**R1fрейтинг** — сайт-каталог оценок стримера **Рифмабеса**. Он стримит на YouTube / Twitch / Boosty: баттл-рэп (сам баттлер), реакции на баттлы и треки, обзоры альбомов, фильмы и аниме по донатам, плюс свои треки.

Сайт нужен чтобы:

- Рифмабесу было **удобно вести каталог** того что он оценивает (вставил ссылку — всё заполнилось само).
- Зрителям было где **смотреть его оценки** в одном месте.
- **В будущем:** зрители смогут голосовать сами — один аккаунт = один голос за трек или раунд баттла. Тогда на каждой карточке будет **две оценки**: стримера и зрителей.

Это **личный проект Кирилла**, отдельный от платформы Yvane. Здесь **Supabase Cloud** (`*.supabase.co`), а **не** self-hosted Postgres на VPS. Никита в этот репо не лазит.

## Стек

- **Frontend:** React 18 + Vite 6 + TypeScript, React Router, lucide-react, react-markdown.
- **Backend:** Supabase Cloud (Postgres + Auth + RLS, проект `nfekasqbzwjelrwyxqmv` под аккаунтом `KirillMaller's Org`). В демо-режиме (без `.env.local`) данные живут в `localStorage`.
- **Яндекс-импорт:** отдельный Node.js-прокси на VPS в РФ (см. ниже).
- **Деплой:** GitHub Pages, ветка `main` → workflow `.github/workflows/deploy.yml`. Vite собирает с `base: '/album-rater/'`.
- **SPA-фоллбек на Pages:** `public/404.html` перехватывает прямые ссылки.

## Карта файлов

| Файл / папка | Что внутри |
|---|---|
| [src/main.tsx](src/main.tsx) | **Вся логика SPA**: типы, маршруты, страницы, редактор, импорт Яндекса. ~1300 строк, монолит. |
| [src/styles.css](src/styles.css) | Все стили. |
| [vite.config.ts](vite.config.ts) | Vite-конфиг. Минимальный — только React-плагин и base-путь. |
| [db/migrations/001_init.sql](db/migrations/001_init.sql) | Базовая схема: `rated_items`, `track_scores`, `media_links`, `admin_users`, RLS, `is_admin()`. |
| [db/migrations/002_add_track_type.sql](db/migrations/002_add_track_type.sql) | Добавляет тип `track` и колонку `metadata jsonb`. На живой Supabase **ещё не накачено** — задача в спринте. |
| [server/yandex-proxy/](server/yandex-proxy/) | **Код прокси для Яндекс.Музыки** (бэкап того что крутится на VPS). См. подробный README в этой папке. |
| [supabase/](supabase/) | Конфиг для Supabase CLI (`config.toml`, привязка к проекту). Edge Functions не используем — провалились на гео-блоке Яндекса. |
| [public/404.html](public/404.html) | SPA-фоллбек для GitHub Pages. |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | Сборка и деплой. Секреты: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_YANDEX_PROXY_URL`. |
| [index.legacy-backup.html](index.legacy-backup.html) | Старая одностраничная версия. Не трогать, архив. |

## Инфраструктура

### Supabase Cloud (проект R1Frating)

- URL: `https://nfekasqbzwjelrwyxqmv.supabase.co`
- Регион: West EU (Ireland), Free Tier.
- Доступ через CLI: `npx supabase` (поставлен как dev-зависимость в `package.json`). Auth-token хранится у Кирилла, у Claude — через env-переменную `SUPABASE_ACCESS_TOKEN`.
- Edge Functions **не используем** для Яндекса — гео-блок не пускает к `api.music.yandex.net` из EU.

### VPS `bot-napominalka` на reg.cloud

- IP: `195.208.3.209`, Ubuntu 24.04 LTS, Free Tier (1 CPU, 1GB RAM, 10GB).
- На этом же сервере уже жил Telegram-бот Кирилла (`bot-napominalka.service` → `/opt/bot-napominalka/` на Node.js v25 через nvm). **Бот не трогать.**
- Дополнительно поднято:
  - **`yandex-proxy.service`** — наш Node.js-прокси на 127.0.0.1:3001. Код — в [server/yandex-proxy/](server/yandex-proxy/).
  - **Caddy** — HTTPS-фронт на 80/443 с автоматическим Let's Encrypt-сертификатом.
- SSH-доступ: ключ `~/.ssh/bot-napominalka-reg-ru` (приватный) уже разрешён на сервере для root.
- Прокси доступен извне: `https://195.208.3.209.sslip.io/yandex-music/import?url=...`. Домен — sslip.io (auto-DNS, бесплатно, ничего регистрировать не нужно).

### GitHub Pages (фронт)

- Деплоится автоматически при push в `main` через `.github/workflows/deploy.yml`.
- Секреты в репо: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_YANDEX_PROXY_URL`.

## Запуск локально

```bash
npm install
npm run dev   # http://127.0.0.1:5173/album-rater/
npm run build # tsc + vite build → dist/
```

Без `.env.local` — демо-режим на `localStorage`, импорт Яндекса не работает.

С `.env.local` (по `.env.example`) — Supabase + Яндекс-импорт через тот же VPS-прокси что и на проде.

## Импорт из Яндекс.Музыки — как это работает

```
Frontend (GitHub Pages, HTTPS)
  ↓ запрос на VITE_YANDEX_PROXY_URL
Caddy (195.208.3.209, HTTPS-фронт + Let's Encrypt)
  ↓ reverse_proxy
Node.js yandex-proxy (127.0.0.1:3001)
  ↓ HTTPS-запрос
api.music.yandex.net (видит русский IP, отдаёт JSON)
```

Код прокси и инструкции по поддержке — в [server/yandex-proxy/README.md](server/yandex-proxy/README.md).

## Git и workflow

- Ветка `main` → автодеплой на GitHub Pages. **Сначала проверка в браузере, потом коммит** — это правило из глобального CLAUDE.md.
- Не коммитить без явного «коммить» от Кирилла.
- В этом репо нет PR-флоу с Никитой — Кирилл единственный мейнтейнер, пушит в `main` напрямую.
- Не коммитить `.env.local`, `dist/`, `node_modules/`, `supabase/.temp/`.

## Что читать при старте сессии

1. Этот `CLAUDE.md`.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — продуктовая логика и доменные понятия.
3. [docs/BACKLOG.md](docs/BACKLOG.md) — что в очереди.
4. Свежий спринт в [team/sprints/](team/sprints/).
5. [docs/CHANGELOG.md](docs/CHANGELOG.md) — что менялось для пользователя.

## Чего тут **нет** (чтобы не искать)

- Тестов. Совсем.
- Линтера / prettier / husky.
- Отдельных компонентов вне `main.tsx` (всё в одном файле).
- Bitrix / Yvane инфраструктуры — это другой проект.
