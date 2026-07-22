#!/usr/bin/env bash

set -Eeuo pipefail

readonly service_name='slashmon-backend.service'
readonly release_root='/opt/slashmon/releases'
readonly current_link='/opt/slashmon/current'
readonly database_path='/var/lib/slashmon-offense-collector/offenses.sqlite'
readonly backup_root='/var/backups/slashmon'
readonly local_api='http://127.0.0.1:8790'
readonly system_node='/usr/local/bin/node'

pull_latest=true
case "${1:-}" in
  '') ;;
  --no-pull) pull_latest=false ;;
  -h|--help)
    cat <<'EOF'
Usage: scripts/update-backend.sh [--no-pull]

Build and activate an immutable Slashmon backend release on the production
Ubuntu host. Run this as the checkout owner, not as root. The script uses sudo
for /opt, database backup, and systemd operations. Dependency installation uses
the current user's node and pnpm, including installations managed by fnm.

  --no-pull  Deploy the currently checked-out commit without running git pull.

This is a backend-only updater. It does not build dist/ for a self-hosted PWA.
EOF
    exit 0
    ;;
  *)
    echo "Unknown argument: $1" >&2
    echo 'Run with --help for usage.' >&2
    exit 2
    ;;
esac

if (( EUID == 0 )); then
  echo 'Run this script as the checkout owner, not as root; it will use sudo when needed.' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

for required_command in git sudo tar curl systemctl node pnpm mktemp; do
  require_command "$required_command"
done

install_node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$install_node_major" =~ ^[0-9]+$ ]] || (( install_node_major < 24 )); then
  echo "Node 24 or newer is required in the current fnm shell; found $(node --version)." >&2
  exit 1
fi

if [[ ! -x "$system_node" ]]; then
  echo "$system_node is missing; the systemd unit requires a system-wide Node 24 installation." >&2
  exit 1
fi

node_major="$("$system_node" --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 24 )); then
  echo "Node 24 or newer is required at $system_node; found $("$system_node" --version)." >&2
  exit 1
fi

cd -- "$repo_root"
if [[ "$(git rev-parse --show-toplevel)" != "$repo_root" ]]; then
  echo "The script must live inside the Slashmon repository: $repo_root" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'The checkout has uncommitted changes. Commit or stash them before deploying.' >&2
  git status --short >&2
  exit 1
fi

sudo -v

if [[ "$pull_latest" == true ]]; then
  current_branch="$(git symbolic-ref --quiet --short HEAD || true)"
  if [[ -z "$current_branch" ]]; then
    echo 'The checkout is detached. Use --no-pull to deploy this exact commit.' >&2
    exit 1
  fi
  echo "Updating $current_branch with a fast-forward-only pull..."
  git pull --ff-only
  echo 'Re-running the updater from the checked-out revision...'
  exec "$repo_root/scripts/update-backend.sh" --no-pull
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'The checkout became dirty after updating; refusing to create a release.' >&2
  git status --short >&2
  exit 1
fi

revision="$(git rev-parse --short=12 HEAD)"
release_path="$release_root/$revision"

if sudo test -e "$release_path"; then
  if sudo test -e "$current_link" && sudo test "$current_link" -ef "$release_path"; then
    echo "Revision $revision is already deployed at $current_link."
    curl --fail --silent "$local_api/live"
    echo
    exit 0
  fi
  echo "Release already exists: $release_path" >&2
  echo 'Refusing to overwrite an immutable release.' >&2
  exit 1
fi

if sudo test -e "$current_link" && ! sudo test -L "$current_link"; then
  echo "$current_link exists but is not a symlink; refusing to replace it." >&2
  exit 1
fi

if sudo test -f "$current_link/dist/index.html"; then
  echo 'The current release contains a self-hosted PWA build.' >&2
  echo 'This backend-only updater would omit dist/. Use the full release procedure in docs/runbook.md.' >&2
  exit 1
