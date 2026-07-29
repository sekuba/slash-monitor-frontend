#!/usr/bin/env bash

set -Eeuo pipefail

readonly system_node='/usr/local/bin/node'

if (( $# != 1 )) || [[ "$1" != '--fresh' && "$1" != '--upgrade' && "$1" != '--reset-db' && "$1" != '--parallel' ]]; then
  cat <<'EOF'
Usage: scripts/deploy-backend.sh --fresh
       scripts/deploy-backend.sh --upgrade
       scripts/deploy-backend.sh --reset-db
       scripts/deploy-backend.sh --parallel

Deploy the checked-out Slashmon backend from a clean commit.

--fresh permanently deletes:
  /var/lib/slashmon
  /var/backups/slashmon

--upgrade verifies and backs up the current database, installs an immutable
release, and preserves all state and earlier releases.

--reset-db verifies and backs up the current database, installs an immutable
release, then removes only the live database. Watches, monitor history, and
delivery state start empty; the timestamped backup and earlier releases remain.

--parallel installs an isolated, disposable testing backend on loopback port
8791. It resets only /var/lib/slashmon-testing and never stops, changes, or
reads the live service, database, environment, current link, or release tree.

All modes reduce their selected environment file to settings supported by the
current backend. Run this from a clean checkout as its normal owner, not root.
EOF
  exit 2
fi

readonly mode="$1"
if [[ "$mode" == '--parallel' ]]; then
  service='slashmon-backend-testing.service'
  environment_file='/etc/slashmon-backend-testing.env'
  release_root='/opt/slashmon-testing/releases'
  current_link='/opt/slashmon-testing/current'
  database='/var/lib/slashmon-testing/slashmon.sqlite'
  backup_root='/var/backups/slashmon-testing'
  service_definition='slashmon-backend-testing.service'
else
  service='slashmon-backend.service'
  environment_file='/etc/slashmon-backend.env'
  release_root='/opt/slashmon/releases'
  current_link='/opt/slashmon/current'
  database='/var/lib/slashmon/slashmon.sqlite'
  backup_root='/var/backups/slashmon'
  service_definition='slashmon-backend.service'
fi
readonly service environment_file release_root current_link database backup_root service_definition

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
  if [[ "$mode" == '--parallel' ]]; then
    echo "$environment_file is missing. Install and fill collector/deploy/slashmon-backend-testing.env.example first." >&2
  else
    echo "$environment_file is missing. Install and fill collector/deploy/slashmon-backend.env.example first." >&2
  fi
  exit 1
fi
if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  if ! sudo systemctl cat "$service" >/dev/null 2>&1; then
    echo "$service is not installed; use --fresh for the first deployment." >&2
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
  BACKEND_READ_RATE_LIMIT_MAX_PER_MINUTE
  BACKEND_READ_RATE_LIMIT_MAX_PER_MINUTE_GLOBAL
  BACKEND_MUTATION_RATE_LIMIT_MAX_PER_MINUTE
  BACKEND_WATCHLIST_MUTATION_RATE_LIMIT_MAX_PER_MINUTE
  BACKEND_WATCHLIST_CREATE_MAX_PER_HOUR_PER_IP
  BACKEND_WATCHLIST_CREATE_MAX_PER_DAY_PER_IP
  BACKEND_WATCHLIST_CREATE_MAX_PER_HOUR_GLOBAL
  BACKEND_WATCHLIST_CREATE_MAX_PER_DAY_GLOBAL
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
declare -A supported_settings=()
for key in "${environment_order[@]}"; do
  supported_settings["$key"]=true
done

declare -A settings=()
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    if [[ -n "${supported_settings[$key]+present}" ]]; then
      settings["$key"]="${BASH_REMATCH[2]}"
    fi
  fi
done < <(sudo cat -- "$environment_file")

settings[SLASHMON_NETWORK]="${settings[SLASHMON_NETWORK]:-mainnet}"
settings[BACKEND_TRUST_PROXY]="${settings[BACKEND_TRUST_PROXY]:-false}"
settings[BACKEND_LOG_LEVEL]="${settings[BACKEND_LOG_LEVEL]:-info}"
if [[ "$mode" == '--parallel' ]]; then
  # These deployment-owned values keep the testing instance loopback-only and
  # prevent a copied production environment from colliding with the live API.
  settings[BACKEND_BIND_HOST]='127.0.0.1'
  settings[BACKEND_PORT]='8791'
  settings[BACKEND_TRUST_PROXY]='false'
fi

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
    "collector/deploy/$service_definition" \
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

echo "Stopping $service..."
if [[ "$mode" == '--upgrade' || "$mode" == '--reset-db' ]]; then
  sudo systemctl stop "$service"
elif sudo systemctl cat "$service" >/dev/null 2>&1; then
  sudo systemctl stop "$service"
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
elif [[ "$mode" == '--parallel' ]]; then
  echo 'Resetting only the isolated Slashmon testing state...'
else
  echo 'Permanently removing Slashmon state...'
fi

sudo install -o root -g root -m 0600 "$environment_tmp" "$environment_file"
sudo install -m 0644 \
  "$release_path/collector/deploy/$service_definition" \
  "/etc/systemd/system/$service"
sudo systemctl daemon-reload

if [[ "$mode" == '--fresh' || "$mode" == '--parallel' ]]; then
  sudo systemctl clean --what=state "$service"
fi
if [[ "$mode" == '--fresh' ]]; then
  sudo rm -rf -- "$backup_root"
fi

sudo ln -sfn "$release_path" "$current_link"
sudo systemctl enable --now "$service"

backend_ready() {
  "$system_node" --input-type=module --eval "
    const baseUrl = process.argv[1];
    try {
      const [statusResponse, monitorResponse] = await Promise.all([
        fetch(baseUrl + '/api/status', { signal: AbortSignal.timeout(5_000) }),
        fetch(baseUrl + '/api/monitor', { signal: AbortSignal.timeout(5_000) }),
      ]);
      if (!statusResponse.ok || !monitorResponse.ok) process.exit(1);
      const [status, monitor] = await Promise.all([
        statusResponse.json(),
        monitorResponse.json(),
      ]);
      const ready =
        status.status === 'healthy' &&
        status.sources?.node?.status === 'healthy' &&
        status.sources?.l1?.status === 'healthy' &&
        monitor.network === status.network &&
        monitor.protocol !== null &&
        monitor.coverage?.cases?.complete === true &&
        monitor.coverage?.slashes?.complete === true;
      process.exit(ready ? 0 : 1);
    } catch {
      process.exit(1);
    }
  " "$local_api"
}

ready=false
for _attempt in {1..120}; do
  if backend_ready; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  echo 'The new backend did not become healthy with complete case and slash coverage. No automatic rollback is available.' >&2
  sudo systemctl status "$service" --no-pager >&2 || true
  sudo journalctl -u "$service" --since '10 minutes ago' --no-pager >&2 || true
  exit 1
fi

if [[ "$mode" == '--upgrade' ]]; then
  echo "Slashmon backend $revision is live. Database backup: $backup_path"
elif [[ "$mode" == '--reset-db' ]]; then
  echo "Slashmon backend $revision is live with a reset database. Previous database: $backup_path"
elif [[ "$mode" == '--parallel' ]]; then
  echo "Slashmon testing backend $revision is ready at $local_api with a fresh isolated database."
else
  echo "Slashmon backend $revision is live with a fresh database."
fi
curl --fail --silent "$local_api/api/status"
echo
curl --fail --silent "$local_api/api/monitor"
echo
