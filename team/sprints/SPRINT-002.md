# SPRINT-002 — Голосование зрителей и правовая база

- **Период:** 2026-05-27 — открыт.
- **Фокус:** добавить вход зрителей через Google OAuth, дать им голосовать за треки/альбомы/баттлы, и привести сайт в соответствие с 152-ФЗ (политика, согласие, возраст).
- **Источник правды по приоритетам:** [docs/BACKLOG.md](../../docs/BACKLOG.md) → задачи 04 «Голосование зрителей» + 05 «Две оценки на карточке».
- **Статус спринта:** 🚧 в работе.

---

## Сводная таблица задач

| № | Задача | Приоритет | Статус |
|---|---|---|---|
| 01 | **Прокси Supabase через VPS Caddy** — handle_path `/supabase/*` на `bot-napominalka` для ускорения сайта из РФ | 🔴 P0 | 🔁 откатили — POST к Auth висит на Cloudflare; GET работает |
| 02 | **Google Cloud OAuth setup** — проект R1frating, OAuth client (Web), origins/redirect URIs, app в Production | 🔴 P0 | ✅ выполнено 2026-05-26 |
| 03 | **Google провайдер в Supabase** — Client ID/Secret из Google Cloud, switch Enabled | 🔴 P0 | ✅ выполнено 2026-05-26 |
| 04 | **Гигиена: сменить пароль r1fmabes.rating@gmail.com** (засветился в чате) | 🔴 P0 | ✅ выполнено 2026-05-27 **(15 мин)** — через Supabase Admin API |
| 05 | **Гигиена: ротировать Client Secret Google OAuth** (засветился в чате) | 🔴 P0 | ✅ выполнено 2026-05-27 **(30 мин)** — новый `****Inw8` в Supabase, старый `****RmZZ` Disabled+Deleted в Google Cloud |
| 06 | **Политика конфиденциальности** — страница `/privacy`, текст под 152-ФЗ + GDPR | 🔴 P0 | ✅ выполнено 2026-05-27 **(90 мин)** — 16 разделов, имя «Кирилл Маллер», 16+, без раскрытия инфраструктуры |
| 07 | **Условия использования** — страница `/terms`, правила контента и голосования | 🔴 P0 | ✅ выполнено 2026-05-27 **(45 мин)** — 13 разделов, по образцу risazatvorchestvo.com, лимит ответственности 1 ₽ |
| 08 | **Согласие на обработку ПДн** — чекбокс при первом входе через Google со ссылкой на /privacy | 🔴 P0 | ⏳ |
| 09 | **Email для связи** — `kirill_makfarov@bk.ru`, указан в политике, условиях и футере (через ссылки на /privacy и /terms) | 🟠 P1 | ✅ выполнено 2026-05-27 — вариант A (существующий ящик) |
| 10 | **Возрастная плашка 16+** — модалка при первом заходе или плашка в футере | 🟠 P1 | ⏳ — упоминание 16+ есть в политике и условиях, но визуальной плашки пока нет |
| 11 | **Миграция БД 007: viewer_votes** — таблица голосов зрителей + RLS + уникальный индекс на (viewer_id, item_id, round_index) | 🔴 P0 | ✅ выполнено 2026-05-27 **(20 мин)** — накачено через SQL Editor |
| 12 | **Кнопка «Войти через Google»** в шапке сайта + AuthBadge с аватаркой и меню | 🔴 P0 | ✅ выполнено 2026-05-27 **(60 мин)** — `signInWithOAuth({provider:'google'})`, Site URL/Redirect URLs в Supabase, Supabase автоматически линкует Google identity с существующим email+password аккаунтом |
| 13 | **UI голосования за трек/альбом** — слайдер «Поставь свою оценку» на странице записи + запись в viewer_votes | 🔴 P0 | ⏳ |
| 14 | **Две оценки на карточке** — рендер «оценка Рифмабеса X / оценка зрителей Y (N голосов)» в карточке и на странице записи | 🟠 P1 | ⏳ |
| 15 | **UI голосования за баттл** — выбор победителя раунда (A/B/ничья) + итог баттла, запись в viewer_votes | 🟠 P1 | ⏳ |
| 16 | **Кнопка «Удалить аккаунт»** в профиле зрителя (по 152-ФЗ право субъекта на удаление) | 🟡 P2 | ⏳ |
| 17 | **Чинить Supabase Auth через прокси** — TLS SNI в Caddy или Node.js прокси по образцу yandex-proxy | 🟡 P2 | ⏳ |
| 18 | **Уведомление в Роскомнадзор** об обработке ПДн (152-ФЗ ст. 22) — через rkn.gov.ru или Госуслуги | 🟡 P2 | ⏳ |
| 19 | **Локализация ПДн в РФ** (152-ФЗ ст. 18.5) — первичная запись в БД на территории РФ. Сейчас Supabase в Ireland | 🟢 P3 | ⏳ обдумываем |
| 20 | **Favicon сайта** — SVG-иконка R1 в фирменном градиенте во вкладке браузера | 🟡 P2 | ✅ выполнено 2026-05-27 **(10 мин)** — `public/favicon.svg` + `<link rel="icon">` в index.html |

