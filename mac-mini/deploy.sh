#!/bin/bash
# BOX 项目 Docker 部署脚本：拉取最新代码 -> 重新构建镜像 -> 重启容器 -> 清理旧镜像
# 用法：./deploy.sh   （在项目根目录或 mac-mini/ 目录下运行都可以）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
echo "$LOG_PREFIX 🚀 开始部署 BOX 项目..."

if [ ! -f "package.json" ]; then
  echo "❌ 错误：未找到 package.json，请检查项目路径: $PROJECT_DIR"
  exit 1
fi

# 记录当前commit，部署完成后可以对比
BEFORE_SHA="$(git rev-parse HEAD)"

echo "$LOG_PREFIX 📥 拉取最新代码..."
git fetch origin main
git reset --hard origin/main

AFTER_SHA="$(git rev-parse HEAD)"

if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  echo "$LOG_PREFIX ℹ️  代码没有变化 (${AFTER_SHA:0:7})，跳过重新构建"
  exit 0
fi

echo "$LOG_PREFIX 🔄 检测到新代码: ${BEFORE_SHA:0:7} -> ${AFTER_SHA:0:7}"
echo "$LOG_PREFIX 🔨 重新构建并启动容器..."

# --build: 每次都重新构建镜像（会利用Docker层缓存，代码没变的层不会重新跑）
# -d: 后台运行
docker compose up --build -d

echo "$LOG_PREFIX 🧹 清理无用的旧镜像..."
docker image prune -f

echo "$LOG_PREFIX ✅ 部署完成！当前版本: ${AFTER_SHA:0:7}"
docker compose ps
