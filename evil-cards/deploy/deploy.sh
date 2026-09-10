#!/usr/bin/env bash
# ============================================================================
#  Злобные карты — установка и обновление НА СЕРВЕРЕ (путь А, с Docker).
#
#  Скрипт идемпотентный: первый запуск — установка, каждый следующий —
#  обновление (пересборка образа и перезапуск контейнера). Данные из data/
#  при этом не трогаются: они лежат на хосте и подключаются томом.
#
#  ЗАПУСК (из папки проекта):
#      bash deploy/deploy.sh
#
#  ЧТО ДЕЛАЕТ:
#      1. проверяет, что есть docker и docker compose;
#      2. создаёт .env из .env.example и требует заполнить PUBLIC_URL;
#      3. готовит папку data/ (права для пользователя внутри контейнера);
#      4. docker compose build && docker compose up -d;
#      5. ждёт, пока /health ответит;
#      6. печатает, что делать дальше с reverse-proxy.
#
#  ЧЕГО НЕ ДЕЛАЕТ: не трогает Caddy/nginx, сайт, бота и VPN. Настройка
#  прокси — отдельный ручной шаг, чтобы случайно ничего не сломать.
# ============================================================================

set -euo pipefail

# --- Оформление вывода ------------------------------------------------------
step() { echo; echo ">>> $*"; }
ok()   { echo "    [ок] $*"; }
warn() { echo "    [!]  $*"; }
die()  { echo; echo "ОШИБКА: $*" >&2; echo >&2; exit 1; }

# --- Куда мы попали ---------------------------------------------------------
# Скрипт лежит в deploy/, проект — на уровень выше. Работаем всегда из корня
# проекта, откуда бы скрипт ни запустили.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "==============================================================="
echo "  ЗЛОБНЫЕ КАРТЫ — установка/обновление"
echo "  Папка проекта: $PROJECT_DIR"
echo "==============================================================="

# ---------------------------------------------------------------------------
step "1/6 Проверяю, что это папка проекта"
# ---------------------------------------------------------------------------
for NEEDED in package.json Dockerfile docker-compose.yml server; do
    [ -e "$NEEDED" ] || die "в $PROJECT_DIR нет '$NEEDED'.
Скрипт надо запускать из папки с игрой, например:
    cd /opt/evil-cards && bash deploy/deploy.sh"
done
ok "package.json, Dockerfile, docker-compose.yml и server/ на месте"

if [ ! -f package-lock.json ]; then
    warn "нет package-lock.json — версии зависимостей не зафиксированы."
    warn "Сборка пройдёт (сработает npm install), но правильнее один раз"
    warn "локально сделать 'npm install' и закоммитить package-lock.json."
fi

# ---------------------------------------------------------------------------
step "2/6 Проверяю Docker"
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker не установлен.

Два варианта:
  1) поставить Docker:   curl -fsSL https://get.docker.com | sh
  2) пойти БЕЗ Docker — путь Б: systemd + node.
     Инструкция: deploy/README.md, раздел «Путь Б (без Docker)».
     Юнит лежит здесь: deploy/evil-cards.service"

docker info >/dev/null 2>&1 || die "docker установлен, но демон не отвечает.
Проверь:   sudo systemctl status docker
Запусти:   sudo systemctl start docker
Если дело в правах — перезапусти этот скрипт через sudo."

if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
    warn "используется старый docker-compose v1; лучше поставить плагин v2:"
    warn "  sudo apt install docker-compose-plugin"
else
    die "нет docker compose.

Поставь плагин:   sudo apt install docker-compose-plugin
Или иди путём Б без Docker: deploy/README.md, раздел «Путь Б»."
fi
ok "$DC — $($DC version 2>&1 | head -1)"

# ---------------------------------------------------------------------------
step "3/6 Проверяю .env"
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
    [ -f .env.example ] || die "нет ни .env, ни .env.example — репозиторий скачан не полностью."
    cp .env.example .env
    ok "создан .env из .env.example"
    NEW_ENV=1
else
    ok ".env уже есть"
    NEW_ENV=0
fi

# Читаем значение из .env: берём последнюю НЕзакомментированную строку KEY=...
read_env() {
    sed -n "s/^[[:space:]]*$1=[[:space:]]*//p" .env 2>/dev/null \
        | tail -n1 | tr -d '\r' | tr -d '"' | tr -d "'"
}

PUBLIC_URL="$(read_env PUBLIC_URL)"
PORT="$(read_env PORT)"
[ -n "$PORT" ] || PORT=3000

if [ -z "$PUBLIC_URL" ] || [ "$PUBLIC_URL" = "https://109-172-94-130.sslip.io" ] \
   || case "$PUBLIC_URL" in *109.172.94.130*) true;; *) false;; esac; then
    IP_HINT="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    [ -n "$IP_HINT" ] || IP_HINT="<IP-СЕРВЕРА>"
    [ "$NEW_ENV" = "1" ] && echo "    .env только что создан — его надо заполнить."
    die "в .env не задан PUBLIC_URL.

Это адрес, который зашивается в QR-код. Если его не указать, телефоны
получат ссылку на localhost и в игру не зайдут.

Открой .env и впиши (строка должна быть БЕЗ решётки в начале):

    PUBLIC_URL=https://${IP_HINT}.sslip.io

Одной командой:
    sed -i 's|^#*[[:space:]]*PUBLIC_URL=.*|PUBLIC_URL=https://${IP_HINT}.sslip.io|' .env

