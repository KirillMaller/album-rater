#!/usr/bin/env bash
# ============================================================================
#  Злобные карты — ДИАГНОСТИКА СЕРВЕРА
#
#  Скрипт ТОЛЬКО СМОТРИТ И ПЕЧАТАЕТ.
#  Он НИЧЕГО не устанавливает, НИЧЕГО не запускает, НИЧЕГО не меняет:
#  ни конфигов, ни сервисов, ни фаервола. Сайт, Telegram-бот и VPN,
#  которые уже работают на этом сервере, он не трогает вообще.
#  Запускать на проде безопасно.
#
#  ЗАЧЕМ: понять, что на сервере уже есть (Docker? Node? кто на 80/443?
#  свободен ли порт 3000?), чтобы выбрать способ установки игры.
#
#  КАК ЗАПУСТИТЬ:
#      bash check-server.sh
#  Лучше от root или через sudo — иначе не будет видно, какой процесс
#  занимает порт, и не покажется статус ufw.
#      sudo bash check-server.sh
#
#  ЧТО ДЕЛАТЬ С ВЫВОДОМ: скопировать целиком и прислать в чат.
#  Сохранить в файл:  bash check-server.sh > /tmp/check.txt 2>&1
# ============================================================================

# set -u — ловим опечатки в переменных.
# set -e тут НАМЕРЕННО НЕТ: если какой-то команды на сервере не окажется,
# скрипт должен спокойно доехать до конца, а не оборваться на середине.
set -u

# ---------------------------------------------------------------------------
# Помощники
# ---------------------------------------------------------------------------
section() {
    echo
    echo "==============================================================="
    echo "  $*"
    echo "==============================================================="
}

have() { command -v "$1" >/dev/null 2>&1; }

# Печатает вывод команды с отступом или сообщение, что команды нет.
run_or_note() {
    local cmd="$1"; shift
    if have "$cmd"; then
        "$cmd" "$@" 2>&1 | sed 's/^/    /'
    else
        echo "    команда '$cmd' не установлена"
    fi
}

IS_ROOT="нет"
[ "$(id -u 2>/dev/null || echo 1)" = "0" ] && IS_ROOT="да"

echo "==============================================================="
echo "  ЗЛОБНЫЕ КАРТЫ — отчёт о состоянии сервера"
echo "  Дата:    $(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null)"
echo "  Хост:    $(hostname 2>/dev/null || echo '?')"
echo "  Права:   root — $IS_ROOT"
echo "  Скрипт только читает, ничего не меняет."
echo "==============================================================="

# ---------------------------------------------------------------------------
section "1. ОПЕРАЦИОННАЯ СИСТЕМА И ЖЕЛЕЗО"
# ---------------------------------------------------------------------------
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release 2>/dev/null
    echo "  ОС:            ${PRETTY_NAME:-неизвестно}"
else
    echo "  ОС:            /etc/os-release не читается"
fi
echo "  Ядро:          $(uname -r 2>/dev/null || echo '?')"
echo "  Архитектура:   $(uname -m 2>/dev/null || echo '?')"

CORES="$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo '?')"
echo "  Ядер CPU:      $CORES"
echo "  Аптайм:       $(uptime -p 2>/dev/null || uptime 2>/dev/null || echo '?')"
echo "  Средняя нагрузка (1/5/15 мин): $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo '?')"

echo
echo "  --- Память (free -h) ---"
if have free; then
    free -h 2>&1 | sed 's/^/    /'
else
    grep -E 'MemTotal|MemAvailable|SwapTotal' /proc/meminfo 2>/dev/null | sed 's/^/    /' || echo "    не определить"
fi
echo "  Игре нужно 256 МБ. Если в строке 'available' меньше ~400 МБ —"
echo "  запускать рискованно, сначала посмотри, кто ест память (см. раздел 6)."

echo
echo "  --- Диск (df -h /) ---"
run_or_note df -h /
echo "  Образу Docker нужно ~250 МБ, плюс место под логи. Меньше 1 ГБ свободного — тесно."

