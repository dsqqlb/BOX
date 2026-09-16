#!/usr/bin/env bash
# Switch BOX to an existing release directory. This does NOT roll back database migrations.
# Usage: ~/box-ops/rollback-release.sh <release-directory-name>
#
# 只能回滚到新布局（code/ + resources/）的发布版本。bootstrap 之前的旧目录不受管理，
# 也不在本脚本的候选范围内。列出现有版本：ls -1 ~/box-releases
set -Eeuo pipefail

RELEASE_ROOT="${BOX_RELEASE_ROOT:-$HOME/box-releases}"
SHARED_ROOT="${BOX_SHARED_ROOT:-$HOME/box-shared}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
HEALTH_PORT="${BOX_PORT:-9999}"
TARGET_NAME="${1:-}"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$TARGET_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "usage: $0 <safe-release-directory-name>"
TARGET="$RELEASE_ROOT/$TARGET_NAME"
[[ -d "$TARGET" ]] || fail "release not found: $TARGET"

# 完整发布检查：代码、构建产物、服务端入口、以及三个指向共享目录的软链
[[ -f "$TARGET/code/package.json" ]] || fail "target is missing code/package.json"
[[ -f "$TARGET/code/server/index.js" ]] || fail "target is missing code/server/index.js"
[[ -d "$TARGET/code/out" ]] || fail "target is missing code/out（未完成的发布版本不能作为回滚目标）"
[[ -L "$TARGET/resources/.env.local" && -f "$TARGET/resources/.env.local" ]] || fail "target is missing resources/.env.local（应指向共享密钥）"
[[ -L "$TARGET/resources/data" && -d "$TARGET/resources/data" ]] || fail "target is missing resources/data（应指向共享数据库目录）"
[[ -L "$TARGET/resources/public/image" && -d "$TARGET/resources/public/image" ]] || fail "target is missing resources/public/image（应指向共享图片目录）"
[[ -L "$RELEASE_ROOT/current" ]] || fail "current release symlink missing"
[[ -f "$SHARED_ROOT/.env.local" && -d "$SHARED_ROOT/data" && -d "$SHARED_ROOT/public-image" ]] \
  || fail "shared storage is incomplete; check $SHARED_ROOT"

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
curl -fsS -o /dev/null -I "http://127.0.0.1:$HEALTH_PORT/" || fail "local HTTP health check failed after rollback"
printf 'Rollback complete. Current release: %s\n' "$(readlink -f "$RELEASE_ROOT/current")"
