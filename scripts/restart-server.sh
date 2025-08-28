#!/usr/bin/env bash
# Restart the conversion server and open the UI (macOS)
# Kills any existing node server.js process started from this folder, starts it again, tails the server log and opens index.html
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")"/.. && pwd)"
cd "$PROJECT_ROOT"
# Kill previous server (best-effort)
pkill -f "node server.js" || true
sleep 0.4
# Start server in background and capture pid
nohup node server.js > server.log 2>&1 &
SERVER_PID=$!
echo "Started server (pid=$SERVER_PID)"
# Give server a moment to bind
sleep 0.6
# Open the UI in default browser (macOS)
which open &>/dev/null && open index.html || echo "Not macOS: open index.html manually"
# Tail log so user can see what's happening
sleep 0.3
if [ -f server.log ]; then
  tail -n 200 server.log
fi
