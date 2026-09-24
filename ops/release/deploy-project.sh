#!/usr/bin/env bash
# 把上传的项目压缩包就地覆盖到服务器上的项目目录，然后重新构建并重启服务。
#
# 用法：
#   ~/box-upload/deploy-project.sh ~/box-upload/box-project-<时间戳>.tar.gz
#   ~/box-upload/deploy-project.sh ~/box-upload/box-project-<时间戳>.tar.gz --clean --skip-install
#
# 选项：
#   --project=<目录>   项目目录，默认 $HOME/BOX（也可用环境变量 BOX_APP_ROOT 指定）
#   --clean            覆盖前先清空 code/（保留 node_modules）、docs/、ops/scripts/、
#                      resources/content/ 与 resources/public/（保留 image/），
#                      让服务器目录与压缩包完全一致
#   --skip-install     跳过 npm ci（依赖没变时用，快很多）
#   --skip-build       跳过 npm run build（压缩包里已带 code/out 时可用）
#   --no-backup        跳过部署前的数据备份（不建议）
#
# 本脚本没有版本目录、没有软链、没有回滚快照：
#   项目目录始终只有一份，新代码直接覆盖旧代码；
#   resources/.env.local、resources/data/、resources/public/image/、code/node_modules/
#   不属于压缩包内容，因此不会被覆盖。
#   回滚方式：在 ~/box-backups/ 里找到部署前生成的 backup.tar.gz，解回 resources/ 即可。
set -Eeuo pipefail

ARCHIVE=""
PROJECT_DIR="${BOX_APP_ROOT:-$HOME/BOX}"
SERVICE_NAME="${BOX_SERVICE_NAME:-box.service}"
HEALTH_PORT="${BOX_PORT:-9999}"
BACKUP_DIR="${BOX_BACKUP_DIR:-$HOME/box-backups}"
CLEAN=0
SKIP_INSTALL=0
SKIP_BUILD=0
DO_BACKUP=1

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

for arg in "$@"; do
  case "$arg" in
    --project=*) PROJECT_DIR="${arg#--project=}" ;;
    --clean) CLEAN=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-backup) DO_BACKUP=0 ;;
    --*) fail "未知选项：$arg" ;;
    *) [[ -z "$ARCHIVE" ]] && ARCHIVE="$arg" || fail "只接受一个压缩包路径" ;;
  esac
done

[[ -n "$ARCHIVE" ]] || fail "用法：$0 <项目压缩包路径> [--clean] [--skip-install] [--skip-build] [--no-backup]"
[[ -f "$ARCHIVE" ]] || fail "找不到压缩包：$ARCHIVE"
command -v tar >/dev/null || fail "缺少 tar"
command -v npm >/dev/null || fail "缺少 npm"
command -v node >/dev/null || fail "缺少 node"
[[ -f "/etc/systemd/system/$SERVICE_NAME" ]] || fail "systemd 单元不存在：/etc/systemd/system/$SERVICE_NAME"
[[ -d "$PROJECT_DIR" ]] || fail "项目目录不存在：$PROJECT_DIR（首次部署请按 docs/deployment.md 建好目录与 resources/.env.local）"
[[ -f "$PROJECT_DIR/resources/.env.local" ]] || fail "缺少 $PROJECT_DIR/resources/.env.local（会话密钥等私密配置）"
[[ -d "$PROJECT_DIR/resources/data" ]] || fail "缺少 $PROJECT_DIR/resources/data（SQLite 与用户数据必须在服务器上已有）"

# 持久化数据永远不进压缩包：包里出现这些路径说明打包脚本用错了。
forbidden="$(tar -tzf "$ARCHIVE" | grep -E '^(\./)?(resources/\.env\.local|resources/data/|resources/public/image/|code/node_modules/|\.git/)' || true)"
[[ -z "$forbidden" ]] || fail "压缩包内含禁止上传的路径：$(printf '%s' "$forbidden" | tr '\n' ' ')"

BACKUP_FILE=""
SERVICE_STOPPED=0

restart_on_failure() {
  status=$?
  if (( status != 0 )); then
    printf '\n部署失败（exit %s）。\n' "$status" >&2
    if (( SERVICE_STOPPED == 1 )); then
      printf '尝试把服务重新拉起来…\n' >&2
      sudo systemctl start "$SERVICE_NAME" || true
    fi
    [[ -n "$BACKUP_FILE" ]] && printf '部署前备份：%s\n' "$BACKUP_FILE" >&2
  fi
  return "$status"
}
trap restart_on_failure EXIT

info "停止服务：$SERVICE_NAME"
sudo systemctl stop "$SERVICE_NAME"

if (( DO_BACKUP == 1 )); then
  info "备份 resources/.env.local 与 resources/data"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/box-before-deploy-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$BACKUP_FILE" -C "$PROJECT_DIR" resources/.env.local resources/data
  printf 'Backup: %s\n' "$BACKUP_FILE"
fi

if (( CLEAN == 1 )); then
  info "清理会被覆盖的目录（保留 node_modules 与 public/image）"
  find "$PROJECT_DIR/code" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} + 2>/dev/null || true
  rm -rf -- "$PROJECT_DIR/docs" "$PROJECT_DIR/ops/scripts" "$PROJECT_DIR/resources/content"
  find "$PROJECT_DIR/resources/public" -mindepth 1 -maxdepth 1 ! -name image -exec rm -rf -- {} + 2>/dev/null || true
fi

info "解压项目到 $PROJECT_DIR"
tar -xzf "$ARCHIVE" -C "$PROJECT_DIR"
[[ -f "$PROJECT_DIR/code/server/index.js" ]] || fail "解压后缺少 code/server/index.js"
[[ -f "$PROJECT_DIR/resources/content/tools.json" ]] || fail "解压后缺少 resources/content/tools.json"

if (( SKIP_INSTALL == 0 )); then
  info "安装依赖（npm ci）"
  ( cd "$PROJECT_DIR/code" && npm ci )
else
  info "跳过 npm ci"
fi

info "生成 Prisma 客户端"
( cd "$PROJECT_DIR/code" && npm run db:generate )

if (( SKIP_BUILD == 0 )); then
  info "构建页面（npm run build）"
  ( cd "$PROJECT_DIR/code" && npm run build )
else
  info "跳过 npm run build"
fi

# 只做结构迁移：绝不要在这里跑 db:import-json / db:setup，它们会替换账户与牌组数据。
info "应用数据库结构迁移（db:migrate）"
( cd "$PROJECT_DIR/code" && npm run db:migrate )

info "启动服务：$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"
SERVICE_STOPPED=0
sleep 2
sudo systemctl is-active --quiet "$SERVICE_NAME" || fail "服务没起来，请看：journalctl -u $SERVICE_NAME -n 50 --no-pager"
curl -fsS -o /dev/null -I "http://127.0.0.1:$HEALTH_PORT/login" || fail "本机健康检查失败（http://127.0.0.1:$HEALTH_PORT/login）"
trap - EXIT

info "部署完成"
printf '项目目录:   %s\n' "$PROJECT_DIR"
printf '服务状态:   %s\n' "$(systemctl is-active "$SERVICE_NAME")"
printf '本机探测:   %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HEALTH_PORT/login")"
if [[ -n "$BACKUP_FILE" ]]; then printf '数据备份:   %s\n' "$BACKUP_FILE"; fi
printf '提示：旧版本里已删除的文件会留在项目目录里；需要完全一致时下次加 --clean。\n'
printf '提示：外网验证用 curl -I https://你的主站域名/login（期望 200）。\n'