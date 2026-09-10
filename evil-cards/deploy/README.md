# Злобные карты на сервере

Установка игры на VPS Кирилла (Aeza, Германия).

| Что | Значение |
|---|---|
| IP сервера | **109.172.94.130** (второй IP той же машины: 5.182.87.167) |
| Вход | `ssh bot-aeza`, полная форма — `ssh -i ~/.ssh/bot-napominalka-aeza -o IdentitiesOnly=yes root@109.172.94.130` |
| Адрес игры | **`https://109-172-94-130.sslip.io`** |
| Куда кладём | `/opt/evil-cards` |
| ОС | Ubuntu 22.04.5, **1 ядро, ~960 МБ свободной памяти**, своп 2 ГБ |
| Docker | 29.1.3 + Compose 2.40.3, контейнеров ноль |
| node на сервере | v25.9.0, `/usr/local/bin/node` |
| Веб-сервер | **nginx активен** и занят портами 8443/8444 (чужие сервисы). **Caddy не установлен** |
| Порты 80/443 | свободны, но **закрыты в ufw** — открыть явно (шаг 1) |

`109.172.94.130` — это **настоящий IP этой машины**, а не заглушка: он уже
подставлен в `.env.example`, `deploy/nginx.example.conf` и `deploy/Caddyfile.example`.
Менять его нужно только если игру ставят на другой сервер.

> **sslip.io** — авто-DNS. Имя вида `<IP>.sslip.io` само резолвится обратно
> в этот `<IP>`. Домен покупать и настраивать не нужно, Let's Encrypt
> выдаёт на такое имя обычный сертификат.

---

## ⚠️ Прочитать до начала

На этом сервере **уже работают личные сервисы владельца**. Ничего из этого не
останавливать, не переконфигурировать и не удалять:

- папки `/opt/bot-napominalka`, `/opt/beszel*`, `/opt/amnezia`, `/opt/cedar-sub`;
- сервисы `bot-napominalka`, `beszel`, `beszel-agent`, `hysteria-server`, `x-ui`, `xray`;
- конфиги nginx `sites-enabled/beszel`, `sites-enabled/cedar-sub`;
- порты 22, 8443, 8444, 1959, 2053, 40443/udp, 30000-32000/udp.

Правила, из которых ничего не выкидывать:

1. **Не собирать на сервере.** Одно ядро и ~960 МБ свободной памяти: `docker build`
   и `npm ci` заберут их себе и могут задеть соседей. Образ и зависимости
   готовим у себя, на сервер везём готовое (шаг 2). `deploy/deploy.sh` теперь
   сам отказывается собирать и печатает нужные команды.
2. **`certbot --nginx` не запускать** — плагин правит чужие конфиги nginx.
   Только `certbot certonly --webroot` (см. `nginx.example.conf`).
3. **Caddy не ставить.** На 80/443 его нет, но nginx на этой машине уже работает
   и обслуживает чужие сайты; второй веб-сервер рядом — лишний риск и лишняя
   память. Идём вариантом nginx. `Caddyfile.example` оставлен на случай другой машины.
4. Чужие конфиги **не править**, только **добавлять** свой файл.
   Перед правкой — бэкап: `tar czf /root/nginx-backup-$(date +%F).tar.gz /etc/nginx`.
5. Конфиг применять через `reload`, не `restart`.
6. Порт **3000 наружу не открывать**: игра слушает `127.0.0.1`, наружу смотрит
   только через reverse-proxy с HTTPS.
7. Лимит памяти 256 МБ (`mem_limit` в Docker, `MemoryMax` в systemd) не снимать.
   Он меняется только парой с `--max-old-space-size` (второе ≈75% первого).
8. **fail2ban и CrowdSec работают.** fail2ban следит в том числе за 80 и 443
   (`nginx-limit-req`). Свои проверки после деплоя делай с паузами, не циклом —
   иначе забанит собственный IP.
   ```bash
   fail2ban-client status nginx-limit-req
   fail2ban-client set nginx-limit-req unbanip <IP>
   ```

---

## Шаг 0. Посмотреть, что на сервере (делается ПЕРВЫМ)

```bash
ssh bot-aeza
cd /opt/evil-cards            # если код ещё не привезён — просто bash ./check-server.sh
bash deploy/check-server.sh
```

Скрипт **только читает**: ничего не ставит, не запускает и не меняет.
Он покажет ОС, память, диск, docker и node, кто занимает порты 80/443/3000,
какой веб-сервер активен, фаервол, fail2ban/CrowdSec, внешний IP и адрес игры.

