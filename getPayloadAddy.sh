#!/usr/bin/env bash

set -euo pipefail

# get the payload address for a given round, needs foundry cast
# resolves the current v5 proposer through Registry -> Rollup -> Slasher

# get round number from first arg
ROUND=${1:-0}

REGISTRY=${REGISTRY:-0x35b22e09Ee0390539439E24f06Da43D83f90e298}
RPC=${RPC:-https://eth.drpc.org}

rollup=$(cast call "$REGISTRY" "getCanonicalRollup()(address)" --rpc-url "$RPC")
slasher=$(cast call "$rollup" "getSlasher()(address)" --rpc-url "$RPC")
proposer=$(cast call "$slasher" "PROPOSER()(address)" --rpc-url "$RPC")

proposer_rollup=$(cast call "$proposer" "INSTANCE()(address)" --rpc-url "$RPC")
proposer_slasher=$(cast call "$proposer" "SLASHER()(address)" --rpc-url "$RPC")
[[ "${proposer_rollup,,}" == "${rollup,,}" ]] || { echo "Proposer INSTANCE mismatch" >&2; exit 1; }
[[ "${proposer_slasher,,}" == "${slasher,,}" ]] || { echo "Proposer SLASHER mismatch" >&2; exit 1; }

committees=$(
  cast call "$proposer" \
    "getSlashTargetCommittees(uint256)(address[][])" \
    "$ROUND" \
    --rpc-url "$RPC" \
  | tr -d ' \n'
)

tally_raw=$(
  cast call "$proposer" \
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
  cast call "$proposer" \
    "getPayloadAddress(uint256,(address,uint256)[])(address)" \
    "$ROUND" \
    "$tally" \
    --rpc-url "$RPC"
)

echo "tally:        $tally"
echo "payload addy: $payload"