fi

if ! sudo systemctl cat "$service_name" >/dev/null 2>&1; then
  echo "$service_name is not installed. Complete the first deployment in docs/runbook.md." >&2
  exit 1
fi

if sudo test -f "$database_path"; then
  require_command sqlite3
fi

echo 'Building the release with the current user node/pnpm...'
staging_root="$(mktemp -d /tmp/slashmon-backend-release.XXXXXX)"
staging_release="$staging_root/$revision"
mkdir -m 0755 "$staging_release"

cleanup_staging() {
  if [[ -n "${staging_root:-}" && -d "$staging_root" \
    && "$staging_root" == /tmp/slashmon-backend-release.* ]]; then
    rm -rf -- "$staging_root"
  fi
}
trap cleanup_staging EXIT

git archive HEAD | tar -x -C "$staging_release"
pnpm --dir "$staging_release" install --prod --frozen-lockfile

echo "Installing immutable release $release_path..."
sudo install -d -m 0755 "$release_root" "$release_path"
# Copy instead of moving/chowning pnpm's tree: its package files may be hard
# links into the invoking user's store, whose ownership must remain untouched.
sudo cp -a --no-preserve=ownership "$staging_release/." "$release_path/"
cleanup_staging
staging_root=''
trap - EXIT

echo "Installing the systemd unit for $system_node..."
sudo install -m 0644 \
  "$release_path/collector/deploy/slashmon-backend.service" \
  "/etc/systemd/system/$service_name"
sudo systemctl daemon-reload

service_was_active=false
service_stopped=false
release_switched=false
if sudo systemctl is-active --quiet "$service_name"; then
  service_was_active=true
fi

restore_service_on_early_failure() {
  exit_status=$?
  trap - EXIT
  if (( exit_status != 0 )) && [[ "$service_was_active" == true ]] \
    && [[ "$service_stopped" == true ]] && [[ "$release_switched" == false ]]; then
    echo 'Deployment failed before the release switch; restarting the previous release.' >&2
    sudo systemctl start "$service_name" || true
  fi
  exit "$exit_status"
}
trap restore_service_on_early_failure EXIT

echo "Stopping $service_name..."
sudo systemctl stop "$service_name"
service_stopped=true

if sudo test -f "$database_path"; then
  backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_path="$backup_root/offenses-$revision-$backup_stamp.sqlite"
  echo "Checkpointing and backing up SQLite to $backup_path..."
  sudo install -d -m 0700 "$backup_root"
  sudo sqlite3 "$database_path" 'PRAGMA wal_checkpoint(TRUNCATE);'
  database_check="$(sudo sqlite3 "$database_path" 'PRAGMA quick_check;')"
  if [[ "$database_check" != 'ok' ]]; then
    echo "SQLite quick_check failed: $database_check" >&2
    exit 1
  fi
  sudo cp --preserve=mode,ownership,timestamps "$database_path" "$backup_path"
fi

echo "Switching $current_link to $release_path..."
sudo ln -sfn "$release_path" "$current_link"
release_switched=true

echo "Starting $service_name..."
sudo systemctl start "$service_name"
service_stopped=false

live=false
for _attempt in {1..30}; do
  if curl --fail --silent "$local_api/live" >/dev/null; then
    live=true
    break
  fi
  sleep 2
done

if [[ "$live" != true ]]; then
  echo 'The new backend did not become live within 60 seconds.' >&2
  sudo systemctl status "$service_name" --no-pager >&2 || true
  sudo journalctl -u "$service_name" --since '10 minutes ago' --no-pager >&2 || true
  echo 'The database backup and previous immutable release were retained for manual rollback.' >&2
  exit 1
fi

trap - EXIT

echo
echo "Deployed Slashmon backend revision $revision."
curl --fail --silent "$local_api/live"
echo
curl --silent "$local_api/health"
echo
sudo systemctl status "$service_name" --no-pager --lines=5