## Легенда

**Приоритеты:** 🔴 P0 блокер · 🟠 P1 важное · 🟡 P2 улучшение · 🟢 P3 идея.

**Статусы:** ✅ выполнено · ⏳ запланировано · 🚧 в работе · 🔁 в ревью/откат · ❌ отменено · 🛑 заблокировано.

---

## Время по дням

### 2026-05-26 (вт)

| Задача | Факт |
|---|---|
| Задача 01 — Caddy reverse_proxy `/supabase/*` на VPS + локальный/прод тест | **(60 мин)** ⚠ откатили из-за зависания POST |
| Задача 02 — Google Cloud проект, OAuth consent screen, Web Application client, JS origin + redirect URI, переход в Production | **(40 мин)** |
| Задача 03 — Supabase Auth → Providers → Google: Client ID/Secret, Enabled, Save | **(5 мин)** |

**Итого за день: 105 мин (~1 ч 45 мин)** в этом спринте + параллельно работа по почте (отдельная задача).

### 2026-05-27 (ср)

| Задача | Факт |
|---|---|
| Задача 04 — Сменить пароль `r1fmabes.rating@gmail.com` через Supabase Admin API (`PUT /auth/v1/admin/users/{id}` с service_role JWT). Email recovery не подходит — почта фейковая. Новый пароль сохранён у Кирилла. | **(15 мин)** |
| Задача 11 — Миграция 007 `viewer_votes`: таблица + уникальный индекс + триггер updated_at + RLS-policies + grants. Накатили через SQL Editor двумя SQL-запусками (схема + grants). Проверили REST API: service_role и anon видят пустую таблицу. | **(20 мин)** |
| Задача 05 — Создан новый Google Client Secret `****Inw8`, JSON скачан, сохранён в `~/.claude/env/google-oauth.env`. Через curl на Google token endpoint проверили валидность (invalid_grant = secret валиден). Подменили в Supabase Google провайдере и Save. Disable старого `****RmZZ` в Google Cloud → Delete. Остался только новый. | **(30 мин)** |
| Инфраструктура — создана папка `~/.claude/env/` со всеми секретами (`bitrix.env`, `mailru.env`, `supabase.env`, `google-oauth.env`, `rifmabes-supabase.env`) + каталог `SECRETS.md`. Старые env в `~/.claude/` оставлены — скрипты пока их используют. | **(15 мин)** |
| Задача 06 — Политика конфиденциальности: создан `docs/PRIVACY.md` (16 разделов), маршрут `/privacy` в SPA через `react-markdown` + `?raw` импорт, маленькая ссылка в футере с opacity 0.18 и dotted underline. Несколько итераций по запросам Кирилла: имя «Кирилл Маллер» (без отчества), возраст 16+ вместо 18+, убраны упоминания РКН и суда в открытом виде, убраны формальные скобки «(далее — ...)», добавлены преамбула + термины + права субъектов для «эффекта длины». | **(90 мин)** |
| Задача 07 — Условия использования: создан `docs/USER_AGREEMENT.md` (13 разделов), маршрут `/terms` в SPA, ссылка в футере рядом с политикой через разделитель «·». Структура по образцу `risazatvorchestvo.com/user-agreement` (досудебная претензия 30 дней, применимое право РФ, ограничение ответственности 1 ₽), но без раскрытия инфраструктуры. | **(45 мин)** |
| Задача 12 — Кнопка «Войти через Google» в шапке: добавлен метод `signInWithGoogle()` в Store, компонент `AuthBadge` (кнопка «Войти» для незалогиненных, аватарка + имя + выпадашка с пунктами «Админка»/«Выйти» для залогиненных), стили `.auth-badge`/`.auth-menu`. Настроены **Site URL** (`https://rifmabes.ru`) и **Redirect URLs** в Supabase Auth (3 записи: прод, localhost:5173, localhost:3000). Обнаружено: Supabase автоматически линкует Google-identity с существующим email+password аккаунтом по совпадению email+verified — Кирилл вошёл через Google и остался админом без миграции `admin_users`. | **(60 мин)** |
| Задача 09 — Email для связи: используется существующий `kirill_makfarov@bk.ru`, указан в политике и условиях, доступен через ссылки в футере. Отдельный `support@rifmabes.ru` решили не создавать. | **(5 мин)** |
| Гигиена истории — GitHub Push Protection заблокировал push с Google Client ID/Secret в SPRINT-002.md. Через `git rebase -i HEAD~4` с автоматическим editor отредактирован самый старый коммит (`cba543d`), секреты заменены на маски `<хранится в ~/.claude/env/...>`. Хеши 4 локальных коммитов поменялись (нормально, не были запушены). Push прошёл. | **(20 мин)** |
| Задача 20 — Favicon: SVG-иконка `public/favicon.svg` с тем же градиентом cyan→purple что у `.brand-mark` в шапке, текст «R1». Подключена через `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` в `index.html`. | **(10 мин)** |