# ---------------------------------------------------------------------------
section "2. DOCKER"
# ---------------------------------------------------------------------------
if have docker; then
    echo "  docker установлен:  $(docker --version 2>&1 | head -1)"

    if docker info >/dev/null 2>&1; then
        echo "  демон docker:       ЗАПУЩЕН и отвечает"
    else
        echo "  демон docker:       НЕ ОТВЕЧАЕТ"
        echo "                      (либо не запущен: systemctl status docker,"
        echo "                       либо не хватает прав — перезапусти через sudo)"
    fi

    if docker compose version >/dev/null 2>&1; then
        echo "  docker compose:     $(docker compose version 2>&1 | head -1)   [плагин v2 — то, что нужно]"
    elif have docker-compose; then
        echo "  docker-compose:     $(docker-compose --version 2>&1 | head -1)   [старая v1]"
        echo "                      Скрипт deploy.sh её поддержит, но лучше поставить плагин v2."
    else
        echo "  docker compose:     НЕ НАЙДЕН"
        echo "                      Ставится так: apt install docker-compose-plugin"
    fi
else
    echo "  docker НЕ УСТАНОВЛЕН."
    echo "  Варианты:"
    echo "    - поставить:  curl -fsSL https://get.docker.com | sh   (~300 МБ на диске)"
    echo "    - или идти запасным путём без Docker: systemd + node,"
    echo "      см. deploy/README.md, «Путь Б»."
fi

# ---------------------------------------------------------------------------
section "3. NODE.JS"
# ---------------------------------------------------------------------------
if have node; then
    NODE_V="$(node --version 2>&1)"
    echo "  node установлен:    $NODE_V"
    NODE_MAJOR="$(printf '%s' "$NODE_V" | sed 's/^v//' | cut -d. -f1)"
    case "$NODE_MAJOR" in
        ''|*[!0-9]*) echo "  версию не разобрать — проверь вручную, нужна 20 или выше" ;;
        *) if [ "$NODE_MAJOR" -ge 20 ]; then
               echo "  версия подходит (нужна 20+)."
           else
               echo "  ВЕРСИЯ СТАРАЯ: нужна 20+. Для пути без Docker её придётся обновить."
           fi ;;
    esac
else
    echo "  node НЕ УСТАНОВЛЕН."
    echo "  Для пути с Docker это НЕ нужно — node живёт внутри образа."
    echo "  Для пути без Docker понадобится Node 20+."
fi
have npm && echo "  npm:                $(npm --version 2>&1 | head -1)" || echo "  npm:                не установлен"

# ---------------------------------------------------------------------------
section "4. ПОРТЫ 80 / 443 / 3000 — КТО СЛУШАЕТ"
# ---------------------------------------------------------------------------
LISTEN=""
LISTEN_TOOL="нет"
if have ss; then
    LISTEN="$(ss -tlnp 2>/dev/null)"
    LISTEN_TOOL="ss -tlnp"
elif have netstat; then
    LISTEN="$(netstat -tlnp 2>/dev/null)"
    LISTEN_TOOL="netstat -tlnp"
fi

if [ "$LISTEN_TOOL" = "нет" ]; then
    echo "  Ни ss, ни netstat не найдены — порты проверить нечем."
    echo "  Поставь: apt install iproute2"
else
    echo "  Инструмент: $LISTEN_TOOL"
    [ "$IS_ROOT" = "нет" ] && echo "  (не root: имена процессов могут быть скрыты — перезапусти через sudo)"
    echo

    # Ищем строки, где локальный адрес (4-е поле и у ss, и у netstat)
    # заканчивается на :ПОРТ.
    port_users() {
        printf '%s\n' "$LISTEN" | awk -v p=":$1" '
            NR > 1 && length($4) >= length(p) &&
            substr($4, length($4) - length(p) + 1) == p
        '
    }

    for PORT_CHECK in 80 443 3000; do
        USERS="$(port_users "$PORT_CHECK")"
        if [ -n "$USERS" ]; then
            echo "  >>> порт $PORT_CHECK — ЗАНЯТ, слушает вот это:"
            printf '%s\n' "$USERS" | sed 's/^/        /'
        else
            echo "  >>> порт $PORT_CHECK — СВОБОДЕН"
        fi
        echo
    done

    echo "  Как это читать:"
    echo "    - 80 и 443 заняты caddy или nginx  -> отлично, добавим блок в него;"
    echo "    - 80 и 443 свободны                -> ставим Caddy, он сам возьмёт HTTPS;"
    echo "    - 3000 занят                       -> выбери другой порт (3100, 3210)"
    echo "      и пропиши его в .env (PORT=) — менять больше нигде не надо."
    echo
    echo "  --- Полный список слушающих портов ---"
    printf '%s\n' "$LISTEN" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
