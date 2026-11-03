#!/usr/bin/env bash
# stop.sh — спира стека на buchnative (rocksbaga, backend, frontend).
# Работи и ако dev.sh върви в друг терминал: PID файл + слушатели на портовете.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.dev.pids"

ROCKS_PORT="${ROCKS_PORT:-16579}"
PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
SIDECAR_PORT="${BUCHNATIVE_SIDECAR_PORT:-5050}"

killed=()

note() {
  echo "    $*"
}

have_pid() {
  local p="$1"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

# Деца, после родителя. TERM, кратко чакане, после KILL.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local kids
  kids=$(pgrep -P "$pid" 2>/dev/null || true)
  local k
  for k in $kids; do
    kill_tree "$k"
  done
  if have_pid "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
    killed+=("$pid")
  fi
}

pids_on_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    # fuser печата PID-ове през stderr с "  1234" и понякога през stdout
    fuser -n tcp "$port" 2>/dev/null | tr -cs '0-9' '\n' | grep -E '^[0-9]+$' || true
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi
  ss -ltnp 2>/dev/null | awk -v p=":$port" '
    $4 ~ p"$" {
      while (match($0, /pid=[0-9]+/)) {
        print substr($0, RSTART+4, RLENGTH-4)
        $0 = substr($0, RSTART+RLENGTH)
      }
    }'
}

echo "==> спирам buchnative"

if [ -f "$PIDFILE" ]; then
  while read -r pid; do
    [ -n "${pid:-}" ] || continue
    if have_pid "$pid"; then
      note "pid $pid (от .dev.pids)"
      kill_tree "$pid"
    fi
  done < "$PIDFILE"
  rm -f "$PIDFILE"
fi

for spec in "rocksbaga:$ROCKS_PORT" "backend:$PORT" "frontend:$FRONTEND_PORT" "sidecar:$SIDECAR_PORT"; do
  name="${spec%%:*}"
  port="${spec##*:}"
  for pid in $(pids_on_port "$port"); do
    if have_pid "$pid"; then
      note "порт :$port ($name) pid $pid"
      kill_tree "$pid"
    fi
  done
done

# npm/next често оставя дете next-server след убития npm
sleep 0.4
still=0
for pid in "${killed[@]:-}"; do
  if have_pid "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
    still=1
  fi
done
for spec in "$ROCKS_PORT" "$PORT" "$FRONTEND_PORT" "$SIDECAR_PORT"; do
  for pid in $(pids_on_port "$spec"); do
    if have_pid "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
      still=1
    fi
  done
done

if [ "$still" = 1 ]; then
  sleep 0.2
fi

up=()
for spec in "rocksbaga:$ROCKS_PORT" "backend:$PORT" "frontend:$FRONTEND_PORT" "sidecar:$SIDECAR_PORT"; do
  name="${spec%%:*}"
  port="${spec##*:}"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3>&- 3<&- || true
    up+=("$name :$port")
  fi
done

if [ "${#up[@]}" -gt 0 ]; then
  echo "не спряха:"
  for u in "${up[@]}"; do
    echo "    $u"
  done
  exit 1
fi

echo "    спряно ($ROCKS_PORT / $PORT / $FRONTEND_PORT / $SIDECAR_PORT са свободни, ако не са презаписани с env)"
