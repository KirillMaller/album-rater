# yandex-music-proxy

Маленький HTTP-сервер на Node.js (~110 строк). Принимает ссылку с Яндекс.Музыки, идёт во **внутренний JSON API Яндекса** `api.music.yandex.net/albums/{id}/with-tracks`, парсит и возвращает аккуратный JSON для фронта.

## Зачем

Яндекс **геоблокирует** свой API для не-российских IP — Supabase Edge Functions, Vercel, Cloudflare Workers и прочие зарубежные хостинги получают HTTP 451. Прямой запрос из браузера блокируется CORS. Поэтому нужен прокси с **российским IP**.

## Где это живёт

- **Сервер:** VPS на reg.cloud, IP `195.208.3.209` (рядом с Telegram-ботом `bot-napominalka`).
- **Папка на сервере:** `/opt/yandex-proxy/`.
- **Слушает:** `127.0.0.1:3001` (наружу не выставлен, только через Caddy).
- **Публичный URL:** `https://195.208.3.209.sslip.io/yandex-music/import?url=...`.
- **HTTPS:** Caddy + автоматический Let's Encrypt сертификат на `sslip.io`-домене.
- **systemd:** сервис `yandex-proxy.service` — автозапуск при ребуте, рестарт при падении.

## Эндпоинты

- `GET /health` → `{"ok": true, "service": "yandex-music-proxy"}` — проверка живости.
- `GET /yandex-music/import?url=<ссылка>` → JSON с метаданными альбома/трека.

Пример успешного ответа:

```json
{
  "albumId": "31203434",
  "trackId": "125934290",
  "title": "МИР ГОРИТ",
  "artist": "Oxxxymiron",
  "year": 2024,
  "genre": "rusrap",
  "coverUrl": "https://avatars.yandex.net/get-music-content/.../600x600",
  "tracks": [{"id": 125934290, "title": "МИР ГОРИТ", "duration": "3:25"}],
  "sourceUrl": "https://music.yandex.ru/album/31203434/track/125934290"
}
```

## Как переразвернуть с нуля

Предположим VPS с Ubuntu 24.04, root-доступ.

```bash
# 1. Установить Node.js 22 LTS и Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# 2. Закинуть код прокси
mkdir -p /opt/yandex-proxy
# скопировать index.mjs и package.json из этой папки в /opt/yandex-proxy/

# 3. Поставить systemd-юнит
# скопировать yandex-proxy.service в /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yandex-proxy

# 4. Настроить Caddy
# скопировать Caddyfile в /etc/caddy/Caddyfile (заменив IP на свой)
systemctl restart caddy

# 5. Проверить
curl https://<твой-ip>.sslip.io/health
```

## Как обновить код прокси

```bash
# С твоей машины:
scp -i ~/.ssh/bot-napominalka-reg-ru server/yandex-proxy/index.mjs root@195.208.3.209:/opt/yandex-proxy/index.mjs
ssh -i ~/.ssh/bot-napominalka-reg-ru root@195.208.3.209 'systemctl restart yandex-proxy'
```

## Где у фронта это прописано

В [src/main.tsx](../../src/main.tsx) функция `importFromYandex` берёт базовый URL из env-переменной `VITE_YANDEX_PROXY_URL` (см. `.env.example`).

- На локалке: `.env.local` с `VITE_YANDEX_PROXY_URL=https://195.208.3.209.sslip.io`.
- На проде (GitHub Pages): тот же URL прописан в GitHub Secrets и подставляется при сборке.

## Что делать, если перестанет работать

1. Проверить статус: `systemctl status yandex-proxy caddy`.
2. Логи: `journalctl -u yandex-proxy -n 50` и `journalctl -u caddy -n 50`.
3. С сервера дёрнуть Яндекс: `curl -sI https://api.music.yandex.net/albums/2295186/with-tracks` — если не 200, Яндекс мог поменять API или начать блокировать прокси-IP.
