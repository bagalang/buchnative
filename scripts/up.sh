#!/usr/bin/env bash
# up.sh — локален старт: rocksbaga + buchnative API, всеки на свой порт.
# Без мостове: rocksbaga говори RESP2, API-то HTTP/JSON.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BAGA_ROOT="$(cd "$ROOT/../.." && pwd)"
cd "$BAGA_ROOT"

ROCKS_PORT="${ROCKS_PORT:-16579}"
PORT="${PORT:-8090}"
ROCKS_PATH="${ROCKS_PATH:-$ROOT/db/rocks}"
SECRET="${FMR_JWT_SECRET:-dev-secret-change-me}"

mkdir -p "$ROCKS_PATH"
export LSMPATH="$ROCKS_PATH" LSMPORT="$ROCKS_PORT"
export DROCK_PORT="$ROCKS_PORT" PORT="$PORT" FMR_JWT_SECRET="$SECRET"
export FMR_LOG="${FMR_LOG:-1}" FMR_CORS="${FMR_CORS:-*}"

PIDFILE="$ROOT/.up.pids"
: > "$PIDFILE"
pids=()
cleanup() {
  for p in "${pids[@]:-}"; do
    kill "$p" 2>/dev/null || true
  done
  rm -f "$PIDFILE"
}
trap cleanup EXIT INT TERM

echo "rocksbaga  : $ROCKS_PATH (port $ROCKS_PORT)"
./baga -I . -I app-product app-product/rocksbaga/tools/serve.baga \
  > /tmp/buchnative_rocks.log 2>&1 &
pids+=("$!")

# Чакай сървъра да започне да слуша (до 10 с).
for _ in $(seq 1 40); do
  if (exec 3<>/dev/tcp/127.0.0.1/"$ROCKS_PORT") 2>/dev/null; then
    exec 3<&- || true
    break
  fi
  sleep 0.25
done

echo "buchnative : seed"
./baga -I . -I app-product app-product/buchnative/start.baga seed

echo "buchnative : API на :$PORT"
echo "  health  http://127.0.0.1:$PORT/health"
echo "  login   curl -X POST localhost:$PORT/v1/auth/token \\"
echo "            -H 'Content-Type: application/json' \\"
echo "            -d '{\"email\":\"superadmin\",\"password\":\"123+123\"}'"
echo "  stop    kill $PIDFILE"

./baga -I . -I app-product app-product/buchnative/start.baga serve \
  > /tmp/buchnative_api.log 2>&1 &
pids+=("$!")

wait "${pids[1]}"