Потом запусти этот скрипт снова."
fi

case "$PUBLIC_URL" in
    https://*) ok "PUBLIC_URL = $PUBLIC_URL" ;;
    http://*)  warn "PUBLIC_URL на http:// — камера телефона может не открыть ссылку без HTTPS."
               ok "PUBLIC_URL = $PUBLIC_URL" ;;
    *) die "PUBLIC_URL выглядит странно: '$PUBLIC_URL'.
Нужен полный адрес вида https://<IP-сервера>.sslip.io" ;;
esac
ok "PORT = $PORT (наружу не открыт, только 127.0.0.1:$PORT)"

# ---------------------------------------------------------------------------
step "4/6 Готовлю папку data/"
# ---------------------------------------------------------------------------
mkdir -p data
# Внутри контейнера процесс работает от пользователя node (uid 1000).
# Если папка на хосте принадлежит root, контейнер не сможет записать
# state.json — игра не переживёт перезапуск. Поэтому выставляем владельца.
if [ "$(id -u)" = "0" ]; then
    chown -R 1000:1000 data
    ok "data/ отдана uid 1000 (пользователь node внутри контейнера)"
else
    warn "скрипт запущен не от root — права на data/ не меняю."
    warn "Если в логах появится EACCES при записи state.json, выполни:"
    warn "  sudo chown -R 1000:1000 $PROJECT_DIR/data"
fi

for BASE in base-prompts.txt base-answers.txt; do
    if [ -s "data/$BASE" ]; then
        ok "data/$BASE — $(grep -cvE '^[[:space:]]*($|#)' "data/$BASE" 2>/dev/null || echo '?') карт"
    else
        warn "data/$BASE пустой или отсутствует — базу можно долить позже"
        warn "через панель организатора («Загрузить базу»)."
    fi
done

# ---------------------------------------------------------------------------
step "5/6 Собираю образ и запускаю контейнер"
# ---------------------------------------------------------------------------
echo "    (первая сборка — пара минут, дальше быстрее за счёт кеша слоёв)"
$DC build
$DC up -d --remove-orphans
ok "контейнер запущен"

# ---------------------------------------------------------------------------
step "6/6 Жду ответа от /health (до 30 секунд)"
# ---------------------------------------------------------------------------
health_ok() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O /dev/null --timeout=2 "http://127.0.0.1:${PORT}/health" 2>/dev/null
    else
        # Совсем без HTTP-клиентов — верим статусу контейнера.
        [ "$(docker inspect -f '{{.State.Running}}' evil-cards 2>/dev/null)" = "true" ]
    fi
}

HEALTHY=0
for I in $(seq 1 30); do
    if health_ok; then HEALTHY=1; break; fi
    printf '.'
    sleep 1
done
echo

if [ "$HEALTHY" = "1" ]; then
    ok "игра отвечает на http://127.0.0.1:${PORT}/health"
else
    echo
    echo "    /health не ответил за 30 секунд. Последние 50 строк лога:"
    echo "    ---------------------------------------------------------"
    $DC logs --tail=50 2>&1 | sed 's/^/    /'
    echo "    ---------------------------------------------------------"
    echo "    Частые причины:"
    echo "      - порт $PORT уже занят другим сервисом (проверь: bash deploy/check-server.sh);"
    echo "      - в приложении ещё нет эндпоинта /health;"
    echo "      - контейнер упёрся в лимит памяти (посмотри: docker stats evil-cards)."
    die "запуск не подтверждён. Контейнер оставлен работать — разберись по логу выше."
fi

# ---------------------------------------------------------------------------
echo
echo "==============================================================="
echo "  ГОТОВО. Игра крутится в контейнере evil-cards."
echo "==============================================================="
echo
echo "  Сейчас она доступна ТОЛЬКО изнутри сервера (127.0.0.1:${PORT})."
echo "  Это правильно: наружу она должна смотреть через HTTPS-прокси."
echo
echo "  СЛЕДУЮЩИЙ ШАГ — добавить блок в reverse-proxy:"
echo
echo "    Если на сервере Caddy:"
echo "      1. взять блок из deploy/Caddyfile.example,"
echo "      2. заменить 109.172.94.130 на реальный IP,"
echo "      3. дописать блок В КОНЕЦ /etc/caddy/Caddyfile (чужие блоки не трогать!),"
echo "      4. sudo caddy validate --config /etc/caddy/Caddyfile"
echo "      5. sudo systemctl reload caddy"
echo
echo "    Если на сервере nginx:"
echo "      1. sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/evil-cards.conf"
echo "      2. sudo sed -i 's/109.172.94.130/<IP>/g' /etc/nginx/sites-available/evil-cards.conf"
echo "      3. дальше по инструкции в шапке того же файла (certbot, symlink, reload)"
echo
echo "  Полезное:"
echo "    логи:        $DC logs -f"
echo "    память:      docker stats evil-cards"
echo "    рестарт:     $DC restart"
echo "    обновление:  git pull && bash deploy/deploy.sh   (этот же скрипт)"
echo "    бэкап:       tar czf ~/evil-cards-data-\$(date +%F).tar.gz data/"
echo
echo "  Проверка снаружи после настройки прокси:"
echo "    curl -I ${PUBLIC_URL}/health"
echo "    экран ведущего: ${PUBLIC_URL}/screen"
echo
