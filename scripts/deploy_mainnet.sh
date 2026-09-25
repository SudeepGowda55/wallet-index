#!/usr/bin/env bash
# Deploys WalletIndex to Base mainnet (or any RPC via RPC_URL) with real Chainlink feeds.
# Prereqs: .env filled in; deployer holds a little ETH for gas + FLOAT_USDC/FLOAT_WETH; each maker holds
# small amounts of WETH, USDC and cbBTC (their whole balance is allocated to their basket) and a little ETH for gas.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
R=${RPC_URL:-$BASE_RPC}; NETNAME=${NETNAME:-mainnet}
WETH=0x4200000000000000000000000000000000000006
DA=$(cast wallet address "$DEPLOYER_PK")
echo "network: $R (chain $(cast chain-id --rpc-url $R)) | deployer $DA | gas price $(cast gas-price --rpc-url $R) wei"
bc=$(python3 -c "import json;print(json.load(open('out/WalletIndexRouter.sol/WalletIndexRouter.json'))['bytecode']['object'])")
args=$(cast abi-encode 'c(address,address,address,string,string)' 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a $WETH "$DA" WalletIndex 1)
ROUTER=$(cast send --private-key "$DEPLOYER_PK" --rpc-url $R --json --create "${bc}${args:2}" | python3 -c "import sys,json;print(json.load(sys.stdin)['contractAddress'])")
echo "router $ROUTER"
BLK=$(cast block-number --rpc-url $R)
OUT=$(ROUTER=$ROUTER FLOAT_USDC=$FLOAT_USDC FLOAT_WETH=$FLOAT_WETH forge script script/Deploy.s.sol --rpc-url $R --broadcast --slow 2>&1)
echo "$OUT" | grep -q "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" || { echo "$OUT" | tail -30; exit 1; }
HOOK=$(echo "$OUT" | awk '/^  HOOK/{print $2}'); SWAPPER=$(echo "$OUT" | awk '/^  SWAPPER/{print $2}'); CURVE=$(echo "$OUT" | awk '/^  CURVE_ORDER/{print $2}')
cat > deployments/$NETNAME.json <<JSON
{"network":"$NETNAME","chainId":8453,"rpc":"$R","deployBlock":$BLK,"router":"$ROUTER","hook":"$HOOK","swapper":"$SWAPPER",
 "officialRouter":"0x111111338c5091E8440b67B168bAe16a668AC0De","aqua":"0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a",
 "feedEth":"0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70","feedBtc":"0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D","mirror":false,"maxAge":3600,"curveOrder":"$CURVE",
 "makers":[{"name":"alice","address":"$(cast wallet address $MAKER1_PK)","base":8,"targets":[3000,5000,2000]},
           {"name":"bob","address":"$(cast wallet address $MAKER2_PK)","base":10,"targets":[5000,3000,2000]},
           {"name":"carol","address":"$(cast wallet address $MAKER3_PK)","base":12,"targets":[7000,2000,1000]}],
 "trader":"$([ -n "${TRADER_PK:-}" ] && cast wallet address $TRADER_PK || echo "")"}
JSON
echo "hook $HOOK | swapper $SWAPPER -> deployments/$NETNAME.json (no keys written)"
echo "UI: python3 scripts/serve.py 8787, then open http://localhost:8787/?net=$NETNAME"
echo "run the agent:  set -a; source .env; set +a; NETWORK=$NETNAME python3 agent/agent.py"
