#!/usr/bin/env node
/**
 * BOX 统一服务器入口：组装所有模块并启动。
 *
 * 一个进程、一个端口（默认9999）搞定所有事情：
 *   1. 页面：生产环境托管 next build 导出的静态产物(out/)，开发环境挂 Next.js dev server（含HMR热更新）
 *   2. WebSocket：先攻追踪器的房间实时同步，路径 /ws（见 server/rooms.js）
 *   3. HTTP接口：认证、业务 API 与静态文件（见 server/routes.js、server/static-files.js）
 *
 * 模块划分：
 *   config.js        环境变量加载与全部运行时常量
 *   auth.js          账户、会话、权限（自包含，保持不变）
 *   db.js            Prisma / SQLite 客户端（自包含，保持不变）
 *   user-data.js     DND 存档与省钱记录的 SQLite 读写（自包含，保持不变）
 *   edh-decks.js     EDH 牌组的 SQLite 读写（自包含，保持不变）
 *   edh-cards.js     EDH 卡牌数据库加载与搜索
 *   images.js        怪物图 / 玩家立绘目录扫描
 *   http-utils.js    HTTP 通用工具（JSON响应、请求体、同源、路径规范化、权限slug映射）
 *   login-page.js    登录页渲染
 *   static-files.js  静态文件托管（MIME、gzip、目录穿越防护、缓存策略）
 *   rooms.js         WebSocket 房间协议
 *   routes.js        HTTP 请求管线与业务 API 路由
 *
 * 用法：
 *   开发： node server/index.js --dev     （或 npm run dev）
 *   生产： node server/index.js           （或 npm start，需要先 npm run build 生成 out/）
 */

const http = require('http');
const fs = require('fs');
const config = require('./config');
const { createAuth } = require('./auth');
const userData = require('./user-data');
const edhDecks = require('./edh-decks');
const httpUtils = require('./http-utils');
const { createRoomServer } = require('./rooms');
const { createRequestHandler } = require('./routes');

// ============ 组装 ============

const auth = createAuth({ projectRoot: config.PROJECT_ROOT, isProduction: !config.DEV });
const roomServer = createRoomServer({ auth });
const requestHandler = createRequestHandler({ auth, userData, edhDecks, roomServer, config });

// ============ 启动统一服务 ============

async function main() {
  // 未导入账户时拒绝启动，避免服务意外以无认证状态运行。
  await auth.loadUsers();
  // 开发模式：把页面请求交给 Next.js dev server 处理（保留HMR热更新）
  let nextRequestHandler = null;
  let nextUpgradeHandler = null;

  if (config.DEV) {
    // 只在开发模式require，生产镜像里没装next也不会报错
    const next = require('next');
    const app = next({ dev: true, dir: config.PROJECT_ROOT });
    await app.prepare();
    nextRequestHandler = app.getRequestHandler();
    // Next.js的HMR也是走WebSocket(/_next/webpack-hmr)，
    // 拿到它的upgrade处理器，才能和房间同步的/ws共存在同一个端口上
    nextUpgradeHandler = app.getUpgradeHandler();
  } else if (!fs.existsSync(config.STATIC_DIR)) {
    console.error(`❌ 找不到静态产物目录: ${config.STATIC_DIR}`);
    console.error('   请先执行 npm run build，或用 npm run dev 启动开发模式');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await requestHandler(req, res, { nextRequestHandler });
    } catch (error) {
      console.error('❌ 请求处理错误:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('500 Internal Server Error');
    }
  });

  // WebSocket升级请求分流：/ws 给房间同步，其余（开发模式下的 /_next/webpack-hmr）给Next.js
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      let pathname = '/';
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
        pathname = httpUtils.canonicalizePathname(pathname);
      } catch { pathname = null; }

      if (pathname === '/ws') {
        const user = await auth.getUserFromRequest(req);
        if (!httpUtils.isSameOrigin(req) || !user || !auth.hasToolAccess(user, 'initiative-tracker')) {
          const status = user ? '403 Forbidden' : '401 Unauthorized';
          socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
          socket.destroy();
          return;
        }
        roomServer.wss.handleUpgrade(req, socket, head, (ws) => { ws.user = user; roomServer.wss.emit('connection', ws, req); });
        return;
      }
      if (config.DEV && nextUpgradeHandler) { nextUpgradeHandler(req, socket, head); return; }
      socket.destroy();
    })().catch((error) => { console.error('❌ WebSocket 认证失败:', error); socket.destroy(); });
  });

  server.listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log(`🚀 BOX 服务已启动（${config.DEV ? '开发' : '生产'}模式，单端口）`);
    console.log(`   本机访问:   http://localhost:${config.PORT}`);
    console.log(`   WebSocket:  ws://localhost:${config.PORT}/ws`);
    console.log(`   图片目录:   ${config.IMAGE_DIR}`);
    if (!config.DEV) console.log(`   静态产物:   ${config.STATIC_DIR}`);
    console.log('');
  });

  // 优雅关闭
  const shutdown = () => {
    console.log('\n👋 正在关闭服务器...');
    clearInterval(roomServer.cleanupTimer);
    roomServer.wss.clients.forEach((client) => client.close());
    server.close(() => {
      console.log('✅ 服务器已关闭');
      process.exit(0);
    });
    // 兜底：5秒内没关干净就强退，避免卡住
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('❌ 服务启动失败:', error);
  process.exit(1);
});
