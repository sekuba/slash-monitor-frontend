#!/usr/bin/env bash

set -euo pipefail

# get the payload address for a given round, needs foundry cast

# get round number from first arg
ROUND=${1:-0}

ADDR=${ADDR:-0xa4a38fD0108C00983E75616b638Ff3321FD26958}
RPC=${RPC:-https://eth.drpc.org}

committees=$(
  cast call "$ADDR" \
    "getSlashTargetCommittees(uint256)(address[][])" \
    "$ROUND" \
    --rpc-url "$RPC" \
  | tr -d ' \n'
)

tally_raw=$(
  cast call "$ADDR" \
    "getTally(uint256,address[][])((address,uint256)[])" \
    "$ROUND" \
    "$committees" \
    --rpc-url "$RPC"
)

tally=$(
  echo "$tally_raw" \
  | sed 's/ \[[^]]*\]//g' \
  | tr -d ' \n'
)

payload=$(
  cast call "$ADDR" \
    "getPayloadAddress(uint256,(address,uint256)[])(address)" \
    "$ROUND" \
    "$tally" \
    --rpc-url "$RPC"
)

echo "tally:        $tally"
echo "payload addy: $payload"
