#!/bin/bash

echo "🚀 开始部署 BOX 项目到 Mac mini..."

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
  echo "❌ 错误：请在项目根目录运行此脚本"
  exit 1
fi

# 拉取最新代码
echo "📥 拉取最新代码..."
git pull origin main

# 安装依赖
echo "📦 安装依赖..."
pnpm install

# 构建项目
echo "🔨 构建项目..."
pnpm build

# 检查构建是否成功
if [ ! -d "out" ]; then
  echo "❌ 构建失败：out 目录不存在"
  exit 1
fi

echo "✅ 构建完成！"
echo ""
echo "📁 静态文件位置：$(pwd)/out"
echo ""
echo "接下来的步骤："
echo "1. 配置 Nginx/Caddy 指向 out/ 目录"
echo "2. 配置 Cloudflare Tunnel（如需内网穿透）"
echo ""
echo "Nginx 配置示例："
echo "  server {"
echo "    listen 80;"
echo "    server_name box.yourdomain.com;"
echo "    root $(pwd)/out;"
echo "    index index.html;"
echo "    location / {"
echo "      try_files \$uri \$uri/ =404;"
echo "    }"
echo "  }"