**Итого за день: 310 мин (~5 ч 10 мин)**

---

## Ключевые решения

- **2026-05-26.** Прокси Supabase через Caddy `handle_path /supabase/*` ускоряет GET-запросы из РФ (2-3 сек → ~0.5 сек), но **POST к Auth виснет на Cloudflare** (502 после 247 сек). Каталог через прокси работает, логин админки — нет. **Откатили** на прямой `nfekasqbzwjelrwyxqmv.supabase.co`. План фикса (задача 17): добавить `tls_server_name` в `transport http` либо поднять Node.js-прокси по образцу yandex-proxy.
- **2026-05-26.** Для регистрации зрителей выбран **Google OAuth** (а не VK/magic-link) — простой, привычный, Supabase из коробки. App в **Production mode**, External, user cap 100 (по умолчанию). Имя приложения «R1frating» латиницей — Google не принимает кириллицу в App name.
- **2026-05-26.** Согласовано с Кириллом: на старте **без дополнительной защиты от накрутки**. Базовое «1 аккаунт = 1 голос» хватит — сайт пока не популярен, риск низкий. Если придёт волна — добавим rate-limit/возраст аккаунта/captcha.
- **2026-05-26.** Правовая база: для запуска голосования сделать минимум **#06+#07+#08+#10** (политика, правила, согласие, 18+). Уведомление в РКН и локализация ПДн в РФ — на потом, до серьёзного роста сайта.

---

## Решения по правовой базе

- **2026-05-27.** Имя оператора в политике — **«Кирилл Маллер»** (публичный ник, без отчества). Не светим основное ФИО и инфраструктурные детали (Supabase Ireland, VPS, конкретные имена cookies). Контактный email — `kirill_makfarov@bk.ru` (существующий, без создания отдельного).
- **2026-05-27.** Возрастная маркировка сайта — **16+** (не 18+). По ФЗ-436 для контента с матом формально требуется 18+, но решение Кирилла. Если придёт жалоба — поднимем до 18+.

## Детали задач

# Задача 01 — Прокси Supabase через VPS Caddy 🔁

**Приоритет:** 🔴 P0 · **Статус:** 🔁 откатили 2026-05-26 (60 мин)

## Что сделано

