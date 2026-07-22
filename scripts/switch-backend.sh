#!/usr/bin/env bash

set -Eeuo pipefail

readonly new_service='slashmon-backend.service'
readonly old_service='slashmon-offense-collector.service'
readonly environment_file='/etc/slashmon-backend.env'
readonly release_root='/opt/slashmon/releases'
readonly current_link='/opt/slashmon/current'
readonly system_node='/usr/local/bin/node'

if [[ "${1:-}" != '--fresh' || $# -ne 1 ]]; then
  cat <<'EOF'
Usage: scripts/switch-backend.sh --fresh

Install the checked-out Slashmon backend as a clean, incompatible release.

This permanently deletes:
  /var/lib/slashmon
  /var/lib/private/slashmon
  /var/lib/slashmon-offense-collector
  /var/lib/private/slashmon-offense-collector
  /var/backups/slashmon

No database backup or rollback release is created. The existing
/etc/slashmon-backend.env is reduced to the settings supported by the new
backend. Run this from a clean checkout as its normal owner, not as root.
EOF
  exit 2
fi

if (( EUID == 0 )); then
  echo 'Run this as the checkout owner, not as root; the script uses sudo where needed.' >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

for command_name in git sudo tar node pnpm curl env mktemp systemctl; do
  require_command "$command_name"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd -- "$repo_root"

if [[ "$(git rev-parse --show-toplevel)" != "$repo_root" ]]; then
  echo "The script must remain inside the Slashmon repository: $repo_root" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'The checkout must be clean so the release exactly matches its commit.' >&2
  git status --short >&2
  exit 1
fi
if [[ ! -x "$system_node" ]]; then
  echo "Node 24 is required at $system_node." >&2
  exit 1
fi

user_node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
system_node_major="$("$system_node" --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$user_node_major" =~ ^[0-9]+$ ]] || (( user_node_major < 24 )); then
  echo "The checkout shell needs Node 24; found $(node --version)." >&2
  exit 1
fi
if [[ ! "$system_node_major" =~ ^[0-9]+$ ]] || (( system_node_major < 24 )); then
  echo "$system_node must be Node 24 or newer; found $("$system_node" --version)." >&2
  exit 1
fi

sudo -v
if ! sudo test -f "$environment_file"; then
  echo "$environment_file is missing. Install and fill collector/deploy/slashmon-backend.env.example first." >&2
  exit 1
fi

staging_root="$(mktemp -d /tmp/slashmon-switch.XXXXXX)"
environment_tmp="$(mktemp /tmp/slashmon-environment.XXXXXX)"
cleanup() {
  if [[ -n "${staging_root:-}" && "$staging_root" == /tmp/slashmon-switch.* ]]; then
    rm -rf -- "$staging_root"
  fi
  if [[ -n "${environment_tmp:-}" && "$environment_tmp" == /tmp/slashmon-environment.* ]]; then
    rm -f -- "$environment_tmp"
  fi
}
trap cleanup EXIT

declare -A settings=()
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      COLLECTOR_CORS_ORIGIN) key='BACKEND_CORS_ORIGIN' ;;
      COLLECTOR_BIND_HOST) key='BACKEND_BIND_HOST' ;;
      COLLECTOR_PORT) key='BACKEND_PORT' ;;
      API_TRUST_LOOPBACK_PROXY) key='BACKEND_TRUST_PROXY' ;;
      COLLECTOR_LOG_LEVEL) key='BACKEND_LOG_LEVEL' ;;
    esac
    case "$key" in
      SLASHMON_NETWORK|SLASHMON_PUBLIC_URL|BACKEND_CORS_ORIGIN|\
      AZTEC_NODE_URL|AZTEC_NODE_API_KEY|AZTEC_ADMIN_URL|AZTEC_ADMIN_API_KEY|\
      L1_RPC_URL|L1_REGISTRY_ADDRESS|L1_SLASH_LOG_LOOKBACK_BLOCKS|\
      TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_USERNAME|\
      VAPID_SUBJECT|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|\
      BACKEND_BIND_HOST|BACKEND_PORT|BACKEND_TRUST_PROXY|BACKEND_LOG_LEVEL)
        settings["$key"]="$value"
        ;;
    esac
  fi
done < <(sudo cat -- "$environment_file")

settings[SLASHMON_NETWORK]="${settings[SLASHMON_NETWORK]:-mainnet}"
settings[BACKEND_TRUST_PROXY]="${settings[BACKEND_TRUST_PROXY]:-false}"
settings[BACKEND_LOG_LEVEL]="${settings[BACKEND_LOG_LEVEL]:-info}"

