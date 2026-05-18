# CLAUDE.md — album-rater (R1fрейтинг)

Локальная шпаргалка для Claude Code. Глобальные правила Кирилла берутся из `~/.claude/CLAUDE.md` — здесь только то, что специфично для **этого** репо.

## Что это вообще

**R1fрейтинг** — сайт-каталог оценок стримера **Рифмабеса**. Он стримит на YouTube / Twitch / Boosty: баттл-рэп (сам баттлер), реакции на баттлы и треки, обзоры альбомов, фильмы и аниме по донатам, плюс свои треки.

Прод: **https://rifmabes.ru/**.

Сайт нужен чтобы:

- Рифмабесу было **удобно вести каталог** того что он оценивает (вставил ссылку — всё заполнилось само).
- Зрителям было где **смотреть его оценки** в одном месте.
- **В будущем:** зрители смогут голосовать сами — один аккаунт = один голос за трек или раунд баттла. Тогда на каждой карточке будет **две оценки**: стримера и зрителей.

Это **личный проект Кирилла**, отдельный от платформы Yvane. Здесь **Supabase Cloud** (`*.supabase.co`), а **не** self-hosted Postgres на VPS. Никита в этот репо не лазит.

## Стек

- **Frontend:** React 18 + Vite 6 + TypeScript, React Router, lucide-react, react-markdown.
- **Backend:** Supabase Cloud (Postgres + Auth + RLS, проект `nfekasqbzwjelrwyxqmv` под аккаунтом `KirillMaller's Org`). В демо-режиме (без `.env.local`) данные живут в `localStorage`.
- **Яндекс-импорт:** отдельный Node.js-прокси на VPS в РФ (см. ниже).
- **Деплой:** GitHub Pages, ветка `main` → workflow `.github/workflows/deploy.yml`, кастомный домен `rifmabes.ru`. Vite собирает с `base: '/'`.
- **SPA-фоллбек на Pages:** `public/404.html` перехватывает прямые ссылки.

## Карта файлов

| Файл / папка | Что внутри |
|---|---|
| [src/main.tsx](src/main.tsx) | **Вся логика SPA**: типы, маршруты, страницы, редактор, импорт Яндекса, аукционы. ~2350 строк, монолит. |
| [src/styles.css](src/styles.css) | Все стили. |
| [vite.config.ts](vite.config.ts) | Vite-конфиг. Минимальный — только React-плагин и `base: '/'` (с момента переезда на кастомный домен). |
| [db/migrations/001_init.sql](db/migrations/001_init.sql) | Базовая схема: `rated_items`, `track_scores`, `media_links`, `admin_users`, RLS, `is_admin()`. |
| [db/migrations/002_add_track_type.sql](db/migrations/002_add_track_type.sql) | Добавляет тип `track` и колонку `metadata jsonb`. |
| [db/migrations/003_auction_items.sql](db/migrations/003_auction_items.sql) | Таблица очереди аукционов (`auction_items`) + RLS. |
| [db/migrations/004_auction_rules.sql](db/migrations/004_auction_rules.sql) | Таблица правил аукционов (markdown по `scope`). |
| [db/migrations/005_reviewed_at.sql](db/migrations/005_reviewed_at.sql) | Поле `reviewed_at date` в `rated_items`. |
| [db/migrations/006_score_up_to_11.sql](db/migrations/006_score_up_to_11.sql) | Расширение границ оценки до 0..11. Все шесть миграций накачены на проде вручную через Management API/SQL Editor. |
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
- **Миграции 001-006 накачены на проде** (через SQL Editor / Management API, не через `supabase db push` — поэтому Supabase Dashboard на главной странице показывает «No migrations»). Проверить состояние схемы: `POST https://api.supabase.com/v1/projects/nfekasqbzwjelrwyxqmv/database/query`.
- В `admin_users` два email: `kirillmakarov820@gmail.com` (Кирилл) и `r1fmabes.rating@gmail.com` (Рифмабес-стример).
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

