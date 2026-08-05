# ============ 前端：多阶段构建 ============
# 阶段1：安装依赖 + 构建静态导出产物（next.config.ts 里 output: 'export'，产物在 out/ 目录）
FROM node:20-alpine AS builder

WORKDIR /app

# 先只拷贝依赖清单，能最大化利用Docker层缓存：package.json不变时不用重新npm install
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝其余源码
COPY . .

# WebSocket地址：构建时通过build-arg传入，会被Next.js内联进静态HTML/JS里。
# 留空的话运行时 lib/useWebSocket.ts 的 getWsUrl() 会自动使用访问者当前的hostname，
# 这对大多数"局域网/公网直接用IP或域名访问"的场景已经够用，不需要额外配置。
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

# ============ 阶段2：用nginx托管静态产物 ============
FROM nginx:1.27-alpine

COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
