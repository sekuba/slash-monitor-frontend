#!/usr/bin/env bash

set -euo pipefail

# get the payload address for a given round, needs foundry cast
ROUND=61

ADDR=0x7a318c3DaA9f21f8fc8238c65755eB0394Fbf189
RPC=https://eth.drpc.org

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

echo "$payload"
