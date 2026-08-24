'use strict';

/**
 * 静态文件托管（替代原来的 nginx）：MIME 映射、gzip、目录穿越防护与缓存策略。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { STATIC_DIR } = require('./config');

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

module.exports = { resolveStaticFile, cacheControlFor, sendStaticFile, sendNotFound };