- Прод-URL: `https://rifmabes.ru/` (кастомный домен).
- Репо: [github.com/KirillMaller/album-rater](https://github.com/KirillMaller/album-rater) (публичный).
- Деплоится автоматически при push в `main` через `.github/workflows/deploy.yml`.
- Секреты в репо (все три заведены): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_YANDEX_PROXY_URL`.
- **Кастомный домен `rifmabes.ru`** куплен на reg.ru 2026-05-18. DNS: 4 A-записи на 185.199.108-111.153 (IP GitHub Pages) + CNAME `www` на `kirillmaller.github.io.`. Файл `public/CNAME` в репо. `vite.config.ts` base=`/`, роутер без basename.
- Старая ссылка `kirillmaller.github.io/album-rater/` теперь редиректит на новый домен (GitHub Pages обслуживает только cname).

## Запуск локально

```bash
npm install
npm run dev   # http://127.0.0.1:5173/
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

## Импорт с YouTube — для баттлов

```
Браузер пользователя
  ↓ fetch напрямую (CORS открыт для нашего домена)
YouTube oEmbed (https://www.youtube.com/oembed)
  ↓ парсинг в parseBattleTitle()
заполнение формы редактора баттла
```

**VPS-прокси для YouTube НЕ используется** — VPS на reg.cloud режет трафик к YouTube (как и к Telegram), а из браузера CORS открыт, всё работает напрямую. Подробности — в [docs/ARCHITECTURE.md → Импорт баттлов с YouTube](docs/ARCHITECTURE.md#импорт-баттлов-с-youtube).

## Git и workflow

- Ветка `main` → автодеплой на GitHub Pages. **Сначала проверка в браузере, потом коммит** — это правило из глобального CLAUDE.md.
- Не коммитить без явного «коммить» от Кирилла.
- В этом репо нет PR-флоу с Никитой — Кирилл единственный мейнтейнер, пушит в `main` напрямую.
- Не коммитить `.env.local`, `dist/`, `node_modules/`, `supabase/.temp/`, `db/snapshots/*` (кроме README).

## ⚠️ Безопасность данных — обязательно прочитать перед опасными операциями

**Главное правило:** обновление фронта (`git push`) НИКОГДА не трогает данные на Supabase. Это безопасная операция. Что **может** разрушить данные — миграции БД с `DROP` / `TRUNCATE` / `ALTER ... DROP COLUMN`, и удаление через Dashboard.

**Перед любой потенциально разрушающей операцией:**

1. Прочитать [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md) — там полный runbook со списком опасных операций, как делать снапшоты, как восстанавливаться.
2. Сделать локальный JSON-снапшот данных через Supabase Management API (команда в DATA_SAFETY.md).
3. Получить от Кирилла **явное подтверждение** что эта операция нужна и риск понятен.
4. Никогда не катить `DROP TABLE` / `TRUNCATE` / `git push --force в main` / `supabase db reset` без явного «да».
5. Все новые миграции — **только additive** (`CREATE TABLE`, `ADD COLUMN`, etc.). Никаких `DROP` / `RENAME`.

**Если что-то пошло не так** — стоп, сразу к Кириллу. Не пытаться чинить молча.

## Что читать при старте сессии

1. Этот `CLAUDE.md`.
2. [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md) — **обязательно** перед любой работой с БД.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — продуктовая логика и доменные понятия.
4. [docs/BACKLOG.md](docs/BACKLOG.md) — что в очереди.
5. Свежий спринт в [team/sprints/](team/sprints/).
6. [docs/CHANGELOG.md](docs/CHANGELOG.md) — что менялось для пользователя.

## Чего тут **нет** (чтобы не искать)

- Тестов. Совсем.
- Линтера / prettier / husky.
- Отдельных компонентов вне `main.tsx` (всё в одном файле).
- Bitrix / Yvane инфраструктуры — это другой проект.
