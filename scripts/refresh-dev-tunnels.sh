#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_PORT="${APP_PORT:-5176}"
RELAY_PORT="${RELAY_PORT:-7777}"
APP_LOCAL_URL="http://localhost:${APP_PORT}"
RELAY_LOCAL_URL="http://localhost:${RELAY_PORT}"
ENV_FILE=".env.local"

STATE_DIR="${STATE_DIR:-/tmp/nostr-paper-dev-tunnels}"
LOG_DIR="${STATE_DIR}/logs"
mkdir -p "$LOG_DIR"

APP_PID_FILE="${STATE_DIR}/app.pid"
APP_TUNNEL_PID_FILE="${STATE_DIR}/app-tunnel.pid"
RELAY_TUNNEL_PID_FILE="${STATE_DIR}/relay-tunnel.pid"
APP_LOG="${LOG_DIR}/app.log"
APP_TUNNEL_LOG="${LOG_DIR}/app-tunnel.log"
RELAY_TUNNEL_LOG="${LOG_DIR}/relay-tunnel.log"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

kill_from_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
  fi
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-30}"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if curl -I -fsS --max-time 8 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

extract_tunnel_url() {
  local log_file="$1"
  local timeout_seconds="${2:-45}"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    local url
    url="$(rg -a --no-messages -o "https://[a-z0-9-]+\\.trycloudflare\\.com" "$log_file" | tail -n 1 || true)"
    if [[ -n "$url" ]]; then
      echo "$url"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

start_tunnel_with_retry() {
  local pid_file="$1"
  local log_file="$2"
  local health_timeout="$3"
  shift 3

  local attempt
  for attempt in 1 2 3; do
    kill_from_pid_file "$pid_file"
    : > "$log_file"

    nohup cloudflared "$@" >"$log_file" 2>&1 &
    echo "$!" > "$pid_file"

    local public_url
    if ! public_url="$(extract_tunnel_url "$log_file" 45)"; then
      continue
    fi

    if wait_for_http "$public_url" "$health_timeout"; then
      echo "$public_url"
      return 0
    fi
  done

  return 1
}

set_env_value() {
  local key="$1"
  local value="$2"
  if [[ ! -f "$ENV_FILE" ]]; then
    touch "$ENV_FILE"
  fi

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i '' "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

require_cmd npm
require_cmd cloudflared
require_cmd curl
require_cmd rg

if ! lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting app on port ${APP_PORT}..."
  nohup npm run dev -- --port "$APP_PORT" --strictPort >"$APP_LOG" 2>&1 &
  echo "$!" > "$APP_PID_FILE"
else
  echo "App already listening on port ${APP_PORT}; reusing it."
fi

if ! wait_for_http "$APP_LOCAL_URL" 45; then
  echo "App did not become ready on ${APP_LOCAL_URL}." >&2
  exit 1
fi

echo "Restarting Cloudflare tunnels..."
APP_PUBLIC_URL="$(start_tunnel_with_retry "$APP_TUNNEL_PID_FILE" "$APP_TUNNEL_LOG" 75 tunnel --protocol http2 --url "$APP_LOCAL_URL" --http-host-header "localhost:${APP_PORT}")"
RELAY_PUBLIC_URL="$(start_tunnel_with_retry "$RELAY_TUNNEL_PID_FILE" "$RELAY_TUNNEL_LOG" 75 tunnel --protocol http2 --url "$RELAY_LOCAL_URL")"
RELAY_WS_URL="${RELAY_PUBLIC_URL/https:/wss:}"

set_env_value "VITE_DEFAULT_RELAY_URLS" "$RELAY_WS_URL"
set_env_value "VITE_DEFAULT_RELAYS_EXCLUSIVE" "false"
set_env_value "VITE_FORCE_DEFAULT_RELAYS" "false"

echo ""
echo "App local:   ${APP_LOCAL_URL}"
echo "App public:  ${APP_PUBLIC_URL}"
echo "Relay local: ${RELAY_LOCAL_URL}"
echo "Relay public:${RELAY_PUBLIC_URL}"
echo "Relay ws:    ${RELAY_WS_URL}"
echo ""
echo "Updated ${ENV_FILE}:"
echo "  VITE_DEFAULT_RELAY_URLS=${RELAY_WS_URL}"
echo "  VITE_DEFAULT_RELAYS_EXCLUSIVE=false"
echo "  VITE_FORCE_DEFAULT_RELAYS=false"
echo ""
echo "If Vite is already running, it will auto-restart when ${ENV_FILE} changes."
