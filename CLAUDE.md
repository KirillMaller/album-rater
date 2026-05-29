# CLAUDE.md — album-rater (R1Fрейтинг)

Локальная шпаргалка для Claude Code. Глобальные правила Кирилла берутся из `~/.claude/CLAUDE.md` — здесь только то, что специфично для **этого** репо.

## Что это вообще

**R1Fрейтинг** — сайт-каталог оценок стримера **R1Fmabes**. Он стримит на YouTube / Twitch / Boosty: баттл-рэп (сам баттлер), реакции на баттлы и треки, обзоры альбомов, фильмы и аниме по донатам, плюс свои треки.

Прод: **https://rifmabes.ru/**.

Сайт нужен чтобы:

- R1Fmabes было **удобно вести каталог** того что он оценивает (вставил ссылку — всё заполнилось само).
- Зрителям было где **смотреть его оценки** в одном месте.
- Зрители могли **голосовать сами** — один Google-аккаунт = один голос за трек / альбом / итог баттла. На каждой карточке две оценки: R1Fmabes и средняя зрителей.

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
| [src/main.tsx](src/main.tsx) | **Вся логика SPA**: типы, маршруты, страницы, редактор, импорт Яндекса, аукционы, голосование зрителей. ~5000 строк, монолит. |
| [src/styles.css](src/styles.css) | Все стили. |
| [vite.config.ts](vite.config.ts) | Vite-конфиг. React-плагин, `base: '/'`, `manualChunks` для разделения вендор-зависимостей (react/markdown/supabase/icons) — даёт хорошее кеширование на повторных заходах. |
| [db/migrations/001_init.sql](db/migrations/001_init.sql) | Базовая схема: `rated_items`, `track_scores`, `media_links`, `admin_users`, RLS, `is_admin()`. |
| [db/migrations/002_add_track_type.sql](db/migrations/002_add_track_type.sql) | Добавляет тип `track` и колонку `metadata jsonb`. |
| [db/migrations/003_auction_items.sql](db/migrations/003_auction_items.sql) | Таблица очереди аукционов (`auction_items`) + RLS. |
| [db/migrations/004_auction_rules.sql](db/migrations/004_auction_rules.sql) | Таблица правил аукционов (markdown по `scope`). |
| [db/migrations/005_reviewed_at.sql](db/migrations/005_reviewed_at.sql) | Поле `reviewed_at date` в `rated_items`. |
| [db/migrations/006_score_up_to_11.sql](db/migrations/006_score_up_to_11.sql) | Расширение границ оценки до 0..11. |
| [db/migrations/007_viewer_votes.sql](db/migrations/007_viewer_votes.sql) | Таблица `viewer_votes` (голоса зрителей за треки/альбомы/баттлы) + RLS (читать всем, писать только свой голос) + уникальный индекс. |
| [db/migrations/008_viewer_profiles.sql](db/migrations/008_viewer_profiles.sql) | Таблица `viewer_profiles` — хранит факт согласия зрителя на ПДн (`consented_at`, `consent_version`). RLS «свой профиль только сам». |
| [db/migrations/009_viewer_votes_require_consent.sql](db/migrations/009_viewer_votes_require_consent.sql) | Ужесточение RLS на `viewer_votes`: insert/update только если в `viewer_profiles` есть `consented_at`. |
| [db/migrations/010_viewer_votes_track_position.sql](db/migrations/010_viewer_votes_track_position.sql) | Колонка `track_position` в `viewer_votes` — голос за отдельный трек альбома. Расширен unique-индекс с `coalesce(round_index, -1), coalesce(track_position, -1)`. |
| [db/migrations/011_viewer_votes_is_best.sql](db/migrations/011_viewer_votes_is_best.sql) | Колонка `is_best` — зритель может пометить трек как «свой лучший» (лимит 3 на стороне фронта). |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Политика конфиденциальности (рендерится на странице `/privacy` через react-markdown, импортируется как `?raw`). |
| [docs/USER_AGREEMENT.md](docs/USER_AGREEMENT.md) | Условия использования (рендерится на странице `/terms`). |
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
- **Миграции 001-011 накачены на проде** (через Management API `POST /v1/projects/nfekasqbzwjelrwyxqmv/database/query`). Token — в `~/.claude/env/supabase.env` как `SUPABASE_ACCESS_TOKEN`.
- В `admin_users` два email: `kirillmakarov820@gmail.com` (Кирилл) и `r1fmabes.rating@gmail.com` (R1Fmabes-стример).
- **Google OAuth провайдер включён** в Auth → Providers → Google. Client ID + Secret в `~/.claude/env/google-oauth.env`. App в Google Cloud (проект `r1frating`) в Production mode, External.
- Edge Functions **не используем** для Яндекса — гео-блок не пускает к `api.music.yandex.net` из EU.

### VPS на reg.cloud (исторически `bot-napominalka`)

- IP: `195.208.3.209`, Ubuntu 24.04 LTS, Free Tier (1 CPU, 1GB RAM, 10GB).
- На этом VPS сейчас живут **только** сервисы для этого проекта (album-rater):
  - **`yandex-proxy.service`** — наш Node.js-прокси на 127.0.0.1:3001. Код — в [server/yandex-proxy/](server/yandex-proxy/).
  - **Caddy** — HTTPS-фронт на 80/443 с автоматическим Let's Encrypt-сертификатом.
