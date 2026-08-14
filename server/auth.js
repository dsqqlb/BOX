'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_COOKIE_NAME = 'box_session';
const SESSION_TTL_SECONDS = Number(process.env.BOX_SESSION_TTL_SECONDS || 12 * 60 * 60);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const loginAttempts = new Map();

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator < 0) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function parsePasswordHash(passwordHash) {
  const [algorithm, nText, rText, pText, salt, hash] = String(passwordHash || '').split('$');
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (algorithm !== 'scrypt' || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)
    || N < 16384 || N > 1048576 || r < 1 || r > 32 || p < 1 || p > 16 || !salt || !hash) {
    return null;
  }
  return { N, r, p, salt, hash };
}

function createAuth({ projectRoot, isProduction }) {
  const sessionSecret = process.env.BOX_SESSION_SECRET;
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('必须设置至少 32 字节的 BOX_SESSION_SECRET，认证服务不会以不安全配置启动。');
  }

  const usersFile = path.resolve(process.env.BOX_AUTH_USERS_FILE || path.join(projectRoot, 'data', 'auth-users.json'));
  const cookieSecure = process.env.BOX_COOKIE_SECURE === 'true' || (isProduction && process.env.BOX_COOKIE_SECURE !== 'false');

  function loadUsers() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    } catch (error) {
      throw new Error(`无法读取账户配置 ${usersFile}：${error.message}`);
    }
    if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) {
      throw new Error(`账户配置 ${usersFile} 中必须至少包含一个用户。`);
    }

    const users = new Map();
    for (const entry of parsed.users) {
      const username = typeof entry?.username === 'string' ? entry.username.trim() : '';
      const passwordHash = typeof entry?.passwordHash === 'string' ? entry.passwordHash : '';
      const permissions = Array.isArray(entry?.permissions) ? entry.permissions.filter((item) => typeof item === 'string') : [];
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/.test(username) || !parsePasswordHash(passwordHash) || permissions.length === 0 || users.has(username)) {
        throw new Error(`账户配置 ${usersFile} 包含无效或重复的账户。`);
      }
      users.set(username, { username, passwordHash, permissions });
    }
    return users;
  }

  function sign(value) {
    return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  }

  function createSession(user) {
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const payload = base64url(JSON.stringify({ username: user.username, expiresAt, nonce: crypto.randomBytes(16).toString('base64url') }));
    return `${payload}.${sign(payload)}`;
  }

  function getUserFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!session || typeof session.username !== 'string' || !Number.isInteger(session.expiresAt) || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
      return loadUsers().get(session.username) || null;
    } catch {
      return null;
    }
  }

  function verifyPassword(user, password) {
    const config = parsePasswordHash(user.passwordHash);
    if (!config || typeof password !== 'string' || password.length === 0 || password.length > 1024) return false;
    const actual = crypto.scryptSync(password, Buffer.from(config.salt, 'base64url'), 64, {
      N: config.N,
      r: config.r,
      p: config.p,
      maxmem: Math.max(128 * config.N * config.r + 16 * 1024 * 1024, 32 * 1024 * 1024),
    }).toString('base64url');
    return safeEqual(actual, config.hash);
  }

  function clientKey(req) {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  }

  function loginAllowed(req) {
    const attempt = loginAttempts.get(clientKey(req));
    if (!attempt) return { allowed: true, retryAfterSeconds: 0 };
    const elapsed = Date.now() - attempt.startedAt;
    if (elapsed >= LOGIN_WINDOW_MS) {
      loginAttempts.delete(clientKey(req));
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (attempt.count < MAX_LOGIN_FAILURES) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000) };
  }

  function recordLoginFailure(req) {
    const key = clientKey(req);
    const current = loginAttempts.get(key);
    if (!current || Date.now() - current.startedAt >= LOGIN_WINDOW_MS) {
      loginAttempts.set(key, { count: 1, startedAt: Date.now() });
    } else {
      current.count += 1;
    }
  }

  function clearLoginFailures(req) {
    loginAttempts.delete(clientKey(req));
  }

  function hasToolAccess(user, toolSlug) {
    return Boolean(user && user.permissions.some((permission) => permission === '*' || permission === toolSlug || toolSlug.startsWith(`${permission}/`)));
  }

  function buildSessionCookie(token) {
    const attributes = [
      `${SESSION_COOKIE_NAME}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${SESSION_TTL_SECONDS}`,
    ];
    if (cookieSecure) attributes.push('Secure');
    return attributes.join('; ');
  }

  function clearSessionCookie() {
    const attributes = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (cookieSecure) attributes.push('Secure');
    return attributes.join('; ');
  }

  return {
    clearLoginFailures,
    clearSessionCookie,
    createSession,
    getUserFromRequest,
    hasToolAccess,
    loadUsers,
    loginAllowed,
    recordLoginFailure,
    sessionCookieName: SESSION_COOKIE_NAME,
    buildSessionCookie,
    verifyPassword,
  };
}

module.exports = { createAuth };
