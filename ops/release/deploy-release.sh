#!/usr/bin/env bash
# Deploy a previously uploaded BOX release archive. Run as the non-root deployment user.
# Usage: ~/box-ops/deploy-release.sh ~/box-upload/box-YYYYMMDD-HHMMSS-revision.tar.gz
#
# 发布目录结构（包内目录名全部是英文）：
#   code/                代码类：页面、组件、服务端、构建产物
#   resources/content/   受版本控制的资源
#   resources/public/    静态资源（不含 image/，image/ 走共享目录）
#   resources/.env.example
#   ops/scripts/         数据库与维护脚本
#   docs/                文档类
#
# 持久化数据（密钥、数据库、大图）通过软链指向共享目录，切换版本时不复制、不覆盖：
#   resources/.env.local        -> $SHARED_ROOT/.env.local
#   resources/data              -> $SHARED_ROOT/data
#   resources/public/image      -> $SHARED_ROOT/public-image
set -Eeuo pipefail

RELEASE_ROOT="${BOX_RELEASE_ROOT:-$HOME/box-releases}"
SHARED_ROOT="${BOX_SHARED_ROOT:-$HOME/box-shared}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
KEEP_RELEASES="${BOX_KEEP_RELEASES:-5}"
HEALTH_PORT="${BOX_PORT:-9999}"
ARCHIVE="${1:-}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }
[[ -n "$ARCHIVE" ]] || fail "usage: $0 /path/to/box-<version>.tar.gz"
[[ -f "$ARCHIVE" ]] || fail "archive not found: $ARCHIVE"
command -v tar >/dev/null || fail "tar is required"
command -v npm >/dev/null || fail "npm is required"
NODE_BIN="${BOX_NODE_BIN:-$(command -v node || true)}"
[[ -n "$NODE_BIN" ]] || fail "node is required"
[[ -L "$RELEASE_ROOT/current" ]] || fail "release layout is not initialized; run bootstrap-releases.sh first"
[[ -f "$SHARED_ROOT/.env.local" ]] || fail "missing shared .env.local"
[[ -d "$SHARED_ROOT/data" ]] || fail "missing shared data directory"
[[ -d "$SHARED_ROOT/public-image" ]] || fail "missing shared public-image directory"
[[ -f "/etc/systemd/system/$SERVICE_NAME" ]] || fail "systemd unit not found: /etc/systemd/system/$SERVICE_NAME"

VERSION="$(basename "$ARCHIVE" | sed -nE 's/^box-(.+)\.tar\.gz$/\1/p')"
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || fail "archive name must be box-<safe-version>.tar.gz"
TARGET="$RELEASE_ROOT/$VERSION"
[[ ! -e "$TARGET" ]] || fail "release already exists: $TARGET"

OLD_TARGET="$(readlink -f "$RELEASE_ROOT/current")"
[[ -d "$OLD_TARGET" ]] || fail "current release target is invalid"
TMP_TARGET="$RELEASE_ROOT/.incoming-$VERSION"
BACKUP_DIR="$HOME/box-backups"
DROPIN_DIR="/etc/systemd/system/$SERVICE_NAME.d"
DROPIN_FILE="$DROPIN_DIR/box-release-layout.conf"
SWITCHED=0
SERVICE_STOPPED=0
DROPIN_WRITTEN=0

cleanup() {
  status=$?
  if (( status != 0 )); then
    printf '\nDeployment failed (exit %s).\n' "$status" >&2
    if (( SWITCHED == 1 )); then
      printf 'Restoring previous release: %s\n' "$OLD_TARGET" >&2
      ln -sfn "$OLD_TARGET" "$RELEASE_ROOT/current"
    fi
    if (( DROPIN_WRITTEN == 1 )); then
      sudo rm -f -- "$DROPIN_FILE"
      sudo rmdir --ignore-fail-on-non-empty "$DROPIN_DIR" 2>/dev/null || true
      sudo systemctl daemon-reload || true
    fi
    if (( SERVICE_STOPPED == 1 )); then
      sudo systemctl start "$SERVICE_NAME" || true
    fi
    [[ -d "$TMP_TARGET" ]] && rm -rf -- "$TMP_TARGET"
  fi
  return "$status"
}
trap cleanup EXIT

info "Extracting $VERSION"
mkdir -p "$RELEASE_ROOT" "$BACKUP_DIR"
mkdir "$TMP_TARGET"
tar -xzf "$ARCHIVE" -C "$TMP_TARGET"
[[ -f "$TMP_TARGET/release-manifest.json" ]] || fail "release manifest missing"
[[ -f "$TMP_TARGET/code/package.json" ]] || fail "code/package.json missing"
[[ -f "$TMP_TARGET/code/server/index.js" ]] || fail "code/server/index.js missing"
[[ -d "$TMP_TARGET/code/out" ]] || fail "code/out missing（发布包应包含构建产物）"
[[ -d "$TMP_TARGET/resources/public" ]] || fail "resources/public missing"
[[ -f "$TMP_TARGET/resources/content/tools.json" ]] || fail "resources/content/tools.json missing"
[[ -d "$TMP_TARGET/ops/scripts" ]] || fail "ops/scripts missing（数据库命令依赖它）"

# 发布包永远不能携带持久化数据：先删掉包内可能存在的同名路径，再建软链。
rm -rf -- "$TMP_TARGET/resources/.env.local" "$TMP_TARGET/resources/data" \
          "$TMP_TARGET/resources/public/image" "$TMP_TARGET/code/node_modules" \
          "$TMP_TARGET/code/.next" "$TMP_TARGET/ops/.release" "$TMP_TARGET/ops/logs"
ln -s "$SHARED_ROOT/.env.local" "$TMP_TARGET/resources/.env.local"
ln -s "$SHARED_ROOT/data" "$TMP_TARGET/resources/data"
ln -s "$SHARED_ROOT/public-image" "$TMP_TARGET/resources/public/image"

info "Installing dependencies and building before downtime"
(
  cd "$TMP_TARGET/code"
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
  cd "$TMP_TARGET/code"
  npm run db:migrate
)

# systemd 用 drop-in 指向新布局：WorkingDirectory 是发布目录，入口是 code/server/index.js。
# 不直接改原 unit 文件，回滚或排错时删掉这个 .conf 再 daemon-reload 即可。
info "Pointing $SERVICE_NAME at the new layout"
sudo mkdir -p "$DROPIN_DIR"
printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s code/server/index.js\n' \
  "$RELEASE_ROOT/current" "$NODE_BIN" | sudo tee "$DROPIN_FILE" >/dev/null
DROPIN_WRITTEN=1
sudo systemctl daemon-reload

info "Switching current release"
mv "$TMP_TARGET" "$TARGET"
ln -sfn "$TARGET" "$RELEASE_ROOT/current"
SWITCHED=1
sudo systemctl start "$SERVICE_NAME"
SERVICE_STOPPED=0
sleep 2
sudo systemctl is-active --quiet "$SERVICE_NAME" || fail "service did not become active"
curl -fsS -o /dev/null -I "http://127.0.0.1:$HEALTH_PORT/" || fail "local HTTP health check failed"

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
printf 'Shared secrets:  %s\n' "$SHARED_ROOT/.env.local"
printf 'Shared data:     %s\n' "$SHARED_ROOT/data"
printf 'Shared images:   %s\n' "$SHARED_ROOT/public-image"
printf 'Previous release was: %s\n' "$OLD_TARGET"
trap - EXIT
