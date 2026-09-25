#!/usr/bin/env bash
# One command to validate everything:
#   1. build   2. all mainnet-fork tests (Base + Ethereum)   3. local environment up (fork + deploy + agent + UI)
#   4. scripted end-to-end check on the running environment   5. leaves the environment running for manual testing
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
echo "== 1/4 build"; forge build >/dev/null 2>&1 && echo "  build ok" || { echo "  build FAILED"; exit 1; }
echo "== 2/4 mainnet-fork test suites (real Aqua, SwapVM, Uniswap v4, Chainlink, tokens)"
forge test -j 1 2>&1 | tee .run/forge-test.log | grep -E "^Ran [0-9]+ test|Suite result|\[FAIL" ; grep -q "0 failed" <(tail -3 .run/forge-test.log) || FAIL=1
echo "== 3/4 local environment"
if [ -f .run/anvil.pid ] && kill -0 "$(cat .run/anvil.pid)" 2>/dev/null && [ -f deployments/local.json ]; then echo "  already running"; else ./scripts/start_local.sh || exit 1; fi
echo "== 4/4 end-to-end check on the running environment"
[ -f .run/agent.pid ] && kill "$(cat .run/agent.pid)" 2>/dev/null; pkill -f "scripts/agent.ts" 2>/dev/null; rm -f .run/agent.pid
(cd frontend && npx tsx scripts/e2e-check.ts) || FAIL=1
echo "== terminal demo"
(cd frontend && npx tsx scripts/demo.ts) > .run/demo.out 2>&1 && grep -q "Done." .run/demo.out && echo "  [PASS] terminal demo ran all 8 steps (output: .run/demo.out)" || { echo "  [FAIL] terminal demo (see .run/demo.out)"; FAIL=1; }
(cd frontend && NETWORK=local INTERVAL=${INTERVAL:-30} nohup node --import tsx scripts/agent.ts >> ../.run/agent.log 2>&1 & echo $! > ../.run/agent.pid)
echo
[ $FAIL = 0 ] && echo "ALL CHECKS PASSED." || echo "SOME CHECKS FAILED (see above)."
echo "Environment still running -> UI: http://localhost:${UI_PORT:-8787}/   stop: ./scripts/stop_local.sh"
exit $FAIL
