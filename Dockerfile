# ============ 阶段1：构建静态产物 ============
# next.config.ts 里是 output: 'export'，产物在 out/ 目录
FROM node:20-alpine AS builder

WORKDIR /app

# 先只拷贝依赖清单，最大化利用Docker层缓存：package.json不变时不用重新npm install
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 注意：不再需要任何 NEXT_PUBLIC_WS_* 构建参数。
# 前端固定连"当前页面同源的 /ws"（见 lib/useWebSocket.ts），页面和WebSocket由同一个
# Node进程、同一个端口提供服务，所以不管是localhost、局域网IP还是公网域名都自动正确。
RUN npm run build

# ============ 阶段2：运行时（只有 Node + ws + 静态产物，不需要nginx） ============
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9999

# 运行时只依赖 ws 这一个库（ws自身零依赖），直接从构建阶段拷过来，
# 不用在运行时镜像里再装一遍 next/react/three 那一大堆只在构建期需要的前端依赖
COPY --from=builder /app/node_modules/ws ./node_modules/ws

# 静态产物 + 统一服务器（托管静态页面 + WebSocket + /api 接口，全在一个端口上）
COPY --from=builder /app/out ./out
COPY server/index.js ./server/index.js

EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9999/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]