**Скопируй весь вывод и пришли в чат.** Если что-то расходится с таблицей в
начале этого файла — остановись и спроси Кирилла, дальше не иди.

---

## Шаг 1. Открыть порты 80 и 443

ufw работает по принципу «всё запрещено, кроме списка», и 80/443 в списке **нет**.
Без этого шага Let's Encrypt не выдаст сертификат, а гости не откроют игру.
На сервере принято писать комментарий к правилу:

```bash
ufw allow 80/tcp  comment 'game http'
ufw allow 443/tcp comment 'game https'
ufw status verbose        # проверить, что появились
```

Порты 22, 8443, 8444, 1959, 2053, 40443/udp, 30000-32000/udp — чужие, не трогать.

Откат, если игру убираем совсем: `ufw delete allow 80/tcp && ufw delete allow 443/tcp`.

---

## Шаг 2. Привезти код и образ (собираем У СЕБЯ)

Игра лежит **подпапкой** `evil-cards/` в репозитории `KirillMaller/album-rater`
(ветка `claude/game-german-server-dudtwb`). Всё остальное в репозитории — другой
проект, на сервер его тащить не надо. Поэтому не `git clone` на сервере, а
rsync именно этой папки со своей машины:

```bash
# --- всё это НА СВОЕЙ МАШИНЕ, из папки evil-cards/ ---

# образ (сборка тут, на сервере — нельзя)
docker build -t evil-cards:latest .
docker save evil-cards:latest | gzip | ssh bot-aeza 'gunzip | docker load'

# код и .env-шаблон
ssh bot-aeza 'mkdir -p /opt/evil-cards/data'
rsync -av --exclude node_modules --exclude data/state.json ./ bot-aeza:/opt/evil-cards/
```

Имя образа должно совпадать с `image:` в `docker-compose.yml` — сейчас это
`evil-cards:latest`. Если привёз под другим тегом, переименуй на сервере
(это не пересборка, секунда):

```bash
ssh bot-aeza 'docker tag evil-cards:1 evil-cards:latest'
```

---

## Шаг 3. Запустить игру

```bash
ssh bot-aeza
cd /opt/evil-cards

cp .env.example .env
# раскомментировать и оставить строку без решётки:
#   PUBLIC_URL=https://109-172-94-130.sslip.io
nano .env

bash deploy/deploy.sh
```

Что делает `deploy/deploy.sh`: проверяет docker и `.env`, готовит `data/`
(`chown 1000:1000` — под этим uid работает пользователь `node` внутри
контейнера), поднимает контейнер из **уже привезённого** образа и ждёт `/health`.
Собирать он не станет — если образа нет, честно скажет, какие команды выполнить
у себя. Скрипт идемпотентный: повторный запуск = обновление.

Проверка изнутри сервера:

```bash
curl -s http://127.0.0.1:3000/health     # {"ok":true,"phase":"lobby",...}
docker compose ps
docker stats --no-stream evil-cards      # MEM USAGE заметно меньше 256 МБ
```

Дальше — **reverse-proxy** (ниже), без него игра доступна только изнутри сервера.

---

## Запасной путь: без Docker (systemd + node)

Нужен, только если с Docker что-то не так. Node на сервере есть
(`/usr/local/bin/node`, v25).

```bash
# --- НА СВОЕЙ МАШИНЕ: зависимости ставим тут, не на сервере ---
npm ci --omit=dev
rsync -av --exclude data/state.json ./ bot-aeza:/opt/evil-cards/

# --- НА СЕРВЕРЕ ---
ssh bot-aeza
useradd --system --no-create-home --shell /usr/sbin/nologin evilcards
mkdir -p /opt/evil-cards/data
chown -R evilcards:evilcards /opt/evil-cards/data

cd /opt/evil-cards
cp .env.example .env
nano .env          # PUBLIC_URL=https://109-172-94-130.sslip.io

command -v node    # СВЕРИТЬ с путём в ExecStart юнита (там /usr/local/bin/node)
cp deploy/evil-cards.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now evil-cards
systemctl status evil-cards
```

Подробные комментарии — в шапке [evil-cards.service](evil-cards.service).
Юнит ограничивает память (`MemoryMax=256M`), перезапускает игру при падении
и разрешает запись только в `data/`.

Если `systemctl status` ругается `203/EXEC` — путь к node в `ExecStart` не тот,
что показал `command -v node`. Впиши правильный и `systemctl daemon-reload`.

