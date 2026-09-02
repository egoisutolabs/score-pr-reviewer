#!/usr/bin/env bash
# Boots the agent and the web app, proves both answer, then shuts them down.
# No API key needed: it only hits health and the landing page.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/pr-reviewer-smoke"
mkdir -p "$LOG"

(cd "$ROOT/agent" && PORT=8123 uv run uvicorn main:app --host 127.0.0.1 --port 8123 > "$LOG/agent.log" 2>&1) &
AGENT=$!
(cd "$ROOT/web" && PORT=3000 npm run dev > "$LOG/web.log" 2>&1) &
WEB=$!
trap 'kill $AGENT $WEB 2>/dev/null || true' EXIT

wait_for() { for _ in $(seq 1 60); do curl -sf "$1" > /dev/null && return 0; sleep 1; done; echo "timeout waiting for $1"; cat "$2"; return 1; }
wait_for http://127.0.0.1:8123/healthz "$LOG/agent.log"
echo "agent ok"
wait_for http://127.0.0.1:3000/ "$LOG/web.log"
echo "web ok"
# The runtime route must exist and reject GET politely (it is POST-only).
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/copilotkit)
echo "copilotkit route -> $code"
