#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/sim/output/latest}"
URL="${UI_SCREENSHOT_URL:-http://127.0.0.1:8080/index.html}"
CAPTURE_URL="$URL"

if [[ "$CAPTURE_URL" =~ ^https?:// ]]; then
  CAPTURE_URL="$(printf "%s" "$CAPTURE_URL" | sed -E 's#(https?://[^/]+).*$#\1/index.html#')"
fi

mkdir -p "$OUT_DIR"

CHROME_BIN="${CHROME_BIN:-}"
if [[ -z "$CHROME_BIN" ]]; then
  if [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  elif command -v google-chrome >/dev/null 2>&1; then
    CHROME_BIN="$(command -v google-chrome)"
  elif command -v chromium >/dev/null 2>&1; then
    CHROME_BIN="$(command -v chromium)"
  elif command -v chromium-browser >/dev/null 2>&1; then
    CHROME_BIN="$(command -v chromium-browser)"
  fi
fi

if [[ -z "$CHROME_BIN" || ! -x "$CHROME_BIN" ]]; then
  echo "ERROR: Headless Chrome/Chromium not found." >&2
  echo "Set CHROME_BIN to a valid browser executable and retry." >&2
  exit 1
fi

SERVER_PID=""
CHROME_TMP_ROOT=""
CHROME_USER_DATA_DIR=""
if ! curl -fsS "$URL" >/dev/null 2>&1; then
  node "$ROOT_DIR/server/index.js" >/tmp/unvention-ui-server.log 2>&1 &
  SERVER_PID="$!"
  for _ in $(seq 1 30); do
    if curl -fsS "$URL" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
  if ! curl -fsS "$URL" >/dev/null 2>&1; then
    echo "WARN: Could not reach $URL after starting local server." >&2
    echo "WARN: Falling back to file capture (no live API data)." >&2
    if [[ -n "$SERVER_PID" ]]; then
      kill "$SERVER_PID" >/dev/null 2>&1 || true
      SERVER_PID=""
    fi
    CAPTURE_URL="file://$ROOT_DIR/index.html"
  fi
fi

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CHROME_USER_DATA_DIR" ]] && command -v pkill >/dev/null 2>&1; then
    pkill -f "$CHROME_USER_DATA_DIR" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CHROME_TMP_ROOT" && -d "$CHROME_TMP_ROOT" ]]; then
    rm -rf "$CHROME_TMP_ROOT"
  fi
}
trap cleanup EXIT

DESKTOP_PATH="$OUT_DIR/ui-home-desktop.png"
MOBILE_PATH="$OUT_DIR/ui-home-mobile.png"

CHROME_TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/unvention-chrome.XXXXXX")"
CHROME_USER_DATA_DIR="$CHROME_TMP_ROOT/profile"
mkdir -p "$CHROME_USER_DATA_DIR"
CHROME_CAPTURE_TIMEOUT_MS="${CHROME_CAPTURE_TIMEOUT_MS:-9000}"

stop_chrome_profile_processes() {
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "$CHROME_USER_DATA_DIR" >/dev/null 2>&1 || true
  fi
}

stop_capture_process() {
  local process_pid="$1"
  if [[ -z "$process_pid" ]]; then
    return 0
  fi
  if kill -0 "$process_pid" >/dev/null 2>&1; then
    kill "$process_pid" >/dev/null 2>&1 || true
    sleep 0.2
    kill -9 "$process_pid" >/dev/null 2>&1 || true
  fi
  wait "$process_pid" >/dev/null 2>&1 || true
}

wait_for_screenshot_file() {
  local screenshot_path="$1"
  local timeout_ms="$2"
  local elapsed_ms=0
  while (( elapsed_ms < timeout_ms )); do
    if [[ -s "$screenshot_path" ]]; then
      return 0
    fi
    sleep 0.1
    elapsed_ms=$((elapsed_ms + 100))
  done
  return 1
}

start_capture_with_mode() {
  local headless_flag="$1"
  local screenshot_path="$2"
  local window_size="$3"
  "$CHROME_BIN" \
    "$headless_flag" \
    --no-sandbox \
    --disable-gpu \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --hide-scrollbars \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="$CHROME_USER_DATA_DIR" \
    --remote-debugging-port=0 \
    --window-size="$window_size" \
    --timeout="$CHROME_CAPTURE_TIMEOUT_MS" \
    --virtual-time-budget=3500 \
    --screenshot="$screenshot_path" \
    "$CAPTURE_URL" >/dev/null 2>&1 &
  echo "$!"
}

capture_with_mode() {
  local headless_flag="$1"
  local screenshot_path="$2"
  local window_size="$3"
  local capture_pid=""
  capture_pid="$(start_capture_with_mode "$headless_flag" "$screenshot_path" "$window_size")"
  if wait_for_screenshot_file "$screenshot_path" "$CHROME_CAPTURE_TIMEOUT_MS"; then
    stop_capture_process "$capture_pid"
    stop_chrome_profile_processes
    return 0
  fi
  stop_capture_process "$capture_pid"
  stop_chrome_profile_processes
  return 1
}

capture_screenshot() {
  local screenshot_path="$1"
  local window_size="$2"
  stop_chrome_profile_processes
  rm -f "$screenshot_path"
  if capture_with_mode "--headless=new" "$screenshot_path" "$window_size"; then
    return 0
  fi
  echo "WARN: Chrome failed with --headless=new for $screenshot_path; retrying with --headless." >&2
  rm -f "$screenshot_path"
  if capture_with_mode "--headless" "$screenshot_path" "$window_size"; then
    return 0
  fi
  echo "ERROR: Chrome screenshot capture failed for $screenshot_path in both headless modes." >&2
  return 1
}

capture_screenshot "$DESKTOP_PATH" "1512,982"
capture_screenshot "$MOBILE_PATH" "390,844"

echo "Saved screenshots:"
echo " - $DESKTOP_PATH"
echo " - $MOBILE_PATH"
echo "Captured URL: $CAPTURE_URL"
