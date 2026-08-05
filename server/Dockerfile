# WebSocket服务：只依赖 ws 库，用独立的 server/package.json（不含Next/React/Three等前端依赖），
# 构建产物和依赖体积都很小
FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY server/websocket-server.js ./websocket-server.js

# websocket-server.js 里通过 path.join(__dirname, '..', 'public', 'image', 'enemies')
# 读取怪物图片目录（__dirname就是/app，上一级是/），所以这里在容器根目录建好同样的相对目录结构，
# 实际图片内容由 docker-compose 的 volume 挂载进来
RUN mkdir -p /public/image/enemies

ENV WS_PORT=9998
EXPOSE 9998

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9998/enemies', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "websocket-server.js"]