1. На VPS `bot-napominalka` в `/etc/caddy/Caddyfile` добавлен блок `handle_path /supabase/*` с `reverse_proxy https://nfekasqbzwjelrwyxqmv.supabase.co`. Caddy reload OK.
2. Backup старого Caddyfile в `/etc/caddy/Caddyfile.bak.YYYYMMDD-HHMM`.
3. Проверка `curl /supabase/rest/v1/`: 401 за 0.5 сек (Supabase отвечает, прокси работает на GET).
4. GitHub Secret `VITE_SUPABASE_URL` обновлён на `https://195.208.3.209.sslip.io/supabase`. Push, деплой Pages успешен (43 сек).
5. Прод проверка: каталог из РФ грузится быстро (0.3-0.5 сек скелетоны вместо 2-3).

## Проблема

- POST на `/auth/v1/token` через прокси висит → **HTTP 502 после 247 сек**. Cloudflare на стороне Supabase душит запрос.
- Локально GET каталога работал, поэтому пропустили auth-тест → словили откат на проде после жалобы Кирилла «в админку не зайти».

## Откат

- GitHub Secret вернулся на прямой `https://nfekasqbzwjelrwyxqmv.supabase.co`.
- Коммит `752ec5f` запушен, прод снова рабочий.
- Caddyfile на VPS оставлен с прокси-блоком (не используется фронтом).

## План фикса (отдельная задача 17)

- Вариант A: добавить `transport http { tls; tls_server_name nfekasqbzwjelrwyxqmv.supabase.co }` в reverse_proxy → исправить TLS handshake.
- Вариант B: поднять Node.js прокси по образцу `/opt/yandex-proxy/`, явно контролируя заголовки.
- **Локально тестировать ИМЕННО логин**, не только каталог.

---

# Задача 02 — Google Cloud OAuth setup ✅

**Приоритет:** 🔴 P0 · **Статус:** ✅ выполнено 2026-05-26 (40 мин)

## Что сделано

1. Создан проект Google Cloud: **R1frating** (ID `r1frating`).
2. OAuth consent screen → External, App name = `R1frating` (латиница; кириллица не прошла), User support email = `kirillmakarov820@gmail.com`, Contact = тот же.
3. Создан OAuth Client (Web application):
   - **Client ID:** `<хранится в ~/.claude/env/google-oauth.env>`
   - **Client Secret:** хранится в Supabase Auth → Google провайдер (значение засветилось в чате 2026-05-26, требует ротации, см. задача 05).
   - Authorized JavaScript origin: `https://rifmabes.ru`
   - Authorized redirect URI: `https://nfekasqbzwjelrwyxqmv.supabase.co/auth/v1/callback`
4. Audience → **Publish app → Confirm**. Publishing status = «In production». Любой Google-аккаунт может логиниться (не только test users).

## Definition of done

- [x] OAuth Client создан и опубликован.
- [x] Client ID и Client Secret получены и сохранены в Supabase.

---

# Задача 03 — Google провайдер в Supabase ✅

**Приоритет:** 🔴 P0 · **Статус:** ✅ выполнено 2026-05-26 (5 мин)

## Что сделано

- Supabase Dashboard → Auth → Sign In / Providers → Google.
- Switch «Enable Sign in with Google» → ON.
- Client IDs: вставлен Google Client ID.
- Client Secret: вставлен Google Client Secret.
- Save.
- В списке провайдеров рядом с Google теперь надпись «Enabled».

## Definition of done

- [x] Google провайдер в Supabase Enabled.
- [ ] Boevoy тест: реально залогиниться через Google в локально запущенном dev-сервере → запись появилась в `auth.users`. (после задачи 12)

---

# Задача 04 — Гигиена: сменить пароль Рифмабеса ⏳

**Приоритет:** 🔴 P0 · **Статус:** ⏳ запланировано

## Зачем

Пароль учётки `r1fmabes.rating@gmail.com` (`a3h@N%XZV@wa4@s`) засветился в чате 2026-05-26 при отладке Supabase-прокси. Лог Claude Code хранится локально + проходит через API Anthropic. Лучшая практика — сменить.

## Шаги

