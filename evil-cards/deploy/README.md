# Злобные карты на сервере

Инструкция по установке игры на VPS Кирилла (Aeza, Германия).
Адрес игры будет `https://109-172-94-130.sslip.io`, где `109.172.94.130` — реальный IP сервера.
**`109.172.94.130` — это плейсхолдер, его надо заменить** на адрес, который покажет
`deploy/check-server.sh` (или `curl -s https://api.ipify.org`).

> **sslip.io** — авто-DNS. Имя вида `<IP>.sslip.io` само резолвится обратно
> в этот `<IP>`. Домен покупать и настраивать не нужно, Let's Encrypt
> выдаёт на такое имя обычный сертификат.

---

## ⚠️ Прочитать до начала

На этом сервере **уже работают сайт Кирилла, Telegram-бот и VPN**.

- Чужие конфиги **не править**. Только **добавлять** свой блок в конец файла.
- Перед правкой конфига веб-сервера — **бэкап** (команды есть ниже).
- Применять конфиг через `reload`, а не `restart` — иначе сайт моргнёт.
- Порт **3000 наружу не открывать**. Игра слушает только `127.0.0.1`,
  в интернет она смотрит исключительно через reverse-proxy с HTTPS.
- Память ограничена **256 МБ** (`mem_limit` в Docker, `MemoryMax` в systemd).
  Сайт уже падал при паре посетителей — игра не должна доесть остаток.

---

## Шаг 0. Посмотреть, что вообще на сервере

```bash
ssh root@109.172.94.130
cd /opt/evil-cards            # или туда, куда скопировал проект
bash deploy/check-server.sh
```

Скрипт **только читает**: ничего не ставит, не запускает и не меняет.
Он покажет ОС, память, диск, есть ли Docker и Node, кто занимает
порты 80/443/3000, какой веб-сервер активен, внешний IP и адрес игры.

**Скопируй весь вывод и пришли в чат** — по нему выбирается путь.

Дальше развилка:

| Что показал скрипт | Куда идти |
|---|---|
| Docker есть, демон отвечает | **Путь А** (ниже) — рекомендуемый |
| Docker нет и ставить не хочется | **Путь Б** — systemd + node |
| На 80/443 сидит **caddy** | reverse-proxy → **вариант Caddy** |
| На 80/443 сидит **nginx** | reverse-proxy → **вариант nginx** |
| 80/443 свободны | проще всего поставить Caddy |
| Порт 3000 занят | поменять `PORT` в `.env` на 3100 и дальше как обычно |

---

## Путь А. С Docker (рекомендуется)

Всё изолировано: у игры свой Node, свои зависимости, свой лимит памяти.
Ничего из системного она не задевает.

```bash
# 1. Код на сервер
git clone <репозиторий> /opt/evil-cards
cd /opt/evil-cards

# 2. Установка (скрипт сам создаст .env и попросит заполнить PUBLIC_URL)
bash deploy/deploy.sh
```

Первый запуск остановится с просьбой заполнить `PUBLIC_URL` — так и задумано.
Впиши адрес и запусти скрипт снова:

```bash
nano .env
#   PORT=3000
#   PUBLIC_URL=https://109-172-94-130.sslip.io      <- вместо 109.172.94.130 свой IP

bash deploy/deploy.sh
```

Скрипт соберёт образ, поднимет контейнер, дождётся ответа `/health`
и напечатает следующий шаг. Дальше — **настройка reverse-proxy** (ниже).

Проверка, что игра поднялась внутри сервера:

```bash
curl -I http://127.0.0.1:3000/health     # ожидаем 200 OK
docker compose ps
```

---

## Путь Б. Без Docker (systemd + node)

Нужен Node.js 20+ на самом сервере.

```bash
# 1. Код и зависимости
git clone <репозиторий> /opt/evil-cards
cd /opt/evil-cards
npm ci --omit=dev

# 2. Отдельный пользователь без shell — от root игру не запускаем
useradd --system --no-create-home --shell /usr/sbin/nologin evilcards
chown -R evilcards:evilcards /opt/evil-cards/data

# 3. Настройки
cp .env.example .env
nano .env          # PUBLIC_URL=https://109-172-94-130.sslip.io  (109.172.94.130 заменить!)

# 4. Сервис
cp deploy/evil-cards.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now evil-cards
systemctl status evil-cards
```

Подробные комментарии — в шапке [evil-cards.service](evil-cards.service).
Юнит ограничивает память (`MemoryMax=256M`), перезапускает игру при падении
и запирает запись на диск в единственную папку `data/`.

Если `systemctl status` ругается на `/usr/bin/node` — посмотри `which node`
и впиши реальный путь в `ExecStart`.

---

## Настройка reverse-proxy (обязательно)

Без этого шага игра доступна только изнутри сервера.
**Главное здесь — WebSocket:** без него страница откроется, а игроки не подключатся.

### Вариант 1: Caddy

