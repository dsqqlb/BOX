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
const { createAuth } = require('./auth');

// Next.js 会在自身启动后读取 .env.local，但本文件在它之前运行；本地直接 `npm run dev`
// 时需要先加载认证配置。部署环境传入的同名变量优先，绝不被本地文件覆盖。
function loadLocalEnvironment() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    const [, key, rawValue] = match;
    const value = (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue;
    process.env[key] = value;
  }
}
loadLocalEnvironment();

// ============ 配置 ============

const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const PORT = Number(process.env.PORT || 9999);
const HOST = process.env.HOST || '0.0.0.0';

const PROJECT_ROOT = path.join(__dirname, '..');
// 静态产物目录（生产环境用）：next build + output:'export' 的产物
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(PROJECT_ROOT, 'out'));
// 图片目录：开发环境直接读 public/image；生产模式默认读取 out/image。
// 如需使用其他目录，可通过 IMAGE_DIR 显式指定。
const IMAGE_DIR = path.resolve(
  process.env.IMAGE_DIR || (DEV ? path.join(PROJECT_ROOT, 'public', 'image') : path.join(STATIC_DIR, 'image'))
);
const ENEMY_DIR = path.join(IMAGE_DIR, 'enemies');
const PLAYER_DIR = path.join(IMAGE_DIR, 'player');
const SAVINGS_FILE = path.join(PROJECT_ROOT, 'data', 'savings.json');

// 所有受保护工具的稳定路由标识。权限配置只使用这些标识，不使用可变的页面标题。
const TOOL_SLUGS = [
  'claude-code-guide',
  'dnd-translator',
  'initiative-tracker',
  'initiative-tracker/display',
  'json-visualizer',
  'tarot-reading',
  'savings-tracker',
  'css-cascade',
];
const TOOL_SLUG_SET = new Set(TOOL_SLUGS);
const auth = createAuth({ projectRoot: PROJECT_ROOT, isProduction: !DEV });
// 启动时立即校验账户文件，避免因漏挂载/错误配置而意外以无认证状态运行。
auth.loadUsers();

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

