'use strict';

const crypto = require('crypto');
const { prisma } = require('./db');

const SESSION_COOKIE_NAME = 'box_session';
const SESSION_TTL_SECONDS = Number(process.env.BOX_SESSION_TTL_SECONDS || 12 * 60 * 60);
// 「仅登录可见」静态站点的跨源访问凭证：静态站点在独立域名下，拿不到主站的 box_session，
// 因此由主站签发一枚短期令牌，再在站点域名下换成自己的 Cookie。有效期短，权限被收回后很快失效。
const SITE_ACCESS_COOKIE_NAME = 'box_site_access';
const SITE_ACCESS_TTL_SECONDS = Math.min(Math.max(Number(process.env.BOX_SITE_ACCESS_TTL_SECONDS || 3600), 60), 12 * 60 * 60);
// 授权跳转用的一次性令牌只在极短时间内有效，避免链接被复制后长期可用。
const SITE_GRANT_TTL_SECONDS = 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const loginAttempts = new Map();

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function safeEqual(left, right) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function parseCookies(cookieHeader = '') { return cookieHeader.split(';').reduce((cookies, item) => { const at = item.indexOf('='); if (at < 0) return cookies; const key = item.slice(0, at).trim(); if (key) cookies[key] = item.slice(at + 1).trim(); return cookies; }, {}); }

function parsePasswordHash(passwordHash) {
  const [algorithm, nText, rText, pText, salt, hash] = String(passwordHash || '').split('$');
  const N = Number(nText); const r = Number(rText); const p = Number(pText);
  if (algorithm !== 'scrypt' || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 16384 || N > 1048576 || r < 1 || r > 32 || p < 1 || p > 16 || !salt || !hash) return null;
  return { N, r, p, salt, hash };
}

function toUser(record) { return { username: record.username, passwordHash: record.passwordHash, sessionRevision: record.sessionRevision, permissions: record.permissions.map((entry) => entry.permission) }; }