- ⚠️ **История имени:** до 2026-05-26 на этом VPS дополнительно жил Telegram-бот напоминаний Кирилла (`bot-napominalka.service` + локальный `xray.service` как Telegram-прокси). Поэтому VPS на reg.cloud до сих пор называется `bot-napominalka`. После переезда бота на Aeza Frankfurt всё связанное с ботом удалено: `/opt/bot-napominalka/` → нет, `bot-napominalka.service` → нет, `xray.service` + бинарь → нет. На VPS остались только `yandex-proxy` + Caddy + системное.
- SSH-доступ: ключ `~/.ssh/bot-napominalka-reg-ru` (приватный) уже разрешён на сервере для root. Также есть root-пароль (хранится у Кирилла отдельно от репо).
- Прокси доступен извне: `https://195.208.3.209.sslip.io/yandex-music/import?url=...`. Домен — sslip.io (auto-DNS, бесплатно, ничего регистрировать не нужно).

### GitHub Pages (фронт)

- Прод-URL: `https://rifmabes.ru/` (кастомный домен).
- Репо: [github.com/KirillMaller/album-rater](https://github.com/KirillMaller/album-rater) (публичный).
- Деплоится автоматически при push в `main` через `.github/workflows/deploy.yml`.
- Секреты в репо (все три заведены): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_YANDEX_PROXY_URL`.
- **Кастомный домен `rifmabes.ru`** куплен на reg.ru 2026-05-18. DNS: 4 A-записи на 185.199.108-111.153 (IP GitHub Pages) + CNAME `www` на `kirillmaller.github.io.`. Файл `public/CNAME` в репо. `vite.config.ts` base=`/`, роутер без basename.
- Старая ссылка `kirillmaller.github.io/album-rater/` теперь редиректит на новый домен (GitHub Pages обслуживает только cname).

### ⚠️ Известная проблема: Supabase Cloud в России

Российские пользователи могут видеть **медленный** или **частично нерабочий** сайт. Причина: домен Supabase Cloud (`*.supabase.co` / `nfekasqbzwjelrwyxqmv.supabase.co`) живёт за CDN-подсетями, которые РКН периодически захватывает / замедляет через ТСПУ. С российского IP запросы к Supabase API могут долго висеть или отваливаться по таймауту, что ломает логин, чтение каталога и т.д.

Симптомы у пользователя из РФ:
- белый экран / долгая загрузка,
- «не удалось войти» при OAuth,
- каталог открывается но без оценок (RLS-запросы упали).

Сайт **работает нормально** с зарубежного IP (VPN, или просто заграница).

**Путь решения (НЕ сделан, на будущее)** — прокси Supabase через тот же VPS на reg.cloud где живёт `yandex-proxy`:

1. В Caddyfile добавить блоки `handle /supabase/rest/v1/*`, `/supabase/auth/v1/*`, `/supabase/storage/v1/*` (и `/supabase/realtime/v1/*` если используется) с `reverse_proxy https://nfekasqbzwjelrwyxqmv.supabase.co` для каждого.
2. В коде фронта (`src/main.tsx` или `.env.local`/Pages secrets) заменить `VITE_SUPABASE_URL=https://nfekasqbzwjelrwyxqmv.supabase.co` на `https://195.208.3.209.sslip.io/supabase`.
3. Передеплоить (push в main → Pages подхватит).
4. С российского IP запросы будут идти на российский же VPS sslip.io (быстро), а оттуда уже на Supabase (датацентр-к-датацентру, тоже быстро).

Сложности:
- WebSocket для **Realtime** (если когда-то включим подписки) нужно проксировать отдельно с `transport http { versions h1 h2c }`.
- Storage больших файлов может потребовать увеличить `request_body` / таймауты Caddy.
- CORS обычно работает «из коробки», но preflight `OPTIONS` Supabase отвечает с `Allow-Origin: *` — если нет, придётся переписывать в Caddy.

Это разовая работа на 1-2 часа когда руки дойдут. Не блокирует разработку — фича работает заграницей.

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
- Не коммитить `.env.local`, `.env*.bak`, `dist/`, `node_modules/`, `supabase/.temp/`, `db/snapshots/*` (кроме README).

### ⚠ Перед каждым push — прогнать сборку

`npm run build` в CI делает `tsc` перед `vite build`. Если TypeScript падает — деплой падает молча, прод остаётся на старой версии. Пользователь думает что фронт сломан, на самом деле просто не обновился.

**Правило:** перед `git push` всегда:
1. `npx tsc --noEmit` (быстро, ~3 сек) — для правок в .tsx/.ts.
2. Или полный `npm run build` — если меняли импорты, зависимости, типы.

Если падает — фиксить и только потом пушить. Чисто `.md`-коммиты можно пушить без билда.

Был кейс 2026-05-27: 3 коммита подряд упали на TS2741 «Property 'isBest' is missing». 2 часа потеряно на разбор «почему прод не обновляется».

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
