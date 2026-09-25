#!/usr/bin/env bash
# Starts a persistent local Base-mainnet fork, funds demo wallets from real on-chain holders, deploys WalletIndex
# with real transactions, then starts the agent and the UI. Everything keeps running until scripts/stop_local.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); RUN=$ROOT/.run; mkdir -p "$RUN" deployments
UPSTREAM=${BASE_RPC:-https://mainnet.base.org}
PORT=${FORK_PORT:-8545}; UI_PORT=${UI_PORT:-8787}; R=http://127.0.0.1:$PORT
MN="test test test test test test test test test test test junk"
pk() { cast wallet private-key --mnemonic "$MN" --mnemonic-index "$1"; }
DK=$(pk 0); M1=$(pk 1); M2=$(pk 2); M3=$(pk 3); TK=$(pk 4); UK=$(pk 5); CK=$(pk 6)
addr() { cast wallet address "$1"; }
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; WETH=0x4200000000000000000000000000000000000006; BTC=0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
PM=0x498581fF718922c3f8e6A244956aF099B2652b2b; LIVE_ETH=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70; LIVE_BTC=0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D

"$ROOT/scripts/stop_local.sh" >/dev/null 2>&1 || true
echo "1/6 starting local Base fork from $UPSTREAM on :$PORT"
nohup anvil --fork-url "$UPSTREAM" --port "$PORT" --auto-impersonate --silent > "$RUN/anvil.log" 2>&1 &
echo $! > "$RUN/anvil.pid"
for _ in $(seq 1 30); do cast block-number --rpc-url $R >/dev/null 2>&1 && break; sleep 1; done
FORK_BLOCK=$(cast block-number --rpc-url $R); echo "   fork at Base block $FORK_BLOCK"

echo "2/6 funding 5 wallets from real Base holders (Uniswap PoolManager balances)"
ETHPX=$(cast call $LIVE_ETH "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url $R | sed -n 2p | cut -d' ' -f1)
BTCPX=$(cast call $LIVE_BTC "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url $R | sed -n 2p | cut -d' ' -f1)
cast rpc anvil_setBalance $PM 0x56BC75E2D63100000 --rpc-url $R >/dev/null
fund() { # addr usdc6 ethWei btcSats pk
  cast send $USDC "transfer(address,uint256)" "$1" "$2" --from $PM --unlocked --rpc-url $R >/dev/null
  [ "$4" != 0 ] && cast send $BTC "transfer(address,uint256)" "$1" "$4" --from $PM --unlocked --rpc-url $R >/dev/null
  [ "$3" != 0 ] && cast send $WETH "deposit()" --value "$3" --private-key "$5" --rpc-url $R >/dev/null; true; }
MAKER_ETH=$(python3 -c "print(int(5000e6*1e20/$ETHPX))"); MAKER_BTC=$(python3 -c "print(int(2000e6*1e10/$BTCPX))")
fund "$(addr $DK)" 20000000000 5000000000000000000 0 "$DK"
for k in "$M1" "$M2" "$M3"; do fund "$(addr $k)" 3000000000 "$MAKER_ETH" "$MAKER_BTC" "$k"; done
fund "$(addr $TK)" 50000000000 10000000000000000000 0 "$TK"
fund "$(addr $UK)" 50000000000 10000000000000000000 0 "$UK"
fund "$(addr $CK)" 50000000000 10000000000000000000 0 "$CK"
cast send $USDC "approve(address,uint256)" 0x0000000000000000000000000000000000000000 0 --private-key "$TK" --rpc-url $R >/dev/null 2>&1 || true

echo "3/6 deploying MirrorFeeds (fork only) seeded with the live Chainlink answers"
create() { local bc=$(python3 -c "import json;print(json.load(open('out/$1.sol/$1.json'))['bytecode']['object'])"); cast send --private-key "$DK" --rpc-url $R --json --create "${bc}${2:2}" | python3 -c "import sys,json;print(json.load(sys.stdin)['contractAddress'])"; }
FEED_ETH=$(create MirrorFeed "$(cast abi-encode 'c(address,string,int256)' "$(addr $DK)" 'ETH / USD (mirror of live Chainlink)' "$ETHPX")")
FEED_BTC=$(create MirrorFeed "$(cast abi-encode 'c(address,string,int256)' "$(addr $DK)" 'BTC / USD (mirror of live Chainlink)' "$BTCPX")")

echo "4/6 deploying WalletIndexRouter (official Aqua opcodes + native portfolio-skew instruction)"
ROUTER=$(create WalletIndexRouter "$(cast abi-encode 'c(address,address,address,string,string)' 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a $WETH "$(addr $DK)" WalletIndex 1)")

echo "5/6 deploying hook (mined CREATE2 address), pool, and listing 3 maker baskets + 1 official curve"
OUT=$(ROUTER=$ROUTER FEED_ETH=$FEED_ETH FEED_BTC=$FEED_BTC MAX_AGE=3600 FLOAT_USDC=5000000000 FLOAT_WETH=2000000000000000000 \
      DEPLOYER_PK=$DK MAKER1_PK=$M1 MAKER2_PK=$M2 MAKER3_PK=$M3 forge script script/Deploy.s.sol --rpc-url $R --broadcast --slow 2>&1)
echo "$OUT" | grep -q "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" || { echo "$OUT" | tail -30; exit 1; }
HOOK=$(echo "$OUT" | awk '/^  HOOK/{print $2}'); SWAPPER=$(echo "$OUT" | awk '/^  SWAPPER/{print $2}'); CURVE=$(echo "$OUT" | awk '/^  CURVE_ORDER/{print $2}')
cast send $USDC "approve(address,uint256)" "$SWAPPER" "$(cast max-uint)" --private-key "$TK" --rpc-url $R >/dev/null
cast send $WETH "approve(address,uint256)" "$SWAPPER" "$(cast max-uint)" --private-key "$TK" --rpc-url $R >/dev/null
cast send $USDC "approve(address,uint256)" 0x111111338c5091E8440b67B168bAe16a668AC0De "$(cast max-uint)" --private-key "$TK" --rpc-url $R >/dev/null
for a in "$SWAPPER" 0x111111338c5091E8440b67B168bAe16a668AC0De; do for t in $USDC $WETH; do cast send $t "approve(address,uint256)" "$a" "$(cast max-uint)" --private-key "$UK" --rpc-url $R >/dev/null; cast send $t "approve(address,uint256)" "$a" "$(cast max-uint)" --private-key "$CK" --rpc-url $R >/dev/null; done; done
cat > deployments/local.json <<JSON
{"network":"local","chainId":8453,"rpc":"$R","deployBlock":$((FORK_BLOCK+1)),"router":"$ROUTER","hook":"$HOOK","swapper":"$SWAPPER",
 "officialRouter":"0x111111338c5091E8440b67B168bAe16a668AC0De","aqua":"0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a",
 "feedEth":"$FEED_ETH","feedBtc":"$FEED_BTC","mirror":true,"maxAge":3600,"curveOrder":"$CURVE",
 "makers":[{"name":"alice","address":"$(addr $M1)","base":8,"targets":[3000,5000,2000]},
           {"name":"bob","address":"$(addr $M2)","base":10,"targets":[5000,3000,2000]},
           {"name":"carol","address":"$(addr $M3)","base":12,"targets":[7000,2000,1000]}],
 "trader":"$(addr $TK)", "uiTrader":"$(addr $UK)", "cliTrader":"$(addr $CK)",
 "keys":{"deployer":"$DK","makers":["$M1","$M2","$M3"],"trader":"$TK","ui":"$UK","cli":"$CK"}}
JSON
rm -f deployments/local.state.json
echo "   router $ROUTER | hook $HOOK | swapper $SWAPPER"

echo "6/6 starting agent (every ${INTERVAL:-30}s) and UI"
NETWORK=local INTERVAL=${INTERVAL:-30} nohup python3 agent/agent.py > "$RUN/agent.log" 2>&1 &
echo $! > "$RUN/agent.pid"
nohup python3 scripts/serve.py "$UI_PORT" > "$RUN/ui.log" 2>&1 &
echo $! > "$RUN/ui.pid"
echo
echo "READY. UI: http://localhost:$UI_PORT/   |   fork RPC: $R   |   agent log: $RUN/agent.log"
echo "Stop everything with: ./scripts/stop_local.sh"
