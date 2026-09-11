#!/usr/bin/env bash
# Deploy a previously uploaded BOX release archive. Run as the non-root deployment user.
# Usage: ~/box-ops/deploy-release.sh ~/box-upload/box-YYYYMMDD-HHMMSS-revision.tar.gz
set -Eeuo pipefail

RELEASE_ROOT="${BOX_RELEASE_ROOT:-$HOME/box-releases}"
SHARED_ROOT="${BOX_SHARED_ROOT:-$HOME/box-shared}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
KEEP_RELEASES="${BOX_KEEP_RELEASES:-5}"
ARCHIVE="${1:-}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }
[[ -n "$ARCHIVE" ]] || fail "usage: $0 /path/to/box-<version>.tar.gz"
[[ -f "$ARCHIVE" ]] || fail "archive not found: $ARCHIVE"
command -v tar >/dev/null || fail "tar is required"
command -v npm >/dev/null || fail "npm is required"
[[ -L "$RELEASE_ROOT/current" ]] || fail "release layout is not initialized; run bootstrap-releases.sh first"
[[ -f "$SHARED_ROOT/.env.local" ]] || fail "missing shared .env.local"
[[ -d "$SHARED_ROOT/data" ]] || fail "missing shared data directory"
[[ -d "$SHARED_ROOT/public-image" ]] || fail "missing shared public-image directory"

VERSION="$(basename "$ARCHIVE" | sed -nE 's/^box-(.+)\.tar\.gz$/\1/p')"
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || fail "archive name must be box-<safe-version>.tar.gz"
TARGET="$RELEASE_ROOT/$VERSION"
[[ ! -e "$TARGET" ]] || fail "release already exists: $TARGET"

OLD_TARGET="$(readlink -f "$RELEASE_ROOT/current")"
[[ -d "$OLD_TARGET" ]] || fail "current release target is invalid"
TMP_TARGET="$RELEASE_ROOT/.incoming-$VERSION"
BACKUP_DIR="$HOME/box-backups"
SWITCHED=0
SERVICE_STOPPED=0

cleanup() {
  status=$?
  if (( status != 0 )); then
    printf '\nDeployment failed (exit %s).\n' "$status" >&2
    if (( SWITCHED == 1 )); then
      printf 'Restoring previous release: %s\n' "$OLD_TARGET" >&2
      ln -sfn "$OLD_TARGET" "$RELEASE_ROOT/current"
    fi
    if (( SERVICE_STOPPED == 1 )); then
      sudo systemctl start "$SERVICE_NAME" || true
    fi
    [[ -d "$TMP_TARGET" ]] && rm -rf -- "$TMP_TARGET"
  fi
}
trap cleanup EXIT

info "Extracting $VERSION"
mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"
mkdir "$TMP_TARGET"
tar -xzf "$ARCHIVE" -C "$TMP_TARGET"
[[ -f "$TMP_TARGET/release-manifest.json" ]] || fail "release manifest missing"
[[ -f "$TMP_TARGET/package.json" ]] || fail "package.json missing"
[[ -d "$TMP_TARGET/server" ]] || fail "server directory missing"
[[ -d "$TMP_TARGET/public" ]] || fail "public directory missing"
# Archives must never supply persistent runtime data or server-managed image assets.
# Remove only the unactivated staging paths, then create top-level shared links.
rm -rf -- "$TMP_TARGET/data" "$TMP_TARGET/public/image"
ln -s "$SHARED_ROOT/.env.local" "$TMP_TARGET/.env.local"
ln -s "$SHARED_ROOT/data" "$TMP_TARGET/data"
ln -s "$SHARED_ROOT/public-image" "$TMP_TARGET/public/image"

info "Installing dependencies and building before downtime"
(
  cd "$TMP_TARGET"
  npm ci
  npm run db:generate
  npm run build
)

info "Stopping service and creating a consistent data backup"
sudo systemctl stop "$SERVICE_NAME"
SERVICE_STOPPED=1
tar -czf "$BACKUP_DIR/box-before-$VERSION-$(date +%Y%m%d-%H%M%S).tar.gz" \
  -C "$SHARED_ROOT" .env.local data public-image

info "Applying database migrations"
(
  cd "$TMP_TARGET"
  npm run db:migrate
)

info "Switching current release"
mv "$TMP_TARGET" "$TARGET"
ln -sfn "$TARGET" "$RELEASE_ROOT/current"
SWITCHED=1
sudo systemctl start "$SERVICE_NAME"
SERVICE_STOPPED=0
sleep 2
sudo systemctl is-active --quiet "$SERVICE_NAME" || fail "service did not become active"
curl -fsS -o /dev/null -I http://127.0.0.1:9999/ || fail "local HTTP health check failed"

info "Pruning old releases (keeping $KEEP_RELEASES)"
mapfile -t releases < <(find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
if (( ${#releases[@]} > KEEP_RELEASES )); then
  for release in "${releases[@]:KEEP_RELEASES}"; do
    path="$RELEASE_ROOT/$release"
    [[ "$(readlink -f "$path")" == "$(readlink -f "$RELEASE_ROOT/current")" ]] && continue
    printf 'Removing old release: %s\n' "$path"
    rm -rf -- "$path"
  done
fi

info "Deployment complete"
printf 'Current release: %s\n' "$(readlink -f "$RELEASE_ROOT/current")"
printf 'Rollback command: ~/box-ops/rollback-release.sh %s\n' "$(basename "$OLD_TARGET")"
trap - EXIT