---

## Шаг 4. Reverse-proxy — nginx (обязательно)

Без этого шага игра доступна только изнутри сервера.
**Главное здесь — WebSocket:** без него страница откроется, а игроки будут
вечно видеть «Переподключаемся…».

На этой машине **nginx уже работает** (порты 8443/8444 — чужие сайты), а
Caddy не установлен. Идём через nginx: только добавляем свой файл, чужие не трогаем.
Ставить Caddy рядом не надо — см. правило 3 в начале файла.

```bash
# 0. Бэкап конфигов (2 секунды)
sudo tar czf /root/nginx-backup-$(date +%F).tar.gz /etc/nginx

# 1. Свой файл (адрес 109-172-94-130.sslip.io там уже подставлен)
sudo cp /opt/evil-cards/deploy/nginx.example.conf \
        /etc/nginx/sites-available/evil-cards.conf
```

Дальше **строго по инструкции в шапке** [nginx.example.conf](nginx.example.conf).
Порядок там такой и менять его нельзя:

1. временно закомментировать блок `server { listen 443 ... }` — сертификата
   ещё нет, и nginx с ссылкой на несуществующий файл просто не стартует;
2. `ln -s` в `sites-enabled/`, `nginx -t`, `systemctl reload nginx`;
3. сертификат **только webroot-режимом**:
   ```bash
   sudo mkdir -p /var/www/html/.well-known/acme-challenge
   sudo certbot certonly --webroot -w /var/www/html -d "109-172-94-130.sslip.io"
   ```
   **`certbot --nginx` не запускать** — плагин правит конфиги чужих сайтов.
   Если certbot не стоит: `apt install -y certbot` (без `python3-certbot-nginx`);
4. раскомментировать блок `:443`, `nginx -t && systemctl reload nginx`.

В конфиге уже прописано то, без чего Socket.io не работает: `proxy_http_version 1.1`,
заголовки `Upgrade` / `Connection` (через собственный map `$evil_cards_conn_upgrade`,
чтобы не столкнуться с чужим), `proxy_read_timeout 7d` и `proxy_buffering off`.
HTTP/2 намеренно выключен: на Ubuntu 22.04 nginx 1.18 не знает директиву `http2 on;`
и `nginx -t` на ней падает.

Проверка снаружи — **с паузами между командами**, иначе fail2ban забанит:

```bash
curl -s  https://109-172-94-130.sslip.io/health
sleep 5
curl -sI https://109-172-94-130.sslip.io/socket.io/socket.io.js | head -1
sleep 5
# самое важное: ждём «101 Switching Protocols»
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     "https://109-172-94-130.sslip.io/socket.io/?EIO=4&transport=websocket"
```

Откат: `sudo rm /etc/nginx/sites-enabled/evil-cards.conf && sudo systemctl reload nginx`.
Чужие сайты этим не задеваются.

### Если игру ставят на другую машину, где на 80/443 Caddy

Тогда пригодится [Caddyfile.example](Caddyfile.example): дописать блок **в конец**
`/etc/caddy/Caddyfile`, `caddy validate --config /etc/caddy/Caddyfile`,
`systemctl reload caddy`. Сертификат Caddy получит сам, WebSocket проксирует сам.
**На сервере Aeza этот путь не используется.**

---

## Если игру переносят на ДРУГОЙ сервер: где живёт IP

Здесь IP уже подставлен везде. На другой машине его надо поменять ровно в двух местах.

1. **`.env` в папке проекта** — адрес для QR-кода:

   ```
   PUBLIC_URL=https://<IP-через-дефисы>.sslip.io
   ```

2. **Конфиг прокси** — имя сайта: в nginx это `server_name` и два пути к
   сертификату, в Caddyfile — строка с доменом.

После правки `.env`:

```bash
docker compose up -d           # Docker: именно up -d, restart переменные не перечитает
systemctl restart evil-cards   # systemd
```

Проверка, что QR ведёт куда надо: открыть `/screen` и убедиться, что адрес
под кодом — это `https://<IP>.sslip.io`, а не `localhost`.

---

## Эксплуатация

### Обновить игру

Порядок тот же, что при установке: **собрали у себя — привезли — перезапустили.**

```bash
# --- НА СВОЕЙ МАШИНЕ ---
docker build -t evil-cards:latest .
docker save evil-cards:latest | gzip | ssh bot-aeza 'gunzip | docker load'
rsync -av --exclude node_modules --exclude data/state.json ./ bot-aeza:/opt/evil-cards/

# --- НА СЕРВЕРЕ ---
ssh bot-aeza 'cd /opt/evil-cards && bash deploy/deploy.sh'
```