function sendJson(res, data, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function sendAuthError(res, statusCode, message) {
  return sendJson(res, { error: message }, statusCode);
}

function readRawBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

async function readBody(req) {
  const raw = await readRawBody(req);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function canonicalizePathname(pathname) {
  try {
    const decoded = decodeURIComponent(pathname);
    if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null;
    const normalized = path.posix.normalize(decoded);
    return normalized.startsWith('/') ? normalized : null;
  } catch {
    return null;
  }
}

function normalizedPagePath(pathname) {
  return pathname
    .replace(/\/index\.html$/, '/')
    .replace(/\.html$/, '')
    .replace(/\/+$/, '') || '/';
}

function toolSlugForPath(pathname) {
  const normalized = normalizedPagePath(pathname);
  if (!normalized.startsWith('/tools/')) return null;
  const slug = normalized.slice('/tools/'.length);
  return TOOL_SLUG_SET.has(slug) ? slug : null;
}

function requiredToolForApi(pathname) {
  if (pathname === '/api/enemies' || pathname === '/api/player-images' || pathname === '/api/rooms') return 'initiative-tracker';
  if (pathname === '/api/savings') return 'savings-tracker';
  return null;
}

function requiredToolForStaticAsset(pathname) {
  if (pathname.startsWith('/image/enemies/') || pathname.startsWith('/image/player/')) return 'initiative-tracker';
  if (pathname.startsWith('/image/tarot/')) return 'tarot-reading';
  return null;
}

function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return '/';
  return value;
}

function redirectToLogin(req, res) {
  const next = safeReturnPath(req.url || '/');
  res.writeHead(303, { Location: `/login?next=${encodeURIComponent(next)}`, 'Cache-Control': 'no-store' });
  res.end();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function sendLoginPage(res, hasError = false, nextPath = '/') {
  const escapedError = hasError ? '<p class="error" role="alert">用户名或密码错误，或登录尝试次数过多。</p>' : '';
  const escapedNext = escapeHtml(safeReturnPath(nextPath));
  const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>登录 · BOX</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box} body{margin:0;min-width:320px;min-height:100vh;overflow-x:hidden;background:#070915;color:#eef2ff}
    .scene{position:relative;isolation:isolate;display:grid;min-height:100vh;place-items:center;padding:28px 20px;background:radial-gradient(circle at 10% 0%,rgba(91,77,211,.31),transparent 31%),radial-gradient(circle at 88% 22%,rgba(8,145,178,.18),transparent 28%),linear-gradient(160deg,#11142e 0%,#090b1a 46%,#070915 100%)}
    .scene::before{content:"";pointer-events:none;position:absolute;z-index:-1;inset:0;opacity:.42;background-image:linear-gradient(rgba(148,163,184,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.09) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent 68%)}
    .orb{position:absolute;z-index:-1;border-radius:999px;filter:blur(68px);pointer-events:none}.orb.one{width:300px;height:300px;left:-110px;bottom:-80px;background:rgba(99,102,241,.18)}.orb.two{width:260px;height:260px;right:-90px;top:18%;background:rgba(34,211,238,.12)}
    .layout{width:min(100%,1010px);display:grid;grid-template-columns:1fr 420px;overflow:hidden;border:1px solid rgba(255,255,255,.11);border-radius:28px;background:rgba(13,16,37,.77);box-shadow:0 32px 100px rgba(0,0,0,.45);backdrop-filter:blur(20px)}
    .intro{position:relative;display:flex;min-height:470px;flex-direction:column;overflow:hidden;padding:42px;background:linear-gradient(145deg,rgba(113,91,238,.18),rgba(19,25,54,.04) 54%)}
    .intro::after{content:"";position:absolute;width:310px;height:310px;right:-140px;bottom:-140px;border:1px solid rgba(196,181,253,.22);border-radius:999px;box-shadow:0 0 0 36px rgba(167,139,250,.035),0 0 0 72px rgba(167,139,250,.025)}
    .brand{display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none}.brandmark{display:grid;width:42px;height:42px;place-items:center;border:1px solid rgba(255,255,255,.21);border-radius:13px;background:linear-gradient(135deg,#a78bfa,#4f46e5);box-shadow:0 10px 30px rgba(99,102,241,.36)}.brandmark svg{width:24px;height:24px}.brandname{font-size:15px;font-weight:800;letter-spacing:.2em}.brand small{display:block;margin-top:3px;color:#7781a5;font-size:9px;font-weight:700;letter-spacing:.16em}
    .intro-copy{position:relative;z-index:1;margin-top:auto}.eyebrow{display:flex;align-items:center;gap:8px;margin:0 0 14px;color:#a5f3fc;font-size:11px;font-weight:750;letter-spacing:.15em}.eyebrow::before{width:25px;height:1px;background:#67e8f9;content:""}.intro h1{max-width:360px;margin:0;color:#fff;font-size:clamp(28px,3.5vw,40px);line-height:1.14;letter-spacing:-.045em}.intro p{max-width:300px;margin:13px 0 0;color:#a8b0ca;font-size:14px;line-height:1.7}
    .login{display:flex;flex-direction:column;justify-content:center;padding:48px 44px;background:rgba(5,7,18,.33)}.login-head{margin-bottom:28px}.login-head h2{margin:0;color:#fff;font-size:24px;letter-spacing:-.03em}.login-head p{margin:9px 0 0;color:#8490af;font-size:13px;line-height:1.6}.error{margin:0 0 18px;border:1px solid rgba(251,113,133,.25);border-radius:11px;background:rgba(159,18,57,.16);padding:11px 12px;color:#fecdd3;font-size:12px;line-height:1.5}
    label{display:block;margin:18px 0 8px;color:#c6cee2;font-size:12px;font-weight:650}input{width:100%;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:rgba(1,4,14,.48);padding:12px 13px;color:#f8fafc;font:inherit;font-size:14px;outline:none;transition:border-color .2s,box-shadow .2s,background .2s}input:hover{border-color:rgba(255,255,255,.2)}input:focus{border-color:rgba(103,232,249,.7);background:rgba(1,4,14,.72);box-shadow:0 0 0 4px rgba(103,232,249,.1)}
    button{width:100%;margin-top:25px;border:0;border-radius:11px;background:linear-gradient(135deg,#a78bfa,#6366f1);padding:12px 16px;color:#fff;font:inherit;font-size:14px;font-weight:760;cursor:pointer;box-shadow:0 10px 26px rgba(79,70,229,.3);transition:transform .2s,filter .2s,box-shadow .2s}button:hover{filter:brightness(1.08);box-shadow:0 13px 30px rgba(79,70,229,.42);transform:translateY(-1px)}button:focus-visible{outline:2px solid #67e8f9;outline-offset:3px}.login-foot{margin:26px 0 0;color:#66718f;font-size:11px;line-height:1.65}.login-foot strong{color:#9ba6c5;font-weight:650}
    @media(max-width:760px){.scene{padding:18px}.layout{display:block;max-width:440px;border-radius:23px}.intro{min-height:auto;padding:24px 26px}.intro-copy{display:none}.login{padding:31px 26px 34px}.login-head{margin-bottom:24px}.orb.one{left:-170px}.orb.two{right:-160px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <main class="scene">
    <span class="orb one"></span><span class="orb two"></span>
    <section class="layout" aria-label="BOX 登录">
      <div class="intro">
        <a class="brand" href="/" aria-label="BOX 私有工作台"><span class="brandmark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 2.5 11 5.8v15.4L16 29.5 5 23.7V8.3L16 2.5Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M5.3 8.5 16 14.2 26.7 8.5M16 14.2v15" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="m11.5 11.8 4.5 2.4 4.5-2.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><span class="brandname">BOX</span><small>PRIVATE WORKSPACE</small></span></a>
        <div class="intro-copy"><div class="eyebrow">SECURE TOOL SPACE</div><h1>你的私人工具台。</h1><p>仅展示你已获授权的工具。</p></div>
      </div>
      <div class="login">
        <div class="login-head"><h2>欢迎回来</h2><p>使用已授权的账户继续进入，不支持注册</p></div>
        ${escapedError}
        <form method="post" action="/api/auth/login">
          <input type="hidden" name="next" value="${escapedNext}">
          <label for="username">用户名</label><input id="username" name="username" autocomplete="username" required maxlength="64" autofocus>
          <label for="password">密码</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="1024">
          <button type="submit">安全进入工作台 <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-foot"><strong>私有访问</strong> · 未获授权的账户无法查看工具及其数据。</p>
      </div>
    </section>
  </main>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  res.end(page);
}

function isAuthorizedForRequest(req, user, pathname) {
  const toolSlug = toolSlugForPath(pathname) || requiredToolForApi(pathname) || requiredToolForStaticAsset(pathname);
  return !toolSlug || auth.hasToolAccess(user, toolSlug);
}

function getAllowedToolSlugs(user) {
  return TOOL_SLUGS.filter((slug) => auth.hasToolAccess(user, slug));
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
    // 所有静态资源都已在外层通过 Cookie 鉴权；禁止共享缓存，避免代理向未授权请求复用已认证响应。
    'Cache-Control': 'private, no-store',
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
const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });

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

function sendWsError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ERROR', payload: { message } }));
}

function isCurrentRoomMember(ws, roomId) {
  return typeof roomId === 'string' && ws.roomId === roomId && rooms.has(roomId);
}

const ROOM_UPDATE_FIELDS = new Set([
  'characters', 'currentTurn', 'roundNumber', 'dimIntensity', 'resultPanelOpacity',
  'characterScale', 'diceDisplayScale', 'roomInfoScale', 'diceHistoryScale',
  'displayRoomInfoVisible', 'displayDiceHistoryVisible', 'displayRoundVisible',
]);

function sanitizeRoomUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return null;
  const safe = {};
  for (const [key, value] of Object.entries(updates)) {
    if (ROOM_UPDATE_FIELDS.has(key)) safe[key] = value;
  }
  return safe;
}

wss.on('connection', (ws) => {
  console.log('🔌 新客户端连接');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;

      if (!ws.user || !auth.hasToolAccess(ws.user, 'initiative-tracker')) {
        sendWsError(ws, '当前账户没有先攻追踪器权限。');
        ws.close(1008, 'Unauthorized');
        return;
      }

      console.log('📨 收到消息:', type, payload);

      switch (type) {
        case 'CREATE_ROOM': {
          // 主屏幕创建房间（或由同一账户断线后重连）。房间号仍由主屏选择，但必须是合法的六位数字。
          const { roomId } = payload || {};
          if (typeof roomId !== 'string' || !/^\d{6}$/.test(roomId)) {
            sendWsError(ws, '房间号无效。');
            return;
          }
          const now = Date.now();
          const isReconnect = rooms.has(roomId);

          if (isReconnect && rooms.get(roomId).ownerUsername !== ws.user.username) {
            sendWsError(ws, '只有创建该房间的账户可以作为主屏幕重连。');
            return;
          }

          if (!isReconnect) {
            rooms.set(roomId, {
              roomId,
              ownerUsername: ws.user.username,
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
          // 遥控器加入房间：必须持有先攻追踪器权限，且仅允许加入合法的现有房间。
          const { roomId } = payload || {};
          if (typeof roomId !== 'string' || !/^\d{6}$/.test(roomId)) {
            sendWsError(ws, '房间号无效。');
            return;
          }

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
          // 只有已加入该房间的遥控器可以更改共享战斗状态；字段白名单防止客户端覆盖房间所有权等内部字段。
          const { roomId, updates } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
            sendWsError(ws, '无权更新该房间。');
            return;
          }
          const safeUpdates = sanitizeRoomUpdates(updates);
          if (!safeUpdates || Object.keys(safeUpdates).length === 0) {
            sendWsError(ws, '没有可更新的房间字段。');
            return;
          }

          const room = rooms.get(roomId);
          Object.assign(room, safeUpdates);
          room.lastActivity = Date.now();

          console.log(`🔄 房间更新: ${roomId}`, Object.keys(safeUpdates));

          broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
          break;
        }

        case 'DICE_HISTORY_APPEND': {
          // 遥控器在初次结果和每次重投结果后提交历史；只有当前房间的遥控器可写入。
          const { roomId, entry } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay || !entry
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
          const { roomId } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
            sendWsError(ws, '无权清空该房间的历史记录。');
            return;
          }
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
          const { roomId, id, notation, shapeTextures, recipe, label, expression } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
            sendWsError(ws, '无权在该房间发起掷骰。');
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
          const { roomId, id, notation, result } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || !ws.isDisplay) {
            sendWsError(ws, '只有当前主屏幕可以发送掷骰结果。');
            return;
          }
          rooms.get(roomId).lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'DICE_ROLL_RESULT', payload: { id, notation, result } });
          break;
        }

        case 'DICE_DIE_REROLL': {
          // 重投请求可包含多颗骰子；服务器只转发，主屏幕会校验本轮可用骰子并一次性播放动画。
          const { roomId, rollId, requestId, dieIds } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
            sendWsError(ws, '无权在该房间请求重投。');
            return;
          }
          rooms.get(roomId).lastActivity = Date.now();
          console.log(`🎲 重投请求: ${roomId} 骰子#${Array.isArray(dieIds) ? dieIds.join(', ') : ''}`);
          broadcastToRoom(roomId, { type: 'DICE_DIE_REROLL', payload: { rollId, requestId, dieIds } });
          break;
        }

        case 'DICE_DIE_REROLL_RESULT': {
          // 主屏幕广播一次批量重投后的完整结果和已使用重投机会的骰子列表。
          const { roomId, id, requestId, notation, result, rerolledDieIds, rerolls } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || !ws.isDisplay) {
            sendWsError(ws, '只有当前主屏幕可以发送重投结果。');
            return;
          }
          rooms.get(roomId).lastActivity = Date.now();
          broadcastToRoom(roomId, { type: 'DICE_DIE_REROLL_RESULT', payload: { id, requestId, notation, result, rerolledDieIds, rerolls } });
          break;
        }

        case 'DICE_ROLL_DISMISS': {
          // 任意一端（通常是遥控器点"收起"）主动关闭结果展示：转发给房间内所有客户端，
          // 主屏幕收到后立刻收起全屏遮罩，不用等倒计时自然结束；
          // 其他遥控器收到后也同步清掉自己本地展示的结果横幅，保持所有端一致。
          const { roomId, id } = payload || {};
          if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
            sendWsError(ws, '无权收起该房间的骰盘。');
            return;
          }
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
    let requestUrl;
    let pathname = '/';
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = requestUrl.pathname;
    } catch {
      requestUrl = new URL('http://localhost/');
      // URL解析失败就按根路径兜底
    }
    pathname = canonicalizePathname(pathname);
    if (!pathname) {
      return sendAuthError(res, 400, '请求路径无效。');
    }

    try {
      // 登录页和认证接口是唯一允许匿名访问的 HTTP 入口；它们不依赖 Next.js，生产静态导出也可用。
      const requestUser = auth.getUserFromRequest(req);
      if (pathname === '/login' && req.method === 'GET') {
        if (requestUser) {
          res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
          return res.end();
        }
        return sendLoginPage(
          res,
          requestUrl.searchParams.get('error') === '1',
          safeReturnPath(requestUrl.searchParams.get('next') || '/'),
        );
      }

      if (pathname === '/api/auth/login') {
        if (req.method !== 'POST') return sendAuthError(res, 405, '只支持 POST 登录。');
        if (!isSameOrigin(req)) return sendAuthError(res, 403, '请求来源无效。');
        const attempt = auth.loginAllowed(req);
        if (!attempt.allowed) {
          res.writeHead(303, { Location: '/login?error=1', 'Retry-After': String(attempt.retryAfterSeconds), 'Cache-Control': 'no-store' });
          return res.end();
        }
        const raw = await readRawBody(req, 8 * 1024);
        const form = raw === null ? null : new URLSearchParams(raw);
        const username = form?.get('username')?.trim() || '';
        const password = form?.get('password') || '';
        const user = auth.loadUsers().get(username);
        if (!user || !auth.verifyPassword(user, password)) {
          auth.recordLoginFailure(req);
          res.writeHead(303, { Location: '/login?error=1', 'Cache-Control': 'no-store' });
          return res.end();
        }
        auth.clearLoginFailures(req);
        const next = safeReturnPath(form?.get('next') || '/');
        res.writeHead(303, {
          Location: next,
          'Set-Cookie': auth.buildSessionCookie(auth.createSession(user)),
          'Cache-Control': 'no-store',
        });
        return res.end();
      }

      if (pathname === '/api/auth/logout') {
        if (req.method !== 'POST') return sendAuthError(res, 405, '只支持 POST 登出。');
        if (!requestUser) return sendAuthError(res, 401, '尚未登录。');
        if (!isSameOrigin(req)) return sendAuthError(res, 403, '请求来源无效。');
        res.writeHead(204, { 'Set-Cookie': auth.clearSessionCookie(), 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (pathname === '/api/auth/me') {
        if (req.method !== 'GET') return sendAuthError(res, 405, '只支持 GET。');
        if (!requestUser) return sendAuthError(res, 401, '尚未登录。');
        return sendJson(res, { username: requestUser.username, allowedTools: getAllowedToolSlugs(requestUser) });
      }

      // 认证在所有业务 API、静态资源和开发页面之前执行，前端链接隐藏不是安全边界。
      if (!requestUser) {
        if (pathname.startsWith('/api/')) return sendAuthError(res, 401, '需要登录。');
        return redirectToLogin(req, res);
      }
      if (!isAuthorizedForRequest(req, requestUser, pathname)) {
        if (pathname.startsWith('/api/')) return sendAuthError(res, 403, '当前账户没有访问此工具的权限。');
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('403 无权访问此工具');
      }

      // 图片清单接口：在静态文件/Next路由前处理，但已通过先攻追踪器工具权限校验。
      if (pathname === '/api/enemies') return sendJson(res, getEnemyList());
      if (pathname === '/api/player-images') return sendJson(res, getPlayerImageList());
      if (pathname === '/api/health') {
        return sendJson(res, { ok: true, dev: DEV, rooms: rooms.size });
      }
      // 房间列表：仅拥有先攻追踪器权限的用户可访问。
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

      // 省钱记录 API：记录按登录账户隔离，任意写入操作都要求同源请求。
      if (pathname === '/api/savings') {
        if (req.method === 'POST') {
          if (!isSameOrigin(req)) return sendAuthError(res, 403, '请求来源无效。');
          const body = await readBody(req);
          if (!body || !body.date || !body.time || !body.activity || !body.item || body.amount == null || !Number.isFinite(Number(body.amount))) {
            return sendAuthError(res, 400, '缺少或包含无效的必填字段。');
          }
          const records = loadSavings();
          const record = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
            owner: requestUser.username,
            date: String(body.date),
            time: String(body.time),
            activity: String(body.activity),
            item: String(body.item),
            amount: Number(body.amount),
            createdAt: new Date().toISOString(),
          };
          records.push(record);
          if (!saveSavings(records)) return sendAuthError(res, 500, '保存记录失败。');
          return sendJson(res, record);
        }
        if (req.method === 'DELETE') {
          if (!isSameOrigin(req)) return sendAuthError(res, 403, '请求来源无效。');
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const id = url.searchParams.get('id');
          if (!id) return sendAuthError(res, 400, '缺少 id 参数。');
          const records = loadSavings();
          const index = records.findIndex((record) => record.id === id && record.owner === requestUser.username);
          if (index === -1) return sendAuthError(res, 404, '记录不存在。');
          records.splice(index, 1);
          if (!saveSavings(records)) return sendAuthError(res, 500, '删除记录失败。');
          return sendJson(res, { success: true });
        }
        if (req.method === 'PUT') {
          if (!isSameOrigin(req)) return sendAuthError(res, 403, '请求来源无效。');
          const body = await readBody(req);
          if (!body || typeof body.id !== 'string') return sendAuthError(res, 400, '缺少 id 参数。');
          const records = loadSavings();
          const index = records.findIndex((record) => record.id === body.id && record.owner === requestUser.username);
          if (index === -1) return sendAuthError(res, 404, '记录不存在。');
          const current = records[index];
          const next = {
            ...current,
            date: body.date == null ? current.date : String(body.date),
            time: body.time == null ? current.time : String(body.time),
            activity: body.activity == null ? current.activity : String(body.activity),
            item: body.item == null ? current.item : String(body.item),
            amount: body.amount == null ? current.amount : Number(body.amount),
          };
          if (!Number.isFinite(next.amount)) return sendAuthError(res, 400, '金额无效。');
          records[index] = next;
          if (!saveSavings(records)) return sendAuthError(res, 500, '更新记录失败。');
          return sendJson(res, next);
        }
        if (req.method !== 'GET') return sendAuthError(res, 405, '不支持的请求方法。');
        // 旧版未标记 owner 的记录不自动暴露给任何账户，管理员可自行迁移数据。
        return sendJson(res, loadSavings().filter((record) => record.owner === requestUser.username));
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
      pathname = canonicalizePathname(pathname);
    } catch {
      pathname = null;
    }

    if (pathname === '/ws') {
      // 浏览器 WebSocket 会附带同源 Cookie；拒绝跨站升级、未登录账户及缺少先攻权限的账户。
      const user = auth.getUserFromRequest(req);
      if (!isSameOrigin(req) || !user || !auth.hasToolAccess(user, 'initiative-tracker')) {
        const status = user ? '403 Forbidden' : '401 Unauthorized';
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.user = user;
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
