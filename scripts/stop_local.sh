#!/usr/bin/env bash
# Stops the local fork, agent and UI started by scripts/start_local.sh.
cd "$(dirname "$0")/.."
for p in agent ui anvil; do
  f=.run/$p.pid
  if [ -f "$f" ]; then kill "$(cat "$f")" 2>/dev/null && echo "stopped $p"; rm -f "$f"; fi
done
pkill -f "next start -p ${UI_PORT:-8787}" 2>/dev/null; pkill -f "next-server" 2>/dev/null; pkill -f "scripts/agent.ts" 2>/dev/null; true