section "5. ВЕБ-СЕРВЕРЫ (кандидаты в reverse-proxy)"
# ---------------------------------------------------------------------------
for SRV in caddy nginx apache2 httpd traefik; do
    INSTALLED="нет"
    have "$SRV" && INSTALLED="да ($(command -v "$SRV"))"

    ACTIVE="?"
    if have systemctl; then
        ACTIVE="$(systemctl is-active "$SRV" 2>/dev/null || echo 'не найден')"
    fi

    # Контейнер traefik может крутиться без systemd-юнита
    if [ "$SRV" = "traefik" ] && [ "$INSTALLED" = "нет" ] && have docker; then
        docker ps --format '{{.Image}}' 2>/dev/null | grep -qi traefik && INSTALLED="да (в docker-контейнере)"
    fi

    if [ "$INSTALLED" != "нет" ] || { [ "$ACTIVE" != "не найден" ] && [ "$ACTIVE" != "?" ] && [ "$ACTIVE" != "inactive" ]; }; then
        echo "  [$SRV] установлен: $INSTALLED | systemctl is-active: $ACTIVE"
        case "$SRV" in
            caddy)
                for F in /etc/caddy/Caddyfile /usr/local/etc/caddy/Caddyfile; do
                    [ -f "$F" ] && echo "        конфиг: $F  ($(wc -l < "$F" 2>/dev/null) строк)"
                done
                [ -d /etc/caddy/conf.d ] && echo "        доп. конфиги: /etc/caddy/conf.d/ -> $(ls /etc/caddy/conf.d 2>/dev/null | tr '\n' ' ')"
                ;;
            nginx)
                [ -f /etc/nginx/nginx.conf ] && echo "        конфиг: /etc/nginx/nginx.conf"
                [ -d /etc/nginx/sites-enabled ] && echo "        сайты:  /etc/nginx/sites-enabled/ -> $(ls /etc/nginx/sites-enabled 2>/dev/null | tr '\n' ' ')"
                [ -d /etc/nginx/conf.d ] && echo "        conf.d: /etc/nginx/conf.d/ -> $(ls /etc/nginx/conf.d 2>/dev/null | tr '\n' ' ')"
                ;;
            apache2|httpd)
                [ -d /etc/apache2/sites-enabled ] && echo "        сайты:  /etc/apache2/sites-enabled/ -> $(ls /etc/apache2/sites-enabled 2>/dev/null | tr '\n' ' ')"
                ;;
            traefik)
                [ -f /etc/traefik/traefik.yml ] && echo "        конфиг: /etc/traefik/traefik.yml"
                ;;
        esac
    else
        echo "  [$SRV] не установлен"
    fi
done
echo
echo "  Вывод: если активен caddy — используем deploy/Caddyfile.example."
echo "  Если активен nginx — deploy/nginx.example.conf."
echo "  Если не активно ничего, а 80/443 свободны — проще всего поставить Caddy."
echo "  ВАЖНО: два веб-сервера одновременно на 80/443 не уживутся."

# ---------------------------------------------------------------------------
section "6. ЧТО СЕЙЧАС РАБОТАЕТ (systemd-сервисы)"
# ---------------------------------------------------------------------------
if have systemctl; then
    echo "  --- Запущенные сервисы ---"
    systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null \
        | awk '{print $1}' | sed 's/^/    /' | head -50
    echo
    echo "  Здесь должны быть видны сайт Кирилла, Telegram-бот и VPN."
    echo "  Их конфиги НЕ ТРОГАЕМ — игра ставится рядом отдельным сервисом."
    echo
    echo "  --- Топ-8 процессов по памяти ---"
    ps -eo pid,comm,%mem,rss --sort=-rss 2>/dev/null | head -9 | sed 's/^/    /'
    echo "    (rss — в килобайтах)"
