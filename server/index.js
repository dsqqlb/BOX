#!/usr/bin/env node
/**
 * BOX 统一服务器：一个进程、一个端口（默认9999）搞定所有事情。
 *
 * 这个文件同时承担了三件以前分散在两个容器里的事：
 *   1. 页面：生产环境托管 next build 导出的静态产物(out/)，开发环境挂 Next.js dev server（含HMR热更新）
 *   2. WebSocket：先攻追踪器的房间实时同步，路径 /ws
 *   3. HTTP接口：/api/enemies、/api/player-images，实时扫描图片目录返回清单
 *
 * 为什么要合并：项目是 output:'export' 纯静态站点，实时同步必须有个常驻进程；
 * 现在直接让Node同时干这三件事，于是：只有一个端口、一个进程、一个容器，不需要nginx，
 * 也不需要任何 NEXT_PUBLIC_WS_* 环境变量（前端固定连同源的 /ws，永远不会错）。
 *
 * 用法：
 *   开发： node server/index.js --dev     （或 npm run dev）
 *   生产： node server/index.js           （或 npm start，需要先 npm run build 生成 out/）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const WebSocket = require('ws');

// ============ 配置 ============

const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const PORT = Number(process.env.PORT || 9999);
const HOST = process.env.HOST || '0.0.0.0';

const PROJECT_ROOT = path.join(__dirname, '..');
// 静态产物目录（生产环境用）：next build + output:'export' 的产物
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(PROJECT_ROOT, 'out'));
// 图片目录：开发环境直接读源码里的 public/image；
// 生产环境读导出后的 out/image（docker-compose 会把宿主机的 public/image 挂载覆盖到这里，
// 所以加新图片不需要重新构建镜像）
const IMAGE_DIR = path.resolve(
  process.env.IMAGE_DIR || (DEV ? path.join(PROJECT_ROOT, 'public', 'image') : path.join(STATIC_DIR, 'image'))
);
const ENEMY_DIR = path.join(IMAGE_DIR, 'enemies');
const PLAYER_DIR = path.join(IMAGE_DIR, 'player');
const SAVINGS_FILE = path.join(PROJECT_ROOT, 'data', 'savings.json');

// ============ 省钱记录数据读写 ============

function loadSavings() {
  try {
    if (fs.existsSync(SAVINGS_FILE)) {
      const raw = fs.readFileSync(SAVINGS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('读取省钱记录失败:', e.message);
  }
  return [];
}

function saveSavings(data) {
  try {
    const dir = path.dirname(SAVINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SAVINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('保存省钱记录失败:', e.message);
    return false;
  }
}

// ============ 图片目录扫描（怪物图 / 玩家立绘） ============
// 命名规则：怪物图为"中文名_英文标识.png"；玩家立绘为 player/<种族中文>_<种族英文>/<职业中文>.png
// 没有中文前缀的旧文件名会原样兜底（key=name=文件名本身）

const VALID_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const CN_PREFIX_PATTERN = /^([\u4e00-\u9fa5]+)_(.+)$/;

function parseEnemyFilename(filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  const match = base.match(CN_PREFIX_PATTERN);
  if (match) {
    const [, name, key] = match;
    return { key, name };
  }
  return { key: base, name: base };
}

// 每次调用都实时扫描目录，新增/改名图片后无需重启服务，刷新页面即可生效
function getEnemyList() {
  if (!fs.existsSync(ENEMY_DIR)) return [];

  const files = fs
    .readdirSync(ENEMY_DIR)
    .filter((f) => VALID_IMAGE_EXT.has(path.extname(f).toLowerCase()));

  const byKey = new Map();
  for (const file of files) {
    const { key, name } = parseEnemyFilename(file);
    byKey.set(key, { key, name, file });
  }

  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function getPlayerImageList() {
  if (!fs.existsSync(PLAYER_DIR)) return [];

  const raceDirs = fs
    .readdirSync(PLAYER_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const result = [];
  for (const dir of raceDirs) {
    const match = dir.name.match(CN_PREFIX_PATTERN);
    const raceName = match ? match[1] : dir.name;
    const raceEn = match ? match[2] : dir.name;

    const raceDirPath = path.join(PLAYER_DIR, dir.name);
    const files = fs
      .readdirSync(raceDirPath)
      .filter((f) => VALID_IMAGE_EXT.has(path.extname(f).toLowerCase()));

    for (const file of files) {
      const ext = path.extname(file);
      const className = file.slice(0, -ext.length); // 职业名，如"战士"、"其他1"
      // key用种族英文+职业名拼接，保证跨种族不重名；name是给人看的完整显示名
      const key = `${raceEn}__${className}`;
      result.push({
        key,
        name: `${raceName} · ${className}`,
        race: raceName,
        raceEn,
        className,
        file: `${dir.name}/${file}`, // 相对 public/image/player 的路径
      });
    }
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(null); }
    });
  });
}

// ============ 静态文件托管（替代原来的 nginx） ============

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

// 这些文本类型压缩收益明显（json-visualizer 打包后有250KB+），二进制/图片不压缩
const GZIP_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.xml', '.svg']);

function cacheControlFor(pathname, ext) {
  // Next.js 的 /_next/static 产物文件名带内容哈希，可以永久缓存
  if (pathname.startsWith('/_next/static/')) return 'public, max-age=31536000, immutable';
  // HTML 不缓存，保证部署后用户刷新就能拿到新版本
  if (ext === '.html') return 'no-cache';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.otf', '.ttf', '.woff', '.woff2', '.mp3'].includes(ext)) {
    return 'public, max-age=2592000'; // 图片/字体 30天
  }
  if (['.js', '.mjs', '.css'].includes(ext)) return 'public, max-age=604800'; // 7天
  return 'public, max-age=3600';
}

// 对应原来 nginx 的 try_files $uri $uri.html $uri/index.html：
// 静态导出产物可能是 /tools/xxx.html 也可能是 /tools/xxx/index.html，两种都要能命中
function resolveStaticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // 非法编码，当404处理
  }

  const rel = path.normalize(decoded).replace(/^[/\\]+/, '');
  const base = path.resolve(STATIC_DIR, rel);

  // 防目录穿越：解析后的绝对路径必须仍然在静态目录内
  if (base !== STATIC_DIR && !base.startsWith(STATIC_DIR + path.sep)) return null;

  const candidates = decoded.endsWith('/')
    ? [path.join(base, 'index.html')]
    : [base, `${base}.html`, path.join(base, 'index.html')];

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return { file: candidate, size: stat.size };
    } catch {
      // 不存在就试下一个候选路径
    }
  }
  return null;
}

function sendStaticFile(req, res, found, statusCode = 200) {
  const ext = path.extname(found.file).toLowerCase();
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cacheControlFor(req.url || '/', ext),
  };

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const shouldGzip = acceptsGzip && GZIP_EXT.has(ext) && found.size >= 1024;

  if (shouldGzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(statusCode, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(found.file).pipe(zlib.createGzip()).pipe(res);
    return;
  }

  headers['Content-Length'] = found.size;
  res.writeHead(statusCode, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(found.file).pipe(res);
}

function sendNotFound(req, res) {
  const custom = resolveStaticFile('/404.html');
  if (custom) return sendStaticFile(req, res, custom, 404);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

// ============ WebSocket：先攻追踪器房间同步 ============

// noServer:true —— 不自己起HTTP服务，而是挂到下面那个统一的http服务上，
// 由 server.on('upgrade') 按路径决定这个升级请求是给房间同步(/ws)还是给Next.js的HMR
const wss = new WebSocket.Server({ noServer: true });

// 存储所有房间的数据（进程内存，容器重启会清空，这是已知限制）
const rooms = new Map();

// 广播函数：向房间内所有客户端发送消息
function broadcastToRoom(roomId, message, excludeClient = null) {
  wss.clients.forEach((client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.roomId === roomId &&
      client !== excludeClient
    ) {
      client.send(JSON.stringify(message));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('🔌 新客户端连接');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;

      console.log('📨 收到消息:', type, payload);

      switch (type) {
        case 'CREATE_ROOM': {
          // 主屏幕创建房间（或断线后重新连回同一个房间）
          const { roomId } = payload;
          const now = Date.now();
          const isReconnect = rooms.has(roomId);

          if (!isReconnect) {
            rooms.set(roomId, {
              roomId,
              characters: [],
              currentTurn: 0,
              roundNumber: 1,
              diceHistory: [],
              displayRoomInfoVisible: true,
              displayDiceHistoryVisible: true,
              displayRoundVisible: true,
              characterScale: 1,
              diceDisplayScale: 1,
              roomInfoScale: 1,
              diceHistoryScale: 1,
              createdAt: now,
              lastActivity: now,
              displayConnected: true,
            });
            console.log(`🏠 房间创建: ${roomId}`);
          } else {
            console.log(`🔁 主屏幕重新连接到已存在房间: ${roomId}`);
          }

          const room = rooms.get(roomId);
          room.lastActivity = now;
          room.displayConnected = true;

          ws.roomId = roomId;
          ws.isDisplay = true;

          ws.send(JSON.stringify({ type: 'ROOM_STATE', payload: room }));

          // 通知房间内所有遥控器：主屏幕已连接/重连
          if (isReconnect) {
            broadcastToRoom(roomId, { type: 'DISPLAY_STATUS', payload: { connected: true } }, ws);
          }
          break;
        }

        case 'JOIN_ROOM': {
          // 遥控器加入房间
          const { roomId } = payload;

          if (!rooms.has(roomId)) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '房间不存在' } }));
            console.log(`❌ 尝试加入不存在的房间: ${roomId}`);
            return;
          }

          const room = rooms.get(roomId);
          room.lastActivity = Date.now();

          ws.roomId = roomId;
          ws.isDisplay = false;

          console.log(`🎮 遥控器加入房间 ${roomId}`);

          ws.send(JSON.stringify({ type: 'ROOM_STATE', payload: room }));

          // 同步告知遥控器主屏幕当前的在线状态
          ws.send(JSON.stringify({
            type: 'DISPLAY_STATUS',
            payload: { connected: room.displayConnected !== false },
          }));
          break;
        }

        case 'UPDATE_ROOM': {
          // 更新房间状态（角色列表 / 当前回合 / 回合数 / 压暗强度等）
          const { roomId, updates } = payload;

          if (!rooms.has(roomId)) {
            console.log(`❌ 房间不存在: ${roomId}`);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '房间已失效，请重新连接' } }));
            return;
          }

          const room = rooms.get(roomId);
          Object.assign(room, updates);
          room.lastActivity = Date.now();
          rooms.set(roomId, room);

          console.log(`🔄 房间更新: ${roomId}`, Object.keys(updates));

          broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
          break;
        }

        case 'DICE_HISTORY_APPEND': {
          // 历史只由遥控器在“收起”时提交；服务器保存到房间内存并广播ROOM_STATE，供主屏幕展示。
          const { roomId, entry } = payload;
          if (!rooms.has(roomId) || !entry
            || typeof entry.id !== 'string'
            || typeof entry.recordedAt !== 'string'
            || typeof entry.label !== 'string'
            || typeof entry.expression !== 'string'
            || typeof entry.finalTotal !== 'number'
            || !Array.isArray(entry.rerolls)) return;
          const room = rooms.get(roomId);
          const history = Array.isArray(room.diceHistory) ? room.diceHistory : [];
          // 初次结果立即写入；重投结果会带相同id再次提交，从而覆盖成最新点数与重投明细。
          room.diceHistory = [entry, ...history.filter((item) => item && item.id !== entry.id)].slice(0, 50);
          room.lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
          break;
        }

        case 'DICE_HISTORY_CLEAR': {
          const { roomId } = payload;
          if (!rooms.has(roomId)) return;
          const room = rooms.get(roomId);
          room.diceHistory = [];
          room.lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
          break;
        }

        case 'DICE_ROLL': {
          // 遥控器发起一次掷骰请求：只做转发广播，不存进房间状态里
          // （掷骰是一次性事件，不是需要持久化的房间数据，房间重连/刷新时不需要重放上一次的投骰动画）。
          // 广播给房间内所有客户端（包括主屏幕和其他遥控器），主屏幕收到后播放3D动画，
          // 遥控器收到后进入"等待结果"状态。
          // shapeTextures 是按形状(d4/d6/d8/d10/d12/d20)单独指定的纹理，一并转发给主屏幕决定3D骰子的样式。
          // 不再需要颜色方案(colorset)——纹理图本身盖住骰子表面，颜色对最终视觉没有影响。
          // recipe 是可选的"自定义表达式配方"(骰子分组+kh/kl取高取低+符号，不含完整语法树)，
          // 只有遥控器"自定义掷骰"标签页用表达式发起投掷时才会带上；服务器只管转发，不解析内容，
          // 主屏幕拿到后据此重新计算kh/kl明细，决定给哪几颗骰子加发光描边。
          const { roomId, id, notation, shapeTextures, recipe, label, expression } = payload;
          if (!rooms.has(roomId)) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '房间已失效，请重新连接' } }));
            return;
          }
          rooms.get(roomId).lastActivity = Date.now();
          console.log(`🎲 掷骰请求: ${roomId} ${notation}`);
          broadcastToRoom(roomId, { type: 'DICE_ROLL', payload: { id, notation, shapeTextures, recipe, label, expression } });
          break;
        }

        case 'DICE_ROLL_RESULT': {
          // 主屏幕算完3D骰子动画的结果后，把结构化结果广播回房间内所有客户端，
          // 遥控器据此展示每组小计+总和的文字结果。
          const { roomId, id, notation, result } = payload;
          if (!rooms.has(roomId)) return;
          rooms.get(roomId).lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'DICE_ROLL_RESULT', payload: { id, notation, result } });
          break;
        }

        case 'DICE_DIE_REROLL': {
          // 重投请求可包含多颗骰子；服务器只转发，主屏幕会校验本轮可用骰子并一次性播放动画。
          const { roomId, rollId, requestId, dieIds } = payload;
          if (!rooms.has(roomId)) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '房间已失效，请重新连接' } }));
            return;
          }
          rooms.get(roomId).lastActivity = Date.now();
          console.log(`🎲 重投请求: ${roomId} 骰子#${Array.isArray(dieIds) ? dieIds.join(', ') : ''}`);
          broadcastToRoom(roomId, { type: 'DICE_DIE_REROLL', payload: { rollId, requestId, dieIds } });
          break;
        }

        case 'DICE_DIE_REROLL_RESULT': {
          // 主屏幕广播一次批量重投后的完整结果和已使用重投机会的骰子列表。
          const { roomId, id, requestId, notation, result, rerolledDieIds, rerolls } = payload;
          if (!rooms.has(roomId)) return;
          rooms.get(roomId).lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'DICE_DIE_REROLL_RESULT', payload: { id, requestId, notation, result, rerolledDieIds, rerolls } });
          break;
        }

        case 'DICE_ROLL_DISMISS': {
          // 任意一端（通常是遥控器点"收起"）主动关闭结果展示：转发给房间内所有客户端，
          // 主屏幕收到后立刻收起全屏遮罩，不用等倒计时自然结束；
          // 其他遥控器收到后也同步清掉自己本地展示的结果横幅，保持所有端一致。
          const { roomId, id } = payload;
          if (!rooms.has(roomId)) return;
          rooms.get(roomId).lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'DICE_ROLL_DISMISS', payload: { id } });
          break;
        }

        case 'PING': {
          // 心跳也算"活动"：只要客户端还连着、还在正常发心跳，就不该被当成"空闲房间"清理掉。
          // 没有这一行的话，一个打开了很久但角色/回合数一直没变化的房间，光靠心跳是保不住的，
          // 1小时后会被下面的定时清理误删，即使遥控器和主屏幕其实都还稳稳连着。
          if (ws.roomId && rooms.has(ws.roomId)) {
            rooms.get(ws.roomId).lastActivity = Date.now();
          }
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }

        default:
          console.log(`⚠️ 未知消息类型: ${type}`);
      }
    } catch (error) {
      console.error('❌ 消息处理错误:', error);
      ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '服务器错误' } }));
    }
  });

  ws.on('close', () => {
    if (ws.roomId) {
      console.log(`👋 客户端断开连接 (房间: ${ws.roomId})`);

      // 如果是主屏幕断开，只标记状态、不删除房间数据，
      // 房间数据保留等待主屏幕刷新重连（走CREATE_ROOM的重连分支）
      if (ws.isDisplay && rooms.has(ws.roomId)) {
        console.log(`⚠️ 主屏幕断开，保留房间数据等待重连: ${ws.roomId}`);
        const room = rooms.get(ws.roomId);
        room.displayConnected = false;
        room.lastActivity = Date.now();

        broadcastToRoom(ws.roomId, { type: 'DISPLAY_STATUS', payload: { connected: false } });
      }
    } else {
      console.log('👋 客户端断开连接');
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket错误:', error);
  });
});

// 房间是否还有客户端连着（主屏幕或遥控器，任意一个OPEN状态的连接都算）。
// 清理时优先看这个，而不是只看lastActivity时间戳——
// 只要还有人连着，这个房间就不该被清理，不管战斗数据本身多久没变化过。
function roomHasLiveClients(roomId) {
  for (const client of wss.clients) {
    if (client.roomId === roomId && client.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

// 房间空闲多久、多久检查一次，都可以通过环境变量调（方便测试，生产默认值不变：1小时/5分钟）
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 60 * 60 * 1000);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 5 * 60 * 1000);

// 定期清理过期房间：只清理"没有任何客户端连接、且超过ROOM_IDLE_MS无活动"的房间。
// 有主屏幕或遥控器连着的房间永远不会被这个定时器清理，不管开着放多久不动。
const cleanupTimer = setInterval(() => {
  const now = Date.now();

  rooms.forEach((room, roomId) => {
    if (roomHasLiveClients(roomId)) return; // 还有人连着，跳过

    const lastActive = room.lastActivity || room.createdAt;
    if (now - lastActive > ROOM_IDLE_MS) {
      console.log(`🗑️ 清理过期房间（无人连接且长时间无活动）: ${roomId}`);
      rooms.delete(roomId);
    }
  });
}, CLEANUP_INTERVAL_MS);

// ============ 启动统一服务 ============

async function main() {
  // 开发模式：把页面请求交给 Next.js dev server 处理（保留HMR热更新）
  let nextRequestHandler = null;
  let nextUpgradeHandler = null;

  if (DEV) {
    // 只在开发模式require，生产镜像里没装next也不会报错
    const next = require('next');
    const app = next({ dev: true, dir: PROJECT_ROOT });
    await app.prepare();
    nextRequestHandler = app.getRequestHandler();
    // Next.js的HMR也是走WebSocket(/_next/webpack-hmr)，
    // 拿到它的upgrade处理器，才能和房间同步的/ws共存在同一个端口上
    nextUpgradeHandler = app.getUpgradeHandler();
  } else if (!fs.existsSync(STATIC_DIR)) {
    console.error(`❌ 找不到静态产物目录: ${STATIC_DIR}`);
    console.error('   请先执行 npm run build，或用 npm run dev 启动开发模式');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    } catch {
      // URL解析失败就按根路径兜底
    }

    try {
      // 1) 图片清单接口：放在最前面，避免被静态文件/Next路由抢先处理
      if (pathname === '/api/enemies') return sendJson(res, getEnemyList());
      if (pathname === '/api/player-images') return sendJson(res, getPlayerImageList());
      if (pathname === '/api/health') {
        return sendJson(res, { ok: true, dev: DEV, rooms: rooms.size });
      }
      // 房间列表：主屏幕刚打开时用这个展示"还在跑的房间"，方便断线/设备没电后选择回到原来的房间，
      // 而不是只能盯着一个新生成的空房间号从头开始。
      // 安全提示：这会把所有当前存在的房间号列出来，等同于把"猜房间号"这道门槛去掉了，
      // 只适合内网/朋友间使用的场景，不建议在完全公开的部署上开这个接口。
      if (pathname === '/api/rooms') {
        const list = Array.from(rooms.values())
          .map((room) => ({
            roomId: room.roomId,
            characterCount: room.characters.length,
            roundNumber: room.roundNumber,
            displayConnected: room.displayConnected !== false,
            lastActivity: room.lastActivity || room.createdAt,
          }))
          .sort((a, b) => b.lastActivity - a.lastActivity);
        return sendJson(res, list);
      }

      // 省钱记录 API
      if (pathname === '/api/savings') {
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (!body || !body.date || !body.time || !body.activity || !body.item || body.amount == null) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: '缺少必填字段' }));
          }
          const records = loadSavings();
          const record = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
            date: body.date,
            time: body.time,
            activity: body.activity,
            item: body.item,
            amount: Number(body.amount),
            createdAt: new Date().toISOString(),
          };
          records.push(record);
          saveSavings(records);
          return sendJson(res, record);
        }
        if (req.method === 'DELETE') {
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const id = url.searchParams.get('id');
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: '缺少 id 参数' }));
          }
          let records = loadSavings();
          records = records.filter((r) => r.id !== id);
          saveSavings(records);
          return sendJson(res, { success: true });
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          if (!body || !body.id) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: '缺少 id 参数' }));
          }
          let records = loadSavings();
          const idx = records.findIndex((r) => r.id === body.id);
          if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: '记录不存在' }));
          }
          records[idx] = { ...records[idx], ...body, id: records[idx].id, createdAt: records[idx].createdAt };
          saveSavings(records);
          return sendJson(res, records[idx]);
        }
        // GET: 返回全部记录
        return sendJson(res, loadSavings());
      }

      // 2) 页面：开发交给Next dev server，生产读静态产物
      if (DEV) return nextRequestHandler(req, res);

      const found = resolveStaticFile(pathname);
      if (!found) return sendNotFound(req, res);
      return sendStaticFile(req, res, found);
    } catch (error) {
      console.error('❌ 请求处理错误:', pathname, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('500 Internal Server Error');
    }
  });

  // WebSocket升级请求分流：/ws 给房间同步，其余（开发模式下的 /_next/webpack-hmr）给Next.js
  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      // 解析失败直接走下面的拒绝分支
    }

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    if (DEV && nextUpgradeHandler) {
      nextUpgradeHandler(req, socket, head);
      return;
    }

    socket.destroy();
  });

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log(`🚀 BOX 服务已启动（${DEV ? '开发' : '生产'}模式，单端口）`);
    console.log(`   本机访问:   http://localhost:${PORT}`);
    console.log(`   WebSocket:  ws://localhost:${PORT}/ws`);
    console.log(`   图片目录:   ${IMAGE_DIR}`);
    if (!DEV) console.log(`   静态产物:   ${STATIC_DIR}`);
    console.log('');
  });

  // 优雅关闭
  const shutdown = () => {
    console.log('\n👋 正在关闭服务器...');
    clearInterval(cleanupTimer);
    wss.clients.forEach((client) => client.close());
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