Проще всего: HTTPS и WebSocket — из коробки.

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)   # бэкап
sudo nano /etc/caddy/Caddyfile
```

Дописать **в конец файла** блок из [Caddyfile.example](Caddyfile.example) —
адрес там уже подставлен. Существующие блоки не трогать: Caddy многосайтовый,
новый сайт это просто новый блок в конце.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Сертификат Let's Encrypt Caddy получит сам при первом обращении к домену.

### Вариант 2: nginx

```bash
sudo tar czf /root/nginx-backup-$(date +%F).tar.gz /etc/nginx      # бэкап
sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/evil-cards.conf
sudo ln -s /etc/nginx/sites-available/evil-cards.conf /etc/nginx/sites-enabled/

# Адрес в конфиге уже подставлен: 109-172-94-130.sslip.io
```

Дальше строго по инструкции в шапке [nginx.example.conf](nginx.example.conf):
сначала включить только блок `:80`, получить сертификат через certbot,
потом раскомментировать блок `:443`.

```bash
sudo certbot --nginx -d "109-172-94-130.sslip.io"
sudo nginx -t && sudo systemctl reload nginx
```

В конфиге уже прописано то, без чего Socket.io не работает:
`proxy_http_version 1.1`, заголовки `Upgrade` и `Connection`,
`proxy_read_timeout 7d` и `proxy_buffering off`.

---

## Как подставить IP: всего две правки

IP сервера появляется ровно в двух местах.

1. **`.env` в папке проекта** — адрес для QR-кода:

   ```
   PUBLIC_URL=https://109-172-94-130.sslip.io      # 109.172.94.130 -> реальный IP сервера
   ```

2. **Конфиг прокси** — имя сайта: в Caddyfile строка `109-172-94-130.sslip.io {`,
   в nginx — `server_name` и пути к сертификату.

После правки `.env`:

```bash
docker compose up -d        # путь А: перечитать переменные
systemctl restart evil-cards   # путь Б
```

Проверка, что QR ведёт куда надо: открыть `/screen` и убедиться, что адрес
под кодом — это `https://<IP>.sslip.io`, а не `localhost`.

---

## Эксплуатация

### Обновить игру

```bash
cd /opt/evil-cards
git pull
bash deploy/deploy.sh          # путь А: пересборка + перезапуск, данные целы
# путь Б:
npm ci --omit=dev && systemctl restart evil-cards
```

Скрипт идемпотентный: повторный запуск = обновление.

### Логи

```bash
docker compose logs -f                  # путь А
docker compose logs --tail=100
journalctl -u evil-cards -f             # путь Б
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

# откатить код на прошлый коммит
git log --oneline -5
git checkout <хеш> && bash deploy/deploy.sh

# полностью убрать игру, ничего больше не задев
docker compose down            # путь А
systemctl disable --now evil-cards && rm /etc/systemd/system/evil-cards.service   # путь Б
sudo rm /etc/nginx/sites-enabled/evil-cards.conf && sudo systemctl reload nginx
#   (для Caddy — удалить свой блок из Caddyfile и sudo systemctl reload caddy)
```

Сайт, бот и VPN после такого удаления продолжают работать как работали.

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
  `proxy_set_header Connection $connection_upgrade;` — и что `map $http_upgrade
  $connection_upgrade` вообще определён (без него `Connection` уедет пустым).
  Проверить: `sudo nginx -T | grep -A3 connection_upgrade`.
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

- Порт 80 должен быть открыт снаружи (`ufw status`), Let's Encrypt ходит на него.
- Домен должен резолвиться: `dig +short "109-172-94-130.sslip.io"` → должен вернуть тот же IP.
- У Let's Encrypt лимит 5 неудачных попыток в час на домен — не долби подряд.

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
| [Caddyfile.example](Caddyfile.example) | Блок для Caddy. WebSocket — сам, HTTPS — сам. |
| [nginx.example.conf](nginx.example.conf) | Server-блок для nginx + команды certbot. |
| [evil-cards.service](evil-cards.service) | systemd-юнит для пути без Docker. |
| `../Dockerfile` | Образ игры: node:20-alpine, не-root, heap 192 МБ. |
| `../docker-compose.yml` | Лимиты 256 МБ / 0.5 CPU, том `data/`, порт только на localhost. |
| `../.env.example` | Шаблон настроек: `PORT`, `PUBLIC_URL`. |

---

## Перед праздником

- [ ] `curl -I https://<IP>.sslip.io/health` отвечает 200 **с телефона по мобильному интернету**, а не только с сервера.
- [ ] Зайти с двух телефонов, проверить, что оба видны в лобби (это и есть тест WebSocket).
- [ ] QR на `/screen` ведёт на `https://<IP>.sslip.io`, а не на localhost.
- [ ] База карт лежит в `data/base-prompts.txt` и `data/base-answers.txt`.
- [ ] `npm run loadtest` прогнан на сервере (см. раздел 10 ТЗ).
- [ ] Бэкап `data/` сделан.
- [ ] `docker stats evil-cards` под нагрузкой показывает заметно меньше 256 МБ.
