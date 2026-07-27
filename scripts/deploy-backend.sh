#!/usr/bin/env bash

set -Eeuo pipefail

readonly new_service='slashmon-backend.service'
readonly old_service='slashmon-offense-collector.service'
readonly environment_file='/etc/slashmon-backend.env'
readonly release_root='/opt/slashmon/releases'
readonly current_link='/opt/slashmon/current'
readonly system_node='/usr/local/bin/node'
readonly database='/var/lib/slashmon/slashmon.sqlite'
readonly backup_root='/var/backups/slashmon'

if (( $# != 1 )) || [[ "$1" != '--fresh' && "$1" != '--upgrade' && "$1" != '--reset-db' ]]; then
  cat <<'EOF'
Usage: scripts/deploy-backend.sh --fresh
       scripts/deploy-backend.sh --upgrade
       scripts/deploy-backend.sh --reset-db

Deploy the checked-out Slashmon backend from a clean commit.

--fresh permanently deletes:
  /var/lib/slashmon
  /var/lib/private/slashmon
  /var/lib/slashmon-offense-collector
  /var/lib/private/slashmon-offense-collector
  /var/backups/slashmon

--upgrade verifies and backs up the current database, installs an immutable
release, and preserves all state and earlier releases.

--reset-db verifies and backs up the current database, installs an immutable
release, then removes only the live database. Watches, event history, and
delivery state start empty; the timestamped backup and earlier releases remain.

All modes reduce /etc/slashmon-backend.env to settings supported by the
current backend. Run this from a clean checkout as its normal owner, not root.
EOF
  exit 2
fi

readonly mode="$1"

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
if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  require_command date
fi

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
if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  if ! sudo systemctl cat "$new_service" >/dev/null 2>&1; then
    echo "$new_service is not installed; use --fresh for the first deployment." >&2
    exit 1
  fi
  if ! sudo test -f "$database"; then
    echo "$database is missing; refusing $mode without persistent state." >&2
    exit 1
  fi
fi

staging_root="$(mktemp -d /tmp/slashmon-deploy.XXXXXX)"
environment_tmp="$(mktemp /tmp/slashmon-environment.XXXXXX)"
cleanup() {
  if [[ -n "${staging_root:-}" && "$staging_root" == /tmp/slashmon-deploy.* ]]; then
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
      AZTEC_SENTINEL_POLL_INTERVAL_MS|AZTEC_SENTINEL_LOOKBACK_EPOCHS|\
      AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS|\
      AZTEC_SENTINEL_VALIDATOR_CONCURRENCY|AZTEC_SENTINEL_VALIDATOR_MAX_RESPONSE_BYTES|\
      L1_RPC_URL|L1_REGISTRY_ADDRESS|L1_SLASH_LOG_LOOKBACK_BLOCKS|\
      TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_USERNAME|\
      VAPID_SUBJECT|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|\
      BACKEND_BIND_HOST|BACKEND_PORT|BACKEND_TRUST_PROXY|BACKEND_LOG_LEVEL|\
      BACKEND_READ_RATE_LIMIT_MAX_PER_MINUTE|\
      BACKEND_READ_RATE_LIMIT_MAX_PER_MINUTE_GLOBAL|\
      BACKEND_MUTATION_RATE_LIMIT_MAX_PER_MINUTE|\
      BACKEND_WATCHLIST_MUTATION_RATE_LIMIT_MAX_PER_MINUTE|\
      BACKEND_SUBSCRIPTION_CREATE_MAX_PER_HOUR_PER_IP|\
      BACKEND_SUBSCRIPTION_CREATE_MAX_PER_DAY_PER_IP|\
      BACKEND_SUBSCRIPTION_CREATE_MAX_PER_HOUR_GLOBAL|\
      BACKEND_SUBSCRIPTION_CREATE_MAX_PER_DAY_GLOBAL|\
      BACKEND_NOTIFICATION_TEST_COOLDOWN_MS|\
      BACKEND_NOTIFICATION_TEST_MAX_PER_HOUR_GLOBAL|\
      BACKEND_NOTIFICATION_TEST_MAX_PER_DAY_GLOBAL|\
      BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_HOUR_PER_WATCHLIST|\
      BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_DAY_PER_WATCHLIST|\
      BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_HOUR_GLOBAL|\
      BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_DAY_GLOBAL|\
      TELEGRAM_SEND_MAX_PER_SECOND|TELEGRAM_LOW_PRIORITY_SEND_MAX_PER_SECOND|\
      TELEGRAM_CHAT_SEND_INTERVAL_MS)
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
  AZTEC_SENTINEL_POLL_INTERVAL_MS
  AZTEC_SENTINEL_LOOKBACK_EPOCHS
  AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS
  AZTEC_SENTINEL_VALIDATOR_CONCURRENCY
  AZTEC_SENTINEL_VALIDATOR_MAX_RESPONSE_BYTES
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
  BACKEND_READ_RATE_LIMIT_MAX_PER_MINUTE
  BACKEND_READ_RATE_LIMIT_MAX_PER_MINUTE_GLOBAL
  BACKEND_MUTATION_RATE_LIMIT_MAX_PER_MINUTE
  BACKEND_WATCHLIST_MUTATION_RATE_LIMIT_MAX_PER_MINUTE
  BACKEND_SUBSCRIPTION_CREATE_MAX_PER_HOUR_PER_IP
  BACKEND_SUBSCRIPTION_CREATE_MAX_PER_DAY_PER_IP
  BACKEND_SUBSCRIPTION_CREATE_MAX_PER_HOUR_GLOBAL
  BACKEND_SUBSCRIPTION_CREATE_MAX_PER_DAY_GLOBAL
  BACKEND_NOTIFICATION_TEST_COOLDOWN_MS
  BACKEND_NOTIFICATION_TEST_MAX_PER_HOUR_GLOBAL
  BACKEND_NOTIFICATION_TEST_MAX_PER_DAY_GLOBAL
  BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_HOUR_PER_WATCHLIST
  BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_DAY_PER_WATCHLIST
  BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_HOUR_GLOBAL
  BACKEND_WEB_PUSH_ENROLLMENT_MAX_PER_DAY_GLOBAL
  TELEGRAM_SEND_MAX_PER_SECOND
  TELEGRAM_LOW_PRIORITY_SEND_MAX_PER_SECOND
  TELEGRAM_CHAT_SEND_INTERVAL_MS
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
      echo 'Remove that release directory and run the deployment again.' >&2
      exit 1
    fi
  done
else
  sudo install -d -m 0755 "$release_path"
  sudo cp -a --no-preserve=ownership "$staging_release/." "$release_path/"
fi

backup_path=''
if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  backup_path="$backup_root/slashmon-$(date -u +%Y%m%dT%H%M%SZ)-before-$revision.sqlite"
  sudo install -d -o root -g root -m 0700 "$backup_root"
  if sudo test -e "$backup_path"; then
    echo "Backup already exists: $backup_path" >&2
    exit 1
  fi
fi

echo "Stopping $new_service..."
if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  sudo systemctl stop "$new_service"
elif sudo systemctl cat "$new_service" >/dev/null 2>&1; then
  sudo systemctl stop "$new_service"
fi

if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  echo 'Checking and backing up the database...'
  database_check="$(
    sudo "$system_node" --input-type=module --eval "
      import { DatabaseSync } from 'node:sqlite';
      const connection = new DatabaseSync('$database');
      connection.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const result = connection.prepare('PRAGMA quick_check').get();
      connection.close();
      process.stdout.write(String(result.quick_check));
    "
  )"
  if [[ "$database_check" != 'ok' ]]; then
    echo "SQLite quick check failed: $database_check" >&2
    exit 1
  fi
  sudo install -o root -g root -m 0600 "$database" "$backup_path"
  if [[ "$mode" == '--reset-db' ]]; then
    echo "Resetting the live database; backup retained at $backup_path"
    sudo rm -f -- "$database" "${database}-wal" "${database}-shm"
  fi
else
  echo 'Permanently removing Slashmon state...'
  if sudo systemctl cat "$old_service" >/dev/null 2>&1; then
    sudo systemctl stop "$old_service"
    sudo systemctl disable "$old_service" >/dev/null 2>&1 || true
  fi
fi

sudo install -o root -g root -m 0600 "$environment_tmp" "$environment_file"
sudo install -m 0644 \
  "$release_path/collector/deploy/slashmon-backend.service" \
  "/etc/systemd/system/$new_service"
if [[ "$mode" == '--fresh' ]]; then
  sudo rm -f -- "/etc/systemd/system/$old_service"
fi
sudo systemctl daemon-reload

if [[ "$mode" == '--fresh' ]]; then
  state_paths=(
    /var/lib/slashmon
    /var/lib/private/slashmon
    /var/lib/slashmon-offense-collector
    /var/lib/private/slashmon-offense-collector
    "$backup_root"
  )
  for state_path in "${state_paths[@]}"; do
    sudo rm -rf -- "$state_path"
  done
fi

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

if [[ "$mode" == '--upgrade' ]]; then
  echo "Slashmon backend $revision is live. Database backup: $backup_path"
elif [[ "$mode" == '--reset-db' ]]; then
  echo "Slashmon backend $revision is live with a reset database. Previous database: $backup_path"
else
  echo "Slashmon backend $revision is live with a fresh database."
fi
curl --fail --silent "$local_api/live"
echo
curl --silent "$local_api/health"
echo