function createAuth({ isProduction }) {
  const sessionSecret = process.env.BOX_SESSION_SECRET;
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) throw new Error('必须设置至少 32 字节的 BOX_SESSION_SECRET，认证服务不会以不安全配置启动。');

  function isHttpsRequest(req) { return Boolean(req?.socket?.encrypted) || String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase().split(',')[0].trim() === 'https'; }
  function resolveCookieSecure(req) { return isHttpsRequest(req) && process.env.BOX_COOKIE_SECURE !== 'false'; }

  async function loadUsers() {
    const records = await prisma.user.findMany({ include: { permissions: { select: { permission: true } } } });
    if (records.length === 0) throw new Error('SQLite 数据库中必须至少包含一个账户。请先运行 npm run db:import-json。');
    const users = new Map();
    for (const record of records) {
      const user = toUser(record);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/.test(user.username) || !parsePasswordHash(user.passwordHash) || !Number.isInteger(user.sessionRevision) || user.sessionRevision < 0 || user.permissions.length === 0 || users.has(user.username)) throw new Error('SQLite 数据库包含无效或重复的账户。');
      users.set(user.username, user);
    }
    return users;
  }

  function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'); }

  // ---- 静态站点跨源访问凭证 ----
  function issueSignedToken(claims, ttlSeconds) {
    const payload = base64url(JSON.stringify({ ...claims, expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds, nonce: crypto.randomBytes(12).toString('base64url') }));
    return `${payload}.${sign(payload)}`;
  }
  function readSignedToken(token, kind) {
    if (typeof token !== 'string' || token.length > 2048 || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!claims || claims.kind !== kind || typeof claims.username !== 'string' || !claims.username) return null;
      if (!Number.isInteger(claims.expiresAt) || claims.expiresAt <= Math.floor(Date.now() / 1000)) return null;
      return claims;
    } catch { return null; }
  }
  /** 主站签发的一次性授权令牌，随重定向传给站点域名。 */
  function createSiteGrantToken(username) { return issueSignedToken({ kind: 'site-grant', username }, SITE_GRANT_TTL_SECONDS); }
  function verifySiteGrantToken(token) { return readSignedToken(token, 'site-grant'); }
  /** 站点域名下实际使用的访问凭证。 */
  function createSiteAccessToken(username) { return issueSignedToken({ kind: 'site-access', username }, SITE_ACCESS_TTL_SECONDS); }
  function getSiteAccessFromRequest(req) { return readSignedToken(parseCookies(req.headers.cookie)[SITE_ACCESS_COOKIE_NAME], 'site-access'); }
  function buildSiteAccessCookie(token, req) {
    // SameSite=Lax：从主站跳转回站点域名时要能带上，且它只用于读取访客本就有权查看的静态页面。
    const attributes = [`${SITE_ACCESS_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SITE_ACCESS_TTL_SECONDS}`];
    if (resolveCookieSecure(req)) attributes.push('Secure');
    return attributes.join('; ');
  }
  function createSession(user) { const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS; const payload = base64url(JSON.stringify({ username: user.username, expiresAt, sessionRevision: user.sessionRevision, nonce: crypto.randomBytes(16).toString('base64url') })); return `${payload}.${sign(payload)}`; }

  async function getUserFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!session || typeof session.username !== 'string' || !Number.isInteger(session.expiresAt) || !Number.isInteger(session.sessionRevision) || session.sessionRevision < 0 || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
      const user = await prisma.user.findUnique({ where: { username: session.username }, include: { permissions: { select: { permission: true } } } });
      return user && user.sessionRevision === session.sessionRevision ? toUser(user) : null;
    } catch { return null; }
  }

  function verifyPassword(user, password) { const config = parsePasswordHash(user.passwordHash); if (!config || typeof password !== 'string' || password.length === 0 || password.length > 1024) return false; const actual = crypto.scryptSync(password, Buffer.from(config.salt, 'base64url'), 64, { N: config.N, r: config.r, p: config.p, maxmem: Math.max(128 * config.N * config.r + 16 * 1024 * 1024, 32 * 1024 * 1024) }).toString('base64url'); return safeEqual(actual, config.hash); }
  function clientKey(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(); }
  function loginAllowed(req) { const attempt = loginAttempts.get(clientKey(req)); if (!attempt) return { allowed: true, retryAfterSeconds: 0 }; const elapsed = Date.now() - attempt.startedAt; if (elapsed >= LOGIN_WINDOW_MS) { loginAttempts.delete(clientKey(req)); return { allowed: true, retryAfterSeconds: 0 }; } return attempt.count < MAX_LOGIN_FAILURES ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000) }; }
  function recordLoginFailure(req) { const key = clientKey(req); const current = loginAttempts.get(key); if (!current || Date.now() - current.startedAt >= LOGIN_WINDOW_MS) loginAttempts.set(key, { count: 1, startedAt: Date.now() }); else current.count += 1; }
  function clearLoginFailures(req) { loginAttempts.delete(clientKey(req)); }
  // 局域网大厅是登录后的公共工作区：所有有效账户均可访问；其余工具仍按明确权限控制。
  function hasToolAccess(user, toolSlug) { return Boolean(user && (toolSlug === 'lan-chat' || user.permissions.some((permission) => permission === '*' || permission === toolSlug || toolSlug.startsWith(`${permission}/`)))); }
  function buildSessionCookie(token, req) { const attributes = [`${SESSION_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_TTL_SECONDS}`]; if (resolveCookieSecure(req)) attributes.push('Secure'); return attributes.join('; '); }
  function clearSessionCookie(req) { const attributes = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']; if (resolveCookieSecure(req)) attributes.push('Secure'); return attributes.join('; '); }

  return { clearLoginFailures, clearSessionCookie, createSession, getUserFromRequest, hasToolAccess, loadUsers, loginAllowed, recordLoginFailure, sessionCookieName: SESSION_COOKIE_NAME, buildSessionCookie, verifyPassword, createSiteGrantToken, verifySiteGrantToken, createSiteAccessToken, getSiteAccessFromRequest, buildSiteAccessCookie, siteAccessTtlSeconds: SITE_ACCESS_TTL_SECONDS };
}
module.exports = { createAuth };
