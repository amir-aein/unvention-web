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
}
trap cleanup EXIT

DESKTOP_PATH="$OUT_DIR/ui-home-desktop.png"
MOBILE_PATH="$OUT_DIR/ui-home-mobile.png"

"$CHROME_BIN" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1512,982 \
  --virtual-time-budget=3500 \
  --screenshot="$DESKTOP_PATH" \
  "$CAPTURE_URL" >/dev/null 2>&1

"$CHROME_BIN" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --no-first-run \
  --no-default-browser-check \
  --window-size=390,844 \
  --virtual-time-budget=3500 \
  --screenshot="$MOBILE_PATH" \
  "$CAPTURE_URL" >/dev/null 2>&1

echo "Saved screenshots:"
echo " - $DESKTOP_PATH"
echo " - $MOBILE_PATH"
echo "Captured URL: $CAPTURE_URL"