1. Supabase Dashboard → Authentication → Users → найти `r1fmabes.rating@gmail.com` → «Send password reset» или установить новый пароль вручную.
2. Передать новый пароль Рифмабесу через Telegram (НЕ через Claude).

---

# Задача 05 — Гигиена: ротировать Client Secret Google ⏳

**Приоритет:** 🔴 P0 · **Статус:** ⏳ запланировано

## Зачем

Client Secret засветился в чате при настройке Supabase (значение в `~/.claude/env/google-oauth.env`, на момент написания задачи — старый, требовал ротации). Сам по себе он не даёт атакующему ничего без redirect URI/origins, но ротация = хорошая практика.

## Шаги

1. Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web client 1.
2. В разделе «Client secrets» нажать «Add secret» → создать новый.
3. Скопировать новый секрет.
4. Supabase → Google провайдер → вписать новый Client Secret → Save.
5. Проверить логин из dev-сервера.
6. В Google Cloud → старый секрет → Disable → потом Delete.

---

# Задача 06 — Политика конфиденциальности ✅

**Приоритет:** 🔴 P0 · **Статус:** ✅ выполнено 2026-05-27 (90 мин)

## Что сделано

- Создан `docs/PRIVACY.md` (16 разделов, ~12 КБ): преамбула, термины и определения, оператор (Кирилл Маллер), категории субъектов, категории данных, правовые основания, цели, способы обработки, передача третьим лицам (общими формулировками — «социальный провайдер», «облачный провайдер хранения»), сроки хранения (30 дней на удаление по запросу, 2 года автоудаление), меры безопасности, права субъектов по 152-ФЗ, cookies, возрастные ограничения 16+, изменения, применимое право РФ + досудебная претензия 30 дней, заключительные.
- Маршрут `/privacy` в SPA через `react-markdown` + `remark-gfm` + `?raw` импорт из `docs/PRIVACY.md`.
- Маленькая ссылка в футере (`.footer-link`, font-size 11px, opacity 0.18, dotted underline) — сливается с фоном.
- Решения по тексту (с Кириллом, 2026-05-27):
  - Имя оператора — «Кирилл Маллер» (без отчества).
  - Возраст — 16+ (не 18+).
  - Не упоминать Роскомнадзор / суд в открытую — обтекаемые формулировки.
  - Убраны формальные скобки «(далее — «Сайт»)».
  - Добавлена «вода» для длины (по запросу «как у больших компаний»).

## Definition of done

- [x] `docs/PRIVACY.md` создан и закоммичен.
- [x] Страница `/privacy` открывается на проде.
- [x] Ссылка в футере не мешает дизайну.
- [x] Контактный email указан (`kirill_makfarov@bk.ru`).

---

# Задача 07 — Условия использования ✅

**Приоритет:** 🔴 P0 · **Статус:** ✅ выполнено 2026-05-27 (45 мин)

## Что сделано

- Создан `docs/USER_AGREEMENT.md` (13 разделов, ~9 КБ): преамбула, термины, администрация (Кирилл Маллер, физлицо), предмет (безвозмездное право использования), регистрация и аккаунт (через социального провайдера, 16+, сохранность учётки на пользователе), права/обязанности пользователя (запрет накрутки, спама, оскорблений), права/обязанности администрации (право банить, не учитывать накрутку), интеллектуальная собственность (каталог наш, ссылки правообладателей, голоса пользователей), ссылки на сторонние ресурсы (не отвечаем), ограничение ответственности (потолок 1 ₽ из-за безвозмездности), возраст 16+, изменения, применимое право РФ + досудебная претензия 30 дней + подсудность по месту жительства администрации, заключительные.
- Маршрут `/terms` в SPA по образцу `PrivacyPage`.
- Ссылка в футере рядом с политикой через разделитель «·» (`.footer-sep`).
- Использовался образец `risazatvorchestvo.com/user-agreement`: взято досудебное урегулирование, применимое право, отказ от ответственности за сторонние сервисы, запрет накрутки. НЕ взято: ИП-реквизиты, лицензирование UGC (у нас UGC нет, только голоса).
- В разделе 13 встроена страховка: при противоречии с политикой в части ПДн — приоритет у политики.

