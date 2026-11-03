#!/usr/bin/env bash
# dev.sh — локално стартира boilaDB + backend + frontend, всеки на свой порт.
# Никакви мостове: boilaDB говори PostgreSQL v3 wire, backend HTTP/JSON, frontend HTTP.
set -euo pipefail

# Node 22 (nvm) за Next.js — чист shell без .bashrc вижда /usr/bin/node (18)
if [ -d "$HOME/.nvm/versions/node/v22.22.0/bin" ]; then
  export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
fi

# baga print-овете са буферизирани в C; stdbuf ги прави ред-базирани за лога
STDBUF="stdbuf -oL -eL"
command -v stdbuf >/dev/null 2>&1 || STDBUF=""

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BAGA_ROOT="$(cd "$ROOT/../.." && pwd)"

BOILA_PGPORT="${BOILA_PGPORT:-6575}"
PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# Данните на boilaDB живеят в приложението (buchnative/db), не в /tmp
BOILA_PATH="${BOILA_PATH:-$ROOT/db}"
mkdir -p "$BOILA_PATH"
export BOILA_PATH

PIDFILE="$ROOT/.dev.pids"
: > "$PIDFILE"

pids=()
record_pid() {
  pids+=("$1")
  echo "$1" >> "$PIDFILE"
}

cleanup() {
  for p in "${pids[@]:-}"; do
    kill "$p" 2>/dev/null || true
    pkill -P "$p" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -f "$PIDFILE"
}
trap cleanup EXIT INT TERM

wait_tcp() {
  local host="$1" port="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
      exec 3>&- 3<&- || true
      return 0
    fi
    sleep 0.5
  done
  return 1
}

echo "==> boilaDB serve_pg на :$BOILA_PGPORT"
# P31 connection mux: idle keep-alive fds стоят в poll; worker-ите въртят
# по едно заявление и паркират fd-то. Не е 1 worker на връзка — 8 стигат
# за backend + psql. P30: BOILA_SYNC_EVERY остава 1 (счетоводна издръжливост).
# P43 dual-get: нови BOILA_PATH директории; стара база без маркера p43|dual
# пада към scan (коректно, по-бавно).
(
  cd "$BAGA_ROOT"
  export BOILA_PGPORT BOILA_WORKERS="${BOILA_WORKERS:-8}"
  if [ -n "$STDBUF" ]; then
    exec stdbuf -oL -eL ./baga -I . -I app-product app-product/boilaDB/tools/serve_pg.baga
  else
    exec ./baga -I . -I app-product app-product/boilaDB/tools/serve_pg.baga
  fi
) &
record_pid $!

echo "    чакам boilaDB да отговори на TCP :$BOILA_PGPORT ..."
# boilaDB се компилира при старт (минути при студена кеш) — чакаме до 10 мин
wait_tcp 127.0.0.1 "$BOILA_PGPORT" 1200

echo "==> backend на :$PORT (ORM_BACKEND=boila)"
(
  cd "$BAGA_ROOT"
  export PORT ORM_BACKEND=boila BOILA_PGHOST=127.0.0.1 BOILA_PGPORT
  export BOILA_PGUSER="${BOILA_PGUSER:-boila}" BOILA_PGDATABASE="${BOILA_PGDATABASE:-boila}"
  # 8 workers: Next.js + React Strict Mode fire many parallel GETs per page;
  # 4 pinned on keep-alive and new pages (and /health) hung.
  export FMR_WORKERS="${FMR_WORKERS:-8}" FMR_LOG="${FMR_LOG:-1}" FMR_CORS="${FMR_CORS:-*}"
  export FMR_JWT_SECRET="${FMR_JWT_SECRET:-dev-secret}" FMR_TITLE=buchnative FMR_VERSION=0.8.9
  if [ -n "$STDBUF" ]; then
    exec stdbuf -oL -eL ./baga -I . -I app-product app-product/buchnative/backend/start.baga
  else
    exec ./baga -I . -I app-product app-product/buchnative/backend/start.baga
  fi
) &
record_pid $!

SIDECAR_PORT="${BUCHNATIVE_SIDECAR_PORT:-5050}"
echo "==> Python sidecar SMTP+S3+dump на :$SIDECAR_PORT"
(
  cd "$ROOT/scripts/py"
  export BUCHNATIVE_SIDECAR_PORT="$SIDECAR_PORT"
  export BOILA_PGHOST="${BOILA_PGHOST:-127.0.0.1}"
  export BOILA_PGPORT
  export BOILA_PGUSER="${BOILA_PGUSER:-boila}"
  export BOILA_PGDATABASE="${BOILA_PGDATABASE:-boila}"
  if [ -n "$STDBUF" ]; then
    exec stdbuf -oL -eL python3 sidecar.py
  else
    exec python3 sidecar.py
  fi
) &
record_pid $!

echo "==> frontend на :$FRONTEND_PORT"
(cd "$ROOT/frontend" && exec npm run dev -- --port "$FRONTEND_PORT") &
record_pid $!

echo
echo "Стартирани (универсални приложения, само през портове):"
echo "  boilaDB  : PostgreSQL v3 wire на :$BOILA_PGPORT"
echo "  backend  : HTTP/JSON на :$PORT          (/health /ready /v1/meta /openapi.json)"
echo "  sidecar  : SMTP+S3+dump Python на :$SIDECAR_PORT"
echo "  frontend : Next.js на :$FRONTEND_PORT"
echo "Ctrl+C спира всичко. От друг терминал: ./scripts/stop.sh"
wait || true
