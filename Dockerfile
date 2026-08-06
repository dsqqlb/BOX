# ============ 前端：多阶段构建 ============
# 阶段1：安装依赖 + 构建静态导出产物（next.config.ts 里 output: 'export'，产物在 out/ 目录）
FROM node:20-alpine AS builder

WORKDIR /app

# 先只拷贝依赖清单，能最大化利用Docker层缓存：package.json不变时不用重新npm install
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝其余源码
COPY . .

# WebSocket地址：构建时通过build-arg传入，会被Next.js内联进静态HTML/JS里，运行时无法再改，
# 改了这两个值必须重新 docker compose build 才会生效。
#
# NEXT_PUBLIC_WS_URL：完全自定义WebSocket地址，留空则走下面的自动推断逻辑。
#
# NEXT_PUBLIC_WS_PATH_MODE：
#   - "true"：走"同域同端口 + /ws 路径反代"模式。适合 Cloudflare Tunnel / 只暴露单个端口的反向代理场景——
#     因为这类隧道通常一个hostname只能指向一个源端口，没法再单独开一个端口给WebSocket，
#     所以让nginx把 /ws 开头的请求转发给ws-server容器（见 nginx.conf）。
#   - 默认("false"/留空)：局域网直连模式，浏览器直接连 host:9998，不经过nginx反代。
ARG NEXT_PUBLIC_WS_URL=""
ARG NEXT_PUBLIC_WS_PATH_MODE=""
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_PATH_MODE=$NEXT_PUBLIC_WS_PATH_MODE

RUN npm run build

# ============ 阶段2：用nginx托管静态产物 ============
FROM nginx:1.27-alpine

COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