required_settings=(
  SLASHMON_PUBLIC_URL
  BACKEND_CORS_ORIGIN
  AZTEC_NODE_URL
  AZTEC_ADMIN_URL
  L1_RPC_URL
)
for key in "${required_settings[@]}"; do
  if [[ -z "${settings[$key]:-}" ]]; then
    echo "$environment_file does not contain a usable $key value." >&2
    exit 1
  fi
done

environment_order=(
  SLASHMON_NETWORK
  SLASHMON_PUBLIC_URL
  BACKEND_CORS_ORIGIN
  AZTEC_NODE_URL
  AZTEC_NODE_API_KEY
  AZTEC_ADMIN_URL
  AZTEC_ADMIN_API_KEY
  L1_RPC_URL
  L1_REGISTRY_ADDRESS
  L1_SLASH_LOG_LOOKBACK_BLOCKS
  TELEGRAM_BOT_TOKEN
  TELEGRAM_BOT_USERNAME
  VAPID_SUBJECT
  VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY
  BACKEND_BIND_HOST
  BACKEND_PORT
  BACKEND_TRUST_PROXY
  BACKEND_LOG_LEVEL
)
for key in "${environment_order[@]}"; do
  if [[ -n "${settings[$key]+present}" ]]; then
    printf '%s=%s\n' "$key" "${settings[$key]}" >> "$environment_tmp"
  fi
done

revision="$(git rev-parse --short=12 HEAD)"
release_path="$release_root/$revision"
staging_release="$staging_root/$revision"
mkdir -m 0755 "$staging_release"

echo "Preparing backend release $revision..."
git archive HEAD | tar -x -C "$staging_release"
local_api="$(
  cd -- "$staging_release/collector"
  env -i PATH="$PATH" "$system_node" \
    --env-file="$environment_tmp" \
    --input-type=module \
    --eval "
      import { loadConfig } from './src/config.mjs';
      const config = loadConfig();
      let host = config.bindHost;
      if (host === '0.0.0.0') host = '127.0.0.1';
      if (host === '::') host = '::1';
      if (host.includes(':') && !host.startsWith('[')) host = '[' + host + ']';
      process.stdout.write('http://' + host + ':' + config.port);
    "
)"
readonly local_api
pnpm --dir "$staging_release" install --prod --frozen-lockfile

if sudo test -d "$release_path"; then
  for release_file in \
    collector/deploy/slashmon-backend.service \
    collector/src/main.mjs \
    collector/node_modules/web-push/package.json; do
    if ! sudo test -f "$release_path/$release_file"; then
      echo "Existing release is incomplete: $release_path" >&2
      echo 'Remove that release directory and run the switch again.' >&2
      exit 1
    fi
  done
else
  sudo install -d -m 0755 "$release_path"
  sudo cp -a --no-preserve=ownership "$staging_release/." "$release_path/"
fi
echo 'Stopping old writers and permanently removing Slashmon state...'
if sudo systemctl cat "$new_service" >/dev/null 2>&1; then
  sudo systemctl stop "$new_service"
fi
if sudo systemctl cat "$old_service" >/dev/null 2>&1; then
  sudo systemctl stop "$old_service"
  sudo systemctl disable "$old_service" >/dev/null 2>&1 || true
fi

sudo install -o root -g root -m 0600 "$environment_tmp" "$environment_file"
sudo install -m 0644 \
  "$release_path/collector/deploy/slashmon-backend.service" \
  "/etc/systemd/system/$new_service"
sudo rm -f -- "/etc/systemd/system/$old_service"
sudo systemctl daemon-reload

state_paths=(
  /var/lib/slashmon
  /var/lib/private/slashmon
  /var/lib/slashmon-offense-collector
  /var/lib/private/slashmon-offense-collector
  /var/backups/slashmon
)
for state_path in "${state_paths[@]}"; do
  sudo rm -rf -- "$state_path"
done

sudo ln -sfn "$release_path" "$current_link"
sudo systemctl enable --now "$new_service"

live=false
for _attempt in {1..30}; do
  if curl --fail --silent "$local_api/live" >/dev/null; then
    live=true
    break
  fi
  sleep 1
done

if [[ "$live" != true ]]; then
  echo 'The new backend did not become live. No automatic rollback is available.' >&2
  sudo systemctl status "$new_service" --no-pager >&2 || true
  sudo journalctl -u "$new_service" --since '10 minutes ago' --no-pager >&2 || true
  exit 1
fi

echo "Slashmon backend $revision is live with a fresh database."
curl --fail --silent "$local_api/live"
echo
curl --silent "$local_api/health"
echo