Скрипт идемпотентный: повторный запуск = обновление. `data/` он не трогает —
и партия, и база карт живут на хосте и переезжают в контейнер томом.

Вариант без Docker: `rsync` тем же способом, потом
`ssh bot-aeza 'systemctl restart evil-cards'`.

### Логи

```bash
docker compose logs -f                  # Docker
docker compose logs --tail=100
journalctl -u evil-cards -f             # systemd
journalctl -u caddy -n 50 --no-pager    # логи прокси
```

Логи контейнера ограничены 30 МБ (10 МБ × 3 файла) — диск не забьют.

### Бэкап данных

В `data/` лежит всё ценное: `state.json` (партия) и база карт.

```bash
cd /opt/evil-cards
tar czf ~/evil-cards-data-$(date +%F).tar.gz data/
```

Делать перед обновлением и **обязательно перед праздником**.

### Восстановление и откат

```bash
# вернуть данные
cd /opt/evil-cards && tar xzf ~/evil-cards-data-2026-09-10.tar.gz

# откатить код: у себя переключиться на прошлый коммит,
# собрать образ заново и снова привезти (шаг 2). На сервере git не нужен.

# полностью убрать игру, ничего больше не задев
docker compose down                                      # Docker
systemctl disable --now evil-cards \
  && rm /etc/systemd/system/evil-cards.service           # systemd
rm /etc/nginx/sites-enabled/evil-cards.conf && systemctl reload nginx
ufw delete allow 80/tcp && ufw delete allow 443/tcp      # если порты больше не нужны
```

Чужие сервисы (бот, beszel, VPN, сайты на 8443/8444) после такого удаления
продолжают работать как работали: игра жила в своём контейнере, своей папке
и своём файле nginx.

### Начать игру заново

```bash
rm data/state.json
docker compose restart      # или systemctl restart evil-cards
```

---

## Если что-то не работает

### Страница открывается, но игроки не подключаются («подключение…» без конца)

**Почти всегда это непроксированный WebSocket.** Сама страница ходит по
обычному HTTP и грузится, а Socket.io не может перейти на WebSocket.

- **nginx:** проверь, что в `location /` есть все три строки —
  `proxy_http_version 1.1;`, `proxy_set_header Upgrade $http_upgrade;`,
  `proxy_set_header Connection $evil_cards_conn_upgrade;` — и что
  `map $http_upgrade $evil_cards_conn_upgrade` вообще определён (без него
  `Connection` уедет пустым).
  Проверить: `sudo nginx -T | grep -A3 evil_cards_conn_upgrade`.
- **Caddy:** он проксирует WebSocket сам; если не работает — дело не в нём,
  смотри логи игры.
- Быстрая проверка снаружи (ожидаем `101 Switching Protocols`):

  ```bash
  curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
       -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
       "https://109-172-94-130.sslip.io/socket.io/?EIO=4&transport=websocket"
  ```

### Игроков выкидывает через минуту-другую

Таймаут прокси. В nginx должно быть `proxy_read_timeout 7d;` (по умолчанию
там 60 секунд — nginx молча рвёт «тихий» сокет посреди раунда).

### QR ведёт не туда (на localhost или на старый адрес)

Дело в `PUBLIC_URL`.

```bash
grep PUBLIC_URL /opt/evil-cards/.env      # строка должна быть БЕЗ # в начале
docker compose up -d                       # перечитать .env
```

`docker compose restart` переменные из `.env` **не** перечитывает — нужен `up -d`.

### Контейнер всё время перезапускается

Скорее всего упёрся в лимит памяти (OOM).

```bash
docker stats evil-cards                    # смотри колонку MEM USAGE / LIMIT
docker compose logs --tail=100
docker inspect evil-cards --format '{{.State.OOMKilled}}'    # true = убит по памяти
```

Если правда OOM — либо утечка в игре (сообщить разработчику), либо поднять
лимит: `mem_limit: 384m` в `docker-compose.yml` и `--max-old-space-size=288`
в `Dockerfile` (эти две цифры всегда меняются вместе, вторая — примерно 75%
от первой). Но сначала убедись, что на сервере вообще есть свободная память.

### 502 Bad Gateway

Прокси работает, а игра — нет.

```bash
curl -I http://127.0.0.1:3000/health    # если тоже не отвечает — проблема в игре
docker compose ps
docker compose logs --tail=50
```

Если игра слушает не тот порт, что прописан в прокси — поправь `PORT` в `.env`
и цифру в конфиге прокси.

### Сертификат не выпускается

- Порт 80 должен быть **открыт в ufw** (шаг 1): `ufw status | grep 80`.
  Это причина номер один — по умолчанию он закрыт.
- Каталог проверки должен существовать: `mkdir -p /var/www/html/.well-known/acme-challenge`.
- Домен должен резолвиться: `dig +short "109-172-94-130.sslip.io"` → тот же IP.
- У Let's Encrypt лимит 5 неудачных попыток в час на домен — не долби подряд.
- И не запускай `certbot --nginx`: он правит чужие конфиги. Только `--webroot`.

### Мои curl вдруг перестали доходить

Скорее всего забанил fail2ban (следит в том числе за 80/443) или CrowdSec.

```bash
fail2ban-client status nginx-limit-req
fail2ban-client set nginx-limit-req unbanip <твой-IP>
cscli decisions list
cscli decisions delete --ip <твой-IP>
```

Дальше проверяй с паузами по 5-10 секунд, а не циклом.

### nginx -t падает

- `unknown directive "http2"` — nginx старше 1.25.1 (на Ubuntu 22.04 это 1.18).
  В нашем конфиге `http2` уже выключен; если включал руками — верни как было
  или используй `listen 443 ssl http2;`.
- `duplicate ... $connection_upgrade` — где-то в чужом конфиге уже есть такой map.
  У нас переменная называется `$evil_cards_conn_upgrade` и конфликтовать не должна;
  если всё же ругается — переименуй **свою**, чужую не трогай.
- `cannot load certificate ... No such file` — блок `:443` включён раньше, чем
  выпущен сертификат. Закомментируй его, получи сертификат, потом раскомментируй.

### Порт 3000 занят

```bash
sed -i 's/^PORT=.*/PORT=3100/' /opt/evil-cards/.env
docker compose up -d
```

В `docker-compose.yml` порт подставляется из `.env` автоматически.
Не забудь поменять `127.0.0.1:3000` на `127.0.0.1:3100` в конфиге прокси.

---

## Что где лежит

| Файл | Зачем |
|---|---|
| [check-server.sh](check-server.sh) | Диагностика сервера. Только читает, ничего не меняет. Шаг 0. |
| [deploy.sh](deploy.sh) | Установка и обновление через Docker. Идемпотентный. |
| [nginx.example.conf](nginx.example.conf) | **Наш путь.** Server-блок для nginx + команды certbot (webroot). |
| [Caddyfile.example](Caddyfile.example) | Для другой машины, где на 80/443 Caddy. На Aeza не используется. |
| [evil-cards.service](evil-cards.service) | systemd-юнит для пути без Docker. |
| `../Dockerfile` | Образ игры: node:20-alpine, не-root, heap 192 МБ. |
| `../docker-compose.yml` | Лимиты 256 МБ / 0.5 CPU, том `data/`, порт только на localhost. |
| `../.env.example` | Шаблон настроек: `PORT`, `PUBLIC_URL`. |

---

## Перед праздником

- [ ] `ufw status` показывает открытые 80/tcp и 443/tcp.
- [ ] `curl -s https://109-172-94-130.sslip.io/health` отвечает `{"ok":true,...}`
      **с телефона по мобильному интернету**, а не только с сервера.
- [ ] Апгрейд до WebSocket отвечает `101 Switching Protocols` (команда выше).
- [ ] Зайти с двух телефонов, оба видны в лобби (это и есть живой тест WebSocket).
- [ ] QR на `/screen` ведёт на `https://109-172-94-130.sslip.io`, а не на localhost.
- [ ] База карт лежит в `data/base-prompts.txt` и `data/base-answers.txt`
      (или залита через «Загрузить базу» в панели организатора).
- [ ] `LOADTEST_URL=https://109-172-94-130.sslip.io npm run loadtest` прогнан
      **со своей машины** (на сервере его гонять не надо — там одно ядро).
- [ ] Бэкап `data/` сделан.
- [ ] `docker stats --no-stream evil-cards` под нагрузкой — заметно меньше 256 МБ.
- [ ] `docker compose restart` посреди раунда — игра продолжается с того же места.
- [ ] Чужие сервисы живы: `systemctl is-active bot-napominalka beszel x-ui nginx`.
