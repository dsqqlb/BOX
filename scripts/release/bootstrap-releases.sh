#!/usr/bin/env bash
# One-time migration from a direct project directory to release/current + shared data layout.
# This script is intentionally dry-run by default.
# Usage: ~/box-ops/bootstrap-releases.sh --execute
set -Eeuo pipefail

APP_ROOT="${BOX_APP_ROOT:-$HOME/BOX}"
RELEASE_ROOT="${BOX_RELEASE_ROOT:-$HOME/box-releases}"
SHARED_ROOT="${BOX_SHARED_ROOT:-$HOME/box-shared}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
EXECUTE=0
[[ "${1:-}" == "--execute" ]] && EXECUTE=1
[[ $# -le 1 ]] || { echo "usage: $0 [--execute]" >&2; exit 2; }

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }
[[ -d "$APP_ROOT" ]] || fail "application directory missing: $APP_ROOT"
[[ -f "$APP_ROOT/.env.local" ]] || fail "missing $APP_ROOT/.env.local"
[[ -d "$APP_ROOT/data" ]] || fail "missing $APP_ROOT/data"
[[ ! -e "$RELEASE_ROOT/current" ]] || fail "release layout already initialized: $RELEASE_ROOT/current"
command -v rsync >/dev/null || fail "rsync is required (sudo apt-get install -y rsync)"

cat <<PLAN
This will perform a one-time, short-maintenance-window migration:
  source app:       $APP_ROOT
  release root:     $RELEASE_ROOT
  shared secrets:   $SHARED_ROOT/.env.local
  shared data:      $SHARED_ROOT/data
  service:          $SERVICE_NAME

It will:
  1. stop $SERVICE_NAME;
  2. copy application code into a timestamped legacy release (without node_modules, .next, .env.local, data);
  3. move .env.local and data into the shared directory;
  4. link them from the legacy release;
  5. back up /etc/systemd/system/$SERVICE_NAME;
  6. point the service WorkingDirectory at $RELEASE_ROOT/current;
  7. start and health-check the service.

It will NOT delete $APP_ROOT. Keep it untouched until the new release setup is proven.
PLAN

if (( EXECUTE == 0 )); then
  echo
  echo "Dry run only. Review the plan, create an off-server backup, then rerun with: $0 --execute"
  exit 0
fi

VERSION="legacy-$(date +%Y%m%d-%H%M%S)"
TARGET="$RELEASE_ROOT/$VERSION"
BACKUP_DIR="$HOME/box-backups"
UNIT_FILE="/etc/systemd/system/$SERVICE_NAME"
[[ -f "$UNIT_FILE" ]] || fail "systemd unit missing: $UNIT_FILE"
mkdir -p "$RELEASE_ROOT" "$SHARED_ROOT" "$BACKUP_DIR"

info "Stopping service and backing up current data"
sudo systemctl stop "$SERVICE_NAME"
tar -czf "$BACKUP_DIR/box-before-release-bootstrap-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$APP_ROOT" .env.local data

info "Copying application into initial release"
rsync -a --exclude='.env.local' --exclude='data/' --exclude='node_modules/' --exclude='.next/' --exclude='.git/' "$APP_ROOT/" "$TARGET/"

info "Moving persistent data into shared storage"
mv "$APP_ROOT/.env.local" "$SHARED_ROOT/.env.local"
mv "$APP_ROOT/data" "$SHARED_ROOT/data"
ln -s "$SHARED_ROOT/.env.local" "$TARGET/.env.local"
ln -s "$SHARED_ROOT/data" "$TARGET/data"
ln -s "$TARGET" "$RELEASE_ROOT/current"

info "Updating systemd unit"
sudo cp "$UNIT_FILE" "$UNIT_FILE.before-release-bootstrap-$(date +%Y%m%d-%H%M%S)"
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$RELEASE_ROOT/current|" "$UNIT_FILE"
sudo systemctl daemon-reload
sudo systemctl start "$SERVICE_NAME"
sleep 2
sudo systemctl is-active --quiet "$SERVICE_NAME" || fail "service did not become active; inspect journalctl -u $SERVICE_NAME"
curl -fsS -o /dev/null -I http://127.0.0.1:9999/ || fail "local HTTP health check failed"

info "Bootstrap complete"
printf 'Current release: %s\n' "$(readlink -f "$RELEASE_ROOT/current")"
printf 'Original directory retained at: %s\n' "$APP_ROOT"
printf 'Do not delete the original directory until several deployments have succeeded.\n'