## Definition of done

- [x] `docs/USER_AGREEMENT.md` создан и закоммичен.
- [x] Страница `/terms` открывается на проде.
- [x] Противоречий с PRIVACY.md нет (проверено по разделам: возраст 16+, контакт, сроки 30 дней, право РФ — везде согласовано).

---

# Задача 08 — Согласие на обработку ПДн ⏳

**Приоритет:** 🔴 P0 · **Статус:** ⏳ запланировано

## Реализация (минимум)

- При первом входе через Google показать модалку:
  - Чекбокс «Я подтверждаю, что мне есть 18 лет и согласен с [Политикой конфиденциальности] и [Условиями использования]».
  - Кнопка «Продолжить» disabled пока чекбокс не отмечен.
- Запись согласия в Supabase (новая колонка `viewer_profiles.consented_at timestamptz`).
- Без согласия не пускать в голосование (RLS).

---

# Задача 09 — Email для связи ⏳

**Приоритет:** 🟠 P1 · **Статус:** ⏳ запланировано

## Варианты

- A. Использовать существующий `kirill_makfarov@bk.ru` (быстро, бесплатно).
- B. Создать `support@rifmabes.ru` через какую-то почтовую службу (yandex.connect, mail.ru для бизнеса, или просто алиас на bk.ru).

## Где указать

- В Политике конфиденциальности (для запросов об удалении).
- В футере сайта.
- В Условиях использования.

---

# Задача 10 — Возрастная плашка 18+ ⏳

**Приоритет:** 🟠 P1 · **Статус:** ⏳ запланировано

## Варианты UI

- **A. Плашка в футере** — простая надпись «Сайт содержит контент 18+».
- **B. Модалка при первом заходе** — кнопка «Подтверждаю, мне 18+».
- **C. Совмещено с задачей 08** — один чекбокс «18+ и согласен с Политикой».

Рекомендация: **вариант C** — один экран при первом входе с двумя чекбоксами или одним совмещённым.

---

# Задача 11 — Миграция БД 007: viewer_votes ⏳

**Приоритет:** 🔴 P0 · **Статус:** ⏳ запланировано

## Схема

```sql
-- db/migrations/007_viewer_votes.sql
-- type: additive
-- safe-on-prod: yes

create table public.viewer_votes (
    id uuid primary key default gen_random_uuid(),
    viewer_id uuid not null references auth.users(id) on delete cascade,
    item_id uuid not null references public.rated_items(id) on delete cascade,
    -- для album/track: score 0..11
    score numeric(4,2) check (score >= 0 and score <= 11),
    -- для battle: null=итог, иначе индекс раунда
    round_index int,
    -- для battle: победитель
    winner_side text check (winner_side in ('a','b','draw') or winner_side is null),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- один аккаунт = один голос на (item, round)
create unique index viewer_votes_unique_idx
  on public.viewer_votes (viewer_id, item_id, coalesce(round_index, -1));

-- RLS
alter table public.viewer_votes enable row level security;

-- читать всем (для агрегации средней)
create policy "viewer_votes are public for reading"
  on public.viewer_votes for select using (true);

-- писать только свой голос
create policy "users can insert own votes"
  on public.viewer_votes for insert with check (auth.uid() = viewer_id);

create policy "users can update own votes"
  on public.viewer_votes for update using (auth.uid() = viewer_id);

create policy "users can delete own votes"
  on public.viewer_votes for delete using (auth.uid() = viewer_id);
```

## Definition of done

- [ ] Миграция накачена на прод через SQL Editor.
- [ ] Тест: вставить голос локально, увидеть в Table Editor.
- [ ] Тест: попытка вставить голос за другого `viewer_id` через REST → RLS блокирует.

---

# Задача 12 — Кнопка «Войти через Google» ✅

**Приоритет:** 🔴 P0 · **Статус:** ✅ выполнено 2026-05-27 (60 мин)

## Что сделано

- Метод `signInWithGoogle()` в Store: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } })`.
- Компонент `AuthBadge` в шапке:
  - **Не залогинен** → кнопка «Войти» (`.ghost`).
  - **Залогинен** → круглая аватарка (из `user_metadata.avatar_url` Google) + имя (из `full_name`/`name`/email) → клик открывает выпадашку с пунктом «Админка» (только если в `admin_users`) и «Выйти». Fallback на инициал из email если нет avatar_url.
  - Закрытие меню по клику вне.
- Стили `.auth-badge`, `.auth-trigger`, `.auth-avatar`, `.auth-menu`, `.auth-menu-item`, `.auth-menu-signout`, `.footer-sep`.
- **Настройка Supabase Auth URL Configuration** (Dashboard → Authentication → URL Configuration):
  - Site URL: `https://rifmabes.ru`
  - Redirect URLs: `https://rifmabes.ru/**`, `http://localhost:5173/**`, `http://localhost:3000/**`.
  - Без этого Supabase редиректил на дефолтный `http://localhost:3000` после OAuth callback.
- LoginPage админки оставлен прежним (email+password) — кнопку Google там НЕ добавляли, по согласованию с Кириллом.

## Защита админки от зрителей (проверено)

1. **UI** — ссылки «Админка» в шапке и в `AuthBadge` под `{admin && ...}`.
2. **Router** — `AdminRoute` редиректит на `/admin/login` если `admin !== true`.
3. **БД RLS** — `admin_users` policy `for select using (is_admin())`, `rated_items` mutations `with check (is_admin())`. Прямой запрос с JWT зрителя → 403.
4. **Привязка по user_id, не по email** — подменой email админство не получить.
5. **localStorage hack** — `setAdmin()` имеет `if (supabase) return;`, на проде не сработает.
6. **React DevTools state** — UI покажет ссылки, но БД RLS заблокирует мутации.

## Surprise: Supabase автолинкует identities

Когда Кирилл вошёл через Google под `kirillmakarov820@gmail.com` (его email+password аккаунт), Supabase **слинковал** Google-identity с существующим user_id (`9f5f600d-...`). В JWT после входа: `"providers": ["email", "google"]`. Кирилл остался админом без правки `admin_users`.

Это работает только если email **совпадает И verified** в Google. Для Рифмабеса не сработает — его реальный Google `r1fmabes@gmail.com` отличается от админского `r1fmabes.rating@gmail.com` (фейкового). При его первом входе через Google создастся новый user_id, которого нет в `admin_users` → войдёт как зритель.

## Definition of done

- [x] Кнопка «Войти» в шапке.
- [x] OAuth flow: Google → возврат на rifmabes.ru → залогинен.
- [x] Аватарка + имя в шапке, меню «Выйти».
- [x] Админ остался админом после входа через Google.
- [x] Push не блокируется (секреты вычищены из истории через rebase).

---

# Задача 13 — UI голосования за трек/альбом ⏳

**Приоритет:** 🔴 P0 · **Статус:** ⏳ запланировано

## UX

- На странице записи (трек/альбом) под оценкой Рифмабеса — блок «Поставь свою оценку»:
  - Если не залогинен: кнопка «Войти через Google чтобы голосовать».
  - Если залогинен: слайдер 0..11 + кнопка «Сохранить».
  - Текущий голос пользователя подгружается из `viewer_votes`.
  - Можно изменить — апдейтит ту же запись.

## Запись

- `upsert` в `viewer_votes` по `(viewer_id, item_id, round_index=null)`.

---

# Задача 14 — Две оценки на карточке ⏳

**Приоритет:** 🟠 P1 · **Статус:** ⏳ запланировано

## Что показывать

- В карточке каталога и на странице записи: рядом две оценки:
  - **Рифмабес: X.X** (как сейчас).
  - **Зрители: Y.Y** (N голосов) — average + count из `viewer_votes`.
- Если у зрителей <3 голосов — не показывать (мало данных).

## Реализация

- SQL view `viewer_avg_scores`: `select item_id, avg(score) as avg, count(*) as n from viewer_votes where score is not null group by item_id`.
- Фронт делает join к каталогу.

---

# Задача 15 — UI голосования за баттл ⏳

**Приоритет:** 🟠 P1 · **Статус:** ⏳ запланировано

