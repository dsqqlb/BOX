#!/usr/bin/env bash
# One-time migration from a direct project directory to release + shared layout.
# This script is intentionally dry-run by default.
# Usage: ~/box-ops/bootstrap-releases.sh --execute
#
# 它只做一件事：把持久化数据搬进共享目录，再用软链接回原目录。
# 原来的应用目录、systemd 配置、启动命令都不动，因此迁移后旧服务照常运行。
# 第一次执行 deploy-release.sh 时，才会把服务切到新的 code/ + resources/ 布局。
set -Eeuo pipefail

APP_ROOT="${BOX_APP_ROOT:-$HOME/BOX}"
RELEASE_ROOT="${BOX_RELEASE_ROOT:-$HOME/box-releases}"
SHARED_ROOT="${BOX_SHARED_ROOT:-$HOME/box-shared}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
HEALTH_PORT="${BOX_PORT:-9999}"
EXECUTE=0
[[ "${1:-}" == "--execute" ]] && EXECUTE=1
[[ $# -le 1 ]] || { echo "usage: $0 [--execute]" >&2; exit 2; }

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }
[[ -d "$APP_ROOT" ]] || fail "application directory missing: $APP_ROOT"
[[ -f "$APP_ROOT/.env.local" ]] || fail "missing $APP_ROOT/.env.local"
[[ -d "$APP_ROOT/data" ]] || fail "missing $APP_ROOT/data"
[[ ! -L "$APP_ROOT/.env.local" ]] || fail "$APP_ROOT/.env.local is already a symlink; bootstrap seems to have run already"
[[ ! -L "$APP_ROOT/data" ]] || fail "$APP_ROOT/data is already a symlink; bootstrap seems to have run already"
[[ ! -e "$RELEASE_ROOT/current" ]] || fail "release layout already initialized: $RELEASE_ROOT/current"

IMAGE_DIR="$APP_ROOT/public/image"
HAS_IMAGE=0
[[ -d "$IMAGE_DIR" ]] && HAS_IMAGE=1

cat <<PLAN
This will perform a one-time, short-maintenance-window migration:
  source app:       $APP_ROOT
  release root:     $RELEASE_ROOT
  shared secrets:   $SHARED_ROOT/.env.local
  shared data:      $SHARED_ROOT/data
  shared images:    $SHARED_ROOT/public-image   (当前是否已有图片目录: $HAS_IMAGE)
  service:          $SERVICE_NAME

It will:
  1. stop $SERVICE_NAME;
  2. back up .env.local, data/ (and public/image/ if present) to ~/box-backups;
  3. MOVE them into $SHARED_ROOT;
  4. symlink them back into $APP_ROOT, so the current app keeps running unchanged;
  5. point $RELEASE_ROOT/current at $APP_ROOT (标记为旧布局，供第一次部署读取);
  6. start and health-check the service.

It will NOT delete $APP_ROOT, and it will NOT change the systemd unit.
The new code/ + resources/ layout takes effect on the first deploy-release.sh run.
PLAN

if (( EXECUTE == 0 )); then
  echo
  echo "Dry run only. Review the plan, create an off-server backup, then rerun with: $0 --execute"
  exit 0
fi

BACKUP_DIR="$HOME/box-backups"
mkdir -p "$RELEASE_ROOT" "$SHARED_ROOT" "$BACKUP_DIR"
[[ ! -e "$SHARED_ROOT/.env.local" && ! -e "$SHARED_ROOT/data" && ! -e "$SHARED_ROOT/public-image" ]] \
  || fail "$SHARED_ROOT is not empty; refusing to overwrite existing shared data"

SERVICE_STOPPED=0
restart_on_failure() {
  status=$?
  if (( status != 0 && SERVICE_STOPPED == 1 )); then
    printf '\nBootstrap failed (exit %s); restarting the existing service.\n' "$status" >&2
    sudo systemctl start "$SERVICE_NAME" || true
  fi
  return "$status"
}
trap restart_on_failure EXIT

info "Stopping service and backing up current data"
sudo systemctl stop "$SERVICE_NAME"
SERVICE_STOPPED=1
BACKUP_FILE="$BACKUP_DIR/box-before-release-bootstrap-$(date +%Y%m%d-%H%M%S).tar.gz"
BACKUP_ITEMS=(.env.local data)
(( HAS_IMAGE == 1 )) && BACKUP_ITEMS+=(public/image)
tar -czf "$BACKUP_FILE" -C "$APP_ROOT" "${BACKUP_ITEMS[@]}"
printf 'Backup: %s\n' "$BACKUP_FILE"

info "Moving persistent data into shared storage"
mv "$APP_ROOT/.env.local" "$SHARED_ROOT/.env.local"
mv "$APP_ROOT/data" "$SHARED_ROOT/data"
if (( HAS_IMAGE == 1 )); then
  mv "$IMAGE_DIR" "$SHARED_ROOT/public-image"
else
  mkdir -p "$SHARED_ROOT/public-image"
fi

info "Linking shared storage back into the running app"
ln -s "$SHARED_ROOT/.env.local" "$APP_ROOT/.env.local"
ln -s "$SHARED_ROOT/data" "$APP_ROOT/data"
if (( HAS_IMAGE == 1 )); then
  ln -s "$SHARED_ROOT/public-image" "$IMAGE_DIR"
fi

ln -sfn "$APP_ROOT" "$RELEASE_ROOT/current"

info "Starting the existing service again"
sudo systemctl start "$SERVICE_NAME"
SERVICE_STOPPED=0
sleep 2
sudo systemctl is-active --quiet "$SERVICE_NAME" || fail "service did not become active; inspect journalctl -u $SERVICE_NAME"
curl -fsS -o /dev/null -I "http://127.0.0.1:$HEALTH_PORT/" || fail "local HTTP health check failed"
trap - EXIT

info "Bootstrap complete"
printf 'Shared secrets: %s\n' "$SHARED_ROOT/.env.local"
printf 'Shared data:    %s\n' "$SHARED_ROOT/data"
printf 'Shared images:  %s\n' "$SHARED_ROOT/public-image"
printf 'Current marker: %s -> %s (旧布局)\n' "$RELEASE_ROOT/current" "$APP_ROOT"
printf 'Original directory retained at: %s\n' "$APP_ROOT"
printf '下一步：上传发布包，然后运行 ~/box-ops/deploy-release.sh ~/box-upload/box-<版本>.tar.gz\n'
printf 'Do not delete the original directory until several deployments have succeeded.\n'
