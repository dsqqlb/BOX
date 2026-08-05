#!/bin/bash
# 轮询式自动部署：定期检查 GitHub 上 main 分支有没有新commit，有就触发 deploy.sh。
# 优点：不需要把Mac mini暴露到公网、不需要配置webhook接收端口，最简单可靠。
# 缺点：不是"立即"部署，有轮询间隔的延迟（默认60秒，基本可以接受）。
#
# 用法：./auto-deploy-poll.sh
# 建议配合 launchd（见 com.box.autodeploy.plist）做成开机自启的后台服务。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
POLL_INTERVAL="${POLL_INTERVAL:-60}"  # 轮询间隔（秒），可通过环境变量覆盖

cd "$PROJECT_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 👀 开始监听 origin/main，轮询间隔 ${POLL_INTERVAL}s..."

while true; do
  git fetch origin main --quiet 2>/dev/null

  LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo "")"
  REMOTE_SHA="$(git rev-parse origin/main 2>/dev/null || echo "")"

  if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔔 检测到远端有新提交，触发部署..."
    "$SCRIPT_DIR/deploy.sh" || echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ 部署脚本执行失败，等待下一轮重试"
  fi

  sleep "$POLL_INTERVAL"
done
