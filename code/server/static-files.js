'use strict';

/**
 * 静态文件托管（替代原来的 nginx）：MIME 映射、gzip、目录穿越防护与缓存策略。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { STATIC_DIR, PUBLIC_DIR, DND_APP_DIR, DEV } = require('./config');

// 静态查找根目录。资源类（图片、字体、骰子素材等）只有一份，放在 resources/public，
// 不再复制进构建产物；生产环境用 code/out 提供页面与 /_next，其余回退到 resources/public。
// 开发环境只查 resources/public：页面和 /_next 由 Next.js dev server 处理，
// 否则上一次 build 留下的 code/out 会抢先生效，看不到热更新。
const STATIC_ROOTS = DEV ? [PUBLIC_DIR] : [STATIC_DIR, PUBLIC_DIR];

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
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  // 静态站点常用的音视频与其他类型：缺失时浏览器会拿到 octet-stream 而无法播放/执行。
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.vtt': 'text/vtt; charset=utf-8',
  '.wasm': 'application/wasm',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.apng': 'image/apng',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

/** 按扩展名取 MIME，未知类型回落到 octet-stream（配合 nosniff 避免被浏览器猜成可执行类型）。 */
function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

// 这些文本类型压缩收益明显（json-visualizer 打包后有250KB+），二进制/图片不压缩
const GZIP_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.xml', '.svg']);

/** 在单个根目录内解析文件，并保证结果没有越过这个根目录。 */
function resolveWithinRoot(root, rel) {
  const base = path.resolve(root, rel);

  // 防目录穿越：解析后的绝对路径必须仍然在根目录内
  if (base !== root && !base.startsWith(root + path.sep)) return null;

  const candidates = rel.endsWith(path.sep)
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
  for (const root of STATIC_ROOTS) {
    const found = resolveWithinRoot(root, rel);
    if (found) return found;
  }
  return null;
}

/**
 * 角色卡独立应用专用：只匹配 URL 前缀 /dnd/。
 * 它按代码类存放在 code/dnd-app，因此不能走通用 STATIC_ROOTS：
 * 一个是它不属于资源目录，另一个是它必须先于 resources/public 判定，避免同名文件互相遮挡。
 * 返回的路径已经过 resolveWithinRoot 的越界校验，/dnd/../ 这类请求不会逃出应用目录。
 */
function resolveWithinDndApp(pathname) {
  if (!pathname.startsWith('/dnd/')) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // 非法编码，当404处理
  }

  const rel = path.normalize(decoded).replace(/^[/\\]+/, '').slice(4); // 去掉 `dnd/` 前缀
  return resolveWithinRoot(DND_APP_DIR, rel);
}

// 静态资源缓存策略：
// - /_next/static/* 是构建产物，文件名带内容哈希，URL一变即内容一变，可以放心长期缓存（immutable），
//   浏览器本地缓存后局域网/内网加载会明显变快；
// - 其余（HTML/图片等）保持 no-store：HTML 要实时反映最新构建，图片要支持"加图后刷新页面即生效"。
function cacheControlFor(pathname) {
  if (pathname.startsWith('/_next/static/')) return 'private, max-age=31536000, immutable';
  return 'private, no-store';
}

function sendStaticFile(req, res, found, statusCode = 200, cacheControl = 'private, no-store') {
  const ext = path.extname(found.file).toLowerCase();
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    // 所有静态资源都已在外层通过 Cookie 鉴权；用 private 而非 public，避免代理向未授权请求复用已认证响应。
    'Cache-Control': cacheControl,
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

module.exports = {
  MIME_TYPES,
  GZIP_EXT,
  mimeTypeFor,
  STATIC_ROOTS,
  resolveStaticFile,
  resolveWithinDndApp,
  cacheControlFor,
  sendStaticFile,
  sendNotFound,
};
