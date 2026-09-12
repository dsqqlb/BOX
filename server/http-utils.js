'use strict';

/**
 * HTTP 通用工具：JSON 响应、请求体读取、同源校验、路径规范化、
 * 工具 slug 与受保护资源的映射，以及未登录重定向。
 */

const path = require('path');
const { TOOL_SLUG_SET } = require('./config');

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
  if (pathname === '/api/enemies' || pathname === '/api/player-images' || pathname === '/api/rooms' || pathname.startsWith('/api/initiative/')) return 'initiative-tracker';
  if (pathname === '/api/savings') return 'savings-tracker';
  if (pathname.startsWith('/api/carcassonne/')) return 'carcassonne';
  // 注意顺序：/api/edh-life/ 必须先于 /api/edh/ 判断，否则会被当成 EDH 组卡台（edh-builder）。
  if (pathname.startsWith('/api/edh-life/')) return 'edh-life';
  if (pathname.startsWith('/api/edh/')) return 'edh-builder';
  if (pathname === '/api/dnd/save') return 'dnd-character';
  if (pathname.startsWith('/api/kards/')) return 'kards';
  if (pathname.startsWith('/api/chat/')) return 'lan-chat';
  if (pathname.startsWith('/api/medicine/')) return 'medicine-inventory';
  if (pathname.startsWith('/api/holdem/')) return 'texas-holdem';
  // 静态站点管理需要 static-sites 权限；但 /api/sites/grant 是访客查看「仅登录可见」站点的
  // 授权入口，只要求登录，不要求管理权限，因此单独排除。
  if (pathname === '/api/sites/grant') return null;
  if (pathname === '/api/sites' || pathname.startsWith('/api/sites/')) return 'static-sites';
  return null;
}

function requiredToolForStaticAsset(pathname) {
  if (pathname.startsWith('/image/enemies/') || pathname.startsWith('/image/player/')) return 'initiative-tracker';
  if (pathname.startsWith('/image/tarot/')) return 'tarot-reading';
  if (pathname.startsWith('/image/Kards/')) return 'kards';
  if (pathname.startsWith('/dnd/')) return 'dnd-character';
  if (pathname.startsWith('/carcassonne-assets/')) return 'carcassonne';
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

module.exports = {
  sendJson,
  sendAuthError,
  readRawBody,
  readBody,
  isSameOrigin,
  canonicalizePathname,
  normalizedPagePath,
  toolSlugForPath,
  requiredToolForApi,
  requiredToolForStaticAsset,
  safeReturnPath,
  redirectToLogin,
};
