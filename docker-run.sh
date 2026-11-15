#!/usr/bin/env bash
#
# Build and run Lucky Draw with Docker Compose on a free host port.
#
#   ./docker-run.sh                 build + start on the first free port from 3000
#   ./docker-run.sh up --port 8080  start looking from 8080 instead
#   ./docker-run.sh down            stop and remove the container
#   ./docker-run.sh restart         down, then up (picks a port again)
#   ./docker-run.sh logs            follow the container logs
#   ./docker-run.sh status          show the container and its URL
#
# The start port can also come from the PORT environment variable. Works in
# bash on Linux, macOS and Git Bash on Windows.

set -euo pipefail

cd "$(dirname "$0")"

START_PORT="${PORT:-3000}"
SCAN=100          # how many ports to try before giving up
SERVICE="app"
COMMAND="up"

usage() {
  sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    up | down | restart | logs | status) COMMAND="$1" ;;
    -p | --port)
      [ $# -ge 2 ] || { echo "error: $1 needs a port number" >&2; exit 2; }
      START_PORT="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$START_PORT" in
  '' | *[!0-9]*) echo "error: port must be a number, got '$START_PORT'" >&2; exit 2 ;;
esac
if [ "$START_PORT" -lt 1 ] || [ "$START_PORT" -gt 65535 ]; then
  echo "error: port must be between 1 and 65535" >&2
  exit 2
fi

# ---- helpers ---------------------------------------------------------------

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is not installed or not on PATH" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "error: the Docker daemon is not running — start Docker Desktop (or dockerd) and retry" >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "error: 'docker compose' (Compose v2+) is not available" >&2
    exit 1
  fi
}

# True if something is already listening on the port.
port_in_use() {
  local p="$1"
  # bash's /dev/tcp: a successful connect means the port is taken.
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    return 0
  fi
  # Fallbacks for shells built without /dev/tcp.
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$p\$" && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -Ei "listen" | grep -Eq "[:.]$p[[:space:]]" && return 0
  fi
  return 1
}

find_free_port() {
  local p="$1" last=$(( $1 + SCAN - 1 ))
  [ "$last" -le 65535 ] || last=65535
  while [ "$p" -le "$last" ]; do
    if ! port_in_use "$p"; then
      echo "$p"
      return 0
    fi
    p=$(( p + 1 ))
  done
  return 1
}

# The host port the running container is published on, if it is running.
running_port() {
  docker compose port "$SERVICE" 3000 2>/dev/null | awk -F: 'NF {print $NF}' | head -n1
}

wait_until_up() {
  local url="$1" tries=60
  printf "Waiting for %s " "$url"
  while [ "$tries" -gt 0 ]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS -o /dev/null "$url" 2>/dev/null; then echo " ready."; return 0; fi
    elif port_in_use "${url##*:}"; then
      echo " ready."; return 0
    fi
    printf "."
    sleep 2
    tries=$(( tries - 1 ))
  done
  echo
  echo "warning: the app did not answer within 2 minutes — check './docker-run.sh logs'" >&2
  return 1
}

print_urls() {
  local port="$1"
  cat <<EOF

  Lucky Draw is running on port $port

    Demo      http://localhost:$port/demo       (start here: a ready-to-draw sample event)
    Setup     http://localhost:$port/
    Stage     http://localhost:$port/stage      (the projector)
    Control   http://localhost:$port/control    (a second tab, same browser)

  Stop it with: ./docker-run.sh down
EOF
}

# ---- commands --------------------------------------------------------------

cmd_up() {
  require_docker

  local existing
  existing="$(running_port || true)"
  if [ -n "$existing" ]; then
    echo "Already running — reusing port $existing."
    print_urls "$existing"
    return 0
  fi

  local port
  if ! port="$(find_free_port "$START_PORT")"; then
    echo "error: no free port between $START_PORT and $(( START_PORT + SCAN - 1 ))" >&2
    exit 1
  fi
  if [ "$port" != "$START_PORT" ]; then
    echo "Port $START_PORT is taken — using $port instead."
  else
    echo "Using port $port."
  fi

  HOST_PORT="$port" docker compose up -d --build
  wait_until_up "http://localhost:$port" || true
  print_urls "$port"
}

cmd_down() {
  require_docker
  docker compose down
}

cmd_logs() {
  require_docker
  docker compose logs -f "$SERVICE"
}

cmd_status() {
  require_docker
  docker compose ps
  local port
  port="$(running_port || true)"
  if [ -n "$port" ]; then
    print_urls "$port"
  else
    echo
    echo "  Not running. Start it with: ./docker-run.sh"
  fi
}

case "$COMMAND" in
  up) cmd_up ;;
  down) cmd_down ;;
  restart) cmd_down; cmd_up ;;
  logs) cmd_logs ;;
  status) cmd_status ;;
esac