## UX

- На странице баттла под каждым раундом: радио «A / B / Ничья», кнопка «Сохранить».
- Под итоговым результатом: тоже радио для голоса за итог.
- Записывается в `viewer_votes` с `round_index` для раундов и `round_index=null` для итога.

---

# Задача 16 — Кнопка «Удалить аккаунт» ⏳

**Приоритет:** 🟡 P2 · **Статус:** ⏳ запланировано

## Реализация

- В профиле зрителя кнопка «Удалить аккаунт навсегда» с подтверждением.
- Через Edge Function (Supabase service_role) удаляет:
  - Запись в `auth.users`.
  - Все голоса в `viewer_votes` (cascade сделает за нас).
  - Email для подтверждения операции.

---

# Задача 17 — Чинить Supabase Auth через прокси ⏳

**Приоритет:** 🟡 P2 · **Статус:** ⏳ запланировано

См. блок «Что осталось как технический долг» в задаче 01.

---

# Задача 18 — Уведомление в Роскомнадзор ⏳

**Приоритет:** 🟡 P2 · **Статус:** ⏳ запланировано

## Шаги

1. https://rkn.gov.ru/personal-data/p256/ → форма уведомления.
2. Указать: ФЛ как оператор ПДн (или ИП), цель обработки, категории субъектов (зрители), категории ПДн (email, имя), местонахождение БД (Supabase Ireland — формальное нарушение ст.18.5).
3. Подаётся через Госуслуги или почтой.

Бесплатно, обязательно по букве закона. Штрафы за неподачу — только при проверке.

---

# Задача 19 — Локализация ПДн в РФ ⏳

**Приоритет:** 🟢 P3 · **Статус:** ⏳ обдумываем

По 152-ФЗ ст.18.5 первичная запись ПДн граждан РФ должна быть на серверах в РФ. Supabase Cloud в Ireland — формальное нарушение.

## Возможные пути

- A. Поднять собственный Supabase на VPS в РФ (self-hosted) — большая работа.
- B. Постгрес в РФ + двойная запись (Supabase + локальная копия) — сложно.
- C. Игнорировать пока сайт маленький — текущее положение.

Сейчас не критично. Решать когда сайт реально вырастет.

---

## 🔗 Якоря и ссылки

- Карта проекта: [CLAUDE.md](../../CLAUDE.md)
- Архитектура: [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- Бэклог: [docs/BACKLOG.md](../../docs/BACKLOG.md)
- Главный монолит фронта: [src/main.tsx](../../src/main.tsx)
- Политика конфиденциальности: [docs/PRIVACY.md](../../docs/PRIVACY.md) → отображается на [/privacy](https://rifmabes.ru/privacy)
- Условия использования: [docs/USER_AGREEMENT.md](../../docs/USER_AGREEMENT.md) → отображается на [/terms](https://rifmabes.ru/terms)
- Предыдущий спринт: [SPRINT-001.md](SPRINT-001.md)
- **Google Cloud проект:** `r1frating`, аккаунт `kirillmakarov820@gmail.com`
  - URL: https://console.cloud.google.com/auth/overview?project=r1frating
  - **Client ID:** `<хранится в ~/.claude/env/google-oauth.env>`
  - Client Secret — в Supabase Auth (ротировать, см. задача 05)
  - JavaScript origin: `https://rifmabes.ru`
  - Redirect URI: `https://nfekasqbzwjelrwyxqmv.supabase.co/auth/v1/callback`
  - Publishing status: In production, External
- **Supabase:** https://supabase.com/dashboard/project/nfekasqbzwjelrwyxqmv
  - Google провайдер: Enabled
- **VPS bot-napominalka** (195.208.3.209.sslip.io):
  - Caddyfile содержит `handle_path /supabase/*` блок (откатили, не используется фронтом)
  - Бэкап Caddyfile: `/etc/caddy/Caddyfile.bak.*`
- 152-ФЗ «О персональных данных»: http://www.consultant.ru/document/cons_doc_LAW_61801/
- Подача уведомления в РКН: https://rkn.gov.ru/personal-data/p256/
