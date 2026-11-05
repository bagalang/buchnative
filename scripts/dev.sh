#!/usr/bin/env bash
# dev.sh — локално стартира rocksbaga + backend + frontend, всеки на свой порт.
# Никакви мостове: rocksbaga говори RESP2, backend HTTP/JSON, frontend HTTP.
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

ROCKS_PORT="${ROCKS_PORT:-16579}"
PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# Данните на rocksbaga живеят в приложението (buchnative/db), не в /tmp
LSMPATH="${LSMPATH:-$ROOT/db}"
mkdir -p "$LSMPATH"
export LSMPATH LSMPORT="$ROCKS_PORT"

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

echo "==> rocksbaga на :$ROCKS_PORT"
# LSM engine: един писател, RESP2 сървър. Събира се в мерките секунди.
(
  cd "$BAGA_ROOT"
  if [ -n "$STDBUF" ]; then
    exec stdbuf -oL -eL ./baga -I . -I app-product app-product/rocksbaga/tools/serve.baga
  else
    exec ./baga -I . -I app-product app-product/rocksbaga/tools/serve.baga
  fi
) &
record_pid $!

echo "    чакам rocksbaga да отговори на TCP :$ROCKS_PORT ..."
wait_tcp 127.0.0.1 "$ROCKS_PORT" 600

echo "==> backend на :$PORT (ORM_BACKEND=drock)"
(
  cd "$BAGA_ROOT"
  export PORT ORM_BACKEND=drock DROCK_HOST=127.0.0.1 DROCK_PORT="$ROCKS_PORT"
  # 8 workers: Next.js + React Strict Mode fire many parallel GETs per page;
  # 4 pinned on keep-alive and new pages (and /health) hung.
  export FMR_WORKERS="${FMR_WORKERS:-8}" FMR_LOG="${FMR_LOG:-1}" FMR_CORS="${FMR_CORS:-*}"
  export FMR_JWT_SECRET="${FMR_JWT_SECRET:-dev-secret}" FMR_TITLE=buchnative FMR_VERSION=0.9.5
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
  export LSMPATH DROCK_HOST=127.0.0.1 DROCK_PORT="$ROCKS_PORT"
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
echo "  rocksbaga: RESP2 на :$ROCKS_PORT (LSMPATH=$LSMPATH)"
echo "  backend  : HTTP/JSON на :$PORT          (/health /ready /v1/meta /openapi.json)"
echo "  sidecar  : SMTP+S3+dump Python на :$SIDECAR_PORT"
echo "  frontend : Next.js на :$FRONTEND_PORT"
echo "Ctrl+C спира всичко. От друг терминал: ./scripts/stop.sh"
wait || true