else
    echo "  systemctl не найден — система не на systemd?"
    run_or_note ps aux
fi

# ---------------------------------------------------------------------------
section "7. DOCKER-КОНТЕЙНЕРЫ"
# ---------------------------------------------------------------------------
if have docker && docker info >/dev/null 2>&1; then
    echo "  --- Запущенные ---"
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1 | sed 's/^/    /'
    echo
    echo "  --- Все, включая остановленные ---"
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>&1 | sed 's/^/    /'
    echo
    echo "  --- Место, занятое Docker ---"
    docker system df 2>&1 | sed 's/^/    /'
else
    echo "  Docker недоступен (не установлен, не запущен или нет прав) — пропускаем."
fi

# ---------------------------------------------------------------------------
section "8. ВНЕШНИЙ IP И АДРЕС ИГРЫ"
# ---------------------------------------------------------------------------
EXT_IP=""
if have curl; then
    EXT_IP="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)"
fi
if [ -z "$EXT_IP" ] && have wget; then
    EXT_IP="$(wget -qO- --timeout=5 https://api.ipify.org 2>/dev/null)"
fi
SRC="api.ipify.org"
if [ -z "$EXT_IP" ]; then
    EXT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    SRC="hostname -I (локальный адрес, может отличаться от внешнего!)"
fi

if [ -n "$EXT_IP" ]; then
    echo "  Внешний IP:  $EXT_IP     (источник: $SRC)"
    echo
    echo "  >>> АДРЕС ИГРЫ БУДЕТ ТАКОЙ:"
    echo "  >>>     https://${EXT_IP}.sslip.io"
    echo
    echo "  sslip.io — авто-DNS: имя ${EXT_IP}.sslip.io резолвится обратно"
    echo "  в ${EXT_IP}. Регистрировать домен не нужно, Let's Encrypt его подтверждает."
    echo "  Этот адрес нужно вписать в ДВА места:"
    echo "     1) .env проекта:      PUBLIC_URL=https://${EXT_IP}.sslip.io"
    echo "     2) конфиг прокси:     sslip.io-адрес для ${EXT_IP}"
    if have dig; then
        echo
        echo "  Проверка резолва: $(dig +short "${EXT_IP}.sslip.io" 2>/dev/null | tr '\n' ' ')"
    fi
else
    echo "  Внешний IP определить не удалось (нет интернета или нет curl/wget)."
    echo "  Посмотри IP в панели Aeza. Адрес игры будет https://<IP>.sslip.io"
fi

# ---------------------------------------------------------------------------
section "9. ФАЕРВОЛ"
# ---------------------------------------------------------------------------
if have ufw; then
    echo "  --- ufw status ---"
    ufw status verbose 2>&1 | sed 's/^/    /'
    [ "$IS_ROOT" = "нет" ] && echo "    (не root — статус ufw обычно не показывается, перезапусти через sudo)"
else
    echo "  ufw не установлен."
fi
echo
if have iptables; then
    echo "  --- iptables -L -n (первые 25 строк) ---"
    iptables -L -n 2>&1 | head -25 | sed 's/^/    /'
else
    echo "  iptables не найден."
fi
if have nft; then
    echo
    echo "  --- nft list ruleset (первые 15 строк) ---"
    nft list ruleset 2>&1 | head -15 | sed 's/^/    /'
fi
echo
echo "  Что должно быть открыто СНАРУЖИ: 80 и 443 (для HTTPS и сертификата)."
echo "  Порт 3000 наружу открывать НЕ НАДО — игра смотрит в мир только через прокси."

# ---------------------------------------------------------------------------
section "ГОТОВО"
# ---------------------------------------------------------------------------
echo "  Скрипт закончил работу. Ничего на сервере не изменилось."
echo "  Скопируй весь вывод выше и пришли в чат — по нему выберем способ установки."
echo
