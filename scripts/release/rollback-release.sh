#!/usr/bin/env bash
# Switch BOX to an existing release directory. This does NOT roll back database migrations.
# Usage: ~/box-ops/rollback-release.sh <release-directory-name>
set -Eeuo pipefail

RELEASE_ROOT="${BOX_RELEASE_ROOT:-$HOME/box-releases}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
TARGET_NAME="${1:-}"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$TARGET_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "usage: $0 <safe-release-directory-name>"
TARGET="$RELEASE_ROOT/$TARGET_NAME"
[[ -d "$TARGET" ]] || fail "release not found: $TARGET"
[[ -f "$TARGET/package.json" && -d "$TARGET/out" && -f "$TARGET/server/index.js" ]] || fail "target does not look like a complete release"
[[ -L "$RELEASE_ROOT/current" ]] || fail "current release symlink missing"

CURRENT="$(readlink -f "$RELEASE_ROOT/current")"
printf 'Current release: %s\nTarget release:  %s\n' "$CURRENT" "$TARGET"
printf 'Warning: database migrations are forward-only. Continue only if this code is compatible with the current database schema.\n'
read -r -p 'Type the target release directory name to confirm rollback: ' CONFIRM
[[ "$CONFIRM" == "$TARGET_NAME" ]] || fail "confirmation did not match; no change made"

sudo systemctl stop "$SERVICE_NAME"
ln -sfn "$TARGET" "$RELEASE_ROOT/current"
if ! sudo systemctl start "$SERVICE_NAME"; then
  echo "Start failed; restoring previous release." >&2
  ln -sfn "$CURRENT" "$RELEASE_ROOT/current"
  sudo systemctl start "$SERVICE_NAME" || true
  exit 1
fi
sleep 2
sudo systemctl is-active --quiet "$SERVICE_NAME" || fail "service is not active after rollback"
curl -fsS -o /dev/null -I http://127.0.0.1:9999/ || fail "local HTTP health check failed after rollback"
printf 'Rollback complete. Current release: %s\n' "$(readlink -f "$RELEASE_ROOT/current")"
