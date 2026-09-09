'use strict';

/**
 * 静态站点托管：只在「站点域名」（BOX_SITES_HOST）上生效，与 BOX 主站不同源。
 *
 * 为什么必须不同源：如果静态站点和 BOX 挂在同一个域名下，站点里的 JS 可以发同源请求
 * 调用 BOX 的接口，浏览器会带上访客的登录 Cookie——等于让任意上传的页面能以访客身份操作 BOX。
 * 放在独立域名后，Cookie 不会被发送，同源校验也不会通过。
 *
 * 「仅登录可见」站点的授权流程（会话 Cookie 属于主站域名，不会发到站点域名）：
 *   1. 访客访问 pages.example.com/secret/ ，没有站点访问凭证；
 *   2. 302 跳到主站 box.example.com/api/sites/grant?site=secret&return=... ；
 *   3. 主站校验会话（未登录则先去登录页），签发 60 秒一次性令牌，跳回站点域名；
 *   4. 站点域名 /__site-auth 校验令牌，换成自己的短期 Cookie，再跳回原地址。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const siteStore = require('./site-store');
const { mimeTypeFor, GZIP_EXT } = require('./static-files');
const { SITES_HOSTS, PRIMARY_HOST } = require('./config');

const SITE_AUTH_PATH = '/__site-auth';
const AUTH_RETRY_COOKIE = 'box_site_auth_try';

function normalizeHost(value) { return String(value || '').trim().toLowerCase(); }

/** 请求是否落在站点域名上。未配置 BOX_SITES_HOST 时整个托管功能关闭。 */
function isSitesHost(req) {
  if (!SITES_HOSTS.length) return false;
  return SITES_HOSTS.includes(normalizeHost(req.headers.host));
}

function isHttps(req) {
  return Boolean(req?.socket?.encrypted) || normalizeHost(String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0]) === 'https';
}

function hasRetryMarker(req) {
  return String(req.headers.cookie || '').split(';').some((item) => item.trim().startsWith(`${AUTH_RETRY_COOKIE}=`));
}

function retryCookie(req, set) {
  const attributes = set
    ? [`${AUTH_RETRY_COOKIE}=1`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=30']
    : [`${AUTH_RETRY_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps(req)) attributes.push('Secure');
  return attributes.join('; ');
}

function sendPlain(res, statusCode, message, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(message);
}

/** 站内路径解析：命中文件才返回，顺序与常见静态服务器一致。 */
async function resolveCandidate(siteName, relativePath) {
  let candidate;
  try { candidate = siteStore.resolveInsideSite(siteName, relativePath); }
  catch { return null; }
  // 站点配置文件不对外提供。
  if (candidate.relativePath.toLowerCase() === siteStore.SITE_CONFIG_FILE) return null;
  try {
    const stat = await fsp.stat(candidate.absolute);
    if (stat.isFile()) return { file: candidate.absolute, relativePath: candidate.relativePath, size: stat.size, mtime: stat.mtimeMs };
  } catch { /* 不存在则由调用方继续尝试下一个候选 */ }
  return null;
}

async function resolveSiteFile(siteName, rest) {
  const trimmed = rest.replace(/^\/+/, '');
  const candidates = !trimmed || trimmed.endsWith('/')
    ? [`${trimmed}index.html`]
    : [trimmed, `${trimmed}.html`, `${trimmed}/index.html`];
  for (const candidate of candidates) {
    const found = await resolveCandidate(siteName, candidate);
    if (found) return found;
  }
  return null;
}

function cacheControlFor(config) {
  // 「仅登录可见」的站点一律不缓存，避免中间代理把受限内容缓存给其他人。
  if (config.visibility === 'authenticated') return 'private, no-store';
  return config.cacheSeconds > 0 ? `public, max-age=${config.cacheSeconds}` : 'public, no-cache';
}

function sendFile(req, res, found, config, statusCode = 200) {
  const extension = path.extname(found.file).toLowerCase();
  const headers = {
    'Content-Type': mimeTypeFor(found.file),
    'Cache-Control': cacheControlFor(config),
    'X-Content-Type-Options': 'nosniff',
    'Last-Modified': new Date(found.mtime).toUTCString(),
  };

  const range = req.headers.range;
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const compressible = GZIP_EXT.has(extension) && found.size >= 1024;

  // 音视频等大文件需要 Range 才能拖动播放；压缩与分段不同时使用。
  if (!compressible) headers['Accept-Ranges'] = 'bytes';

  if (range && !compressible) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${found.size}` });
      return res.end();
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : found.size - 1;
    if (!match[1] && match[2]) { start = Math.max(0, found.size - Number(match[2])); end = found.size - 1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= found.size || end < start) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${found.size}` });
      return res.end();
    }
    end = Math.min(end, found.size - 1);
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${found.size}` });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(found.file, { start, end }).pipe(res);
  }

  if (acceptsGzip && compressible) {
    res.writeHead(statusCode, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(found.file).pipe(zlib.createGzip()).pipe(res);
  }

  res.writeHead(statusCode, { ...headers, 'Content-Length': found.size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(found.file).pipe(res);
}

async function sendSiteNotFound(req, res, siteName, config) {
  if (config.notFoundPage) {
    const custom = await resolveCandidate(siteName, config.notFoundPage);
    if (custom) return sendFile(req, res, custom, config, 404);
  }
  return sendPlain(res, 404, '404 Not Found');
}

function createSiteHosting({ auth }) {
  /**
   * 处理站点域名上的请求。返回 true 表示已处理，主管线不再继续。
   * 注意：这个函数在主站的认证网关之前被调用，所以必须自己完成全部访问控制。
   */
  async function handle(req, res, requestUrl, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendPlain(res, 405, '静态站点只支持 GET 与 HEAD。', { Allow: 'GET, HEAD' });
      return true;
    }

    // 授权回调：用主站签发的一次性令牌换取本域名下的短期访问凭证。
    if (pathname === SITE_AUTH_PATH) {
      const claims = auth.verifySiteGrantToken(requestUrl.searchParams.get('token'));
      const next = requestUrl.searchParams.get('next') || '/';
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      if (!claims) {
        sendPlain(res, 403, '访问凭证无效或已过期，请重新打开页面。', { 'Set-Cookie': retryCookie(req, false) });
        return true;
      }
      res.writeHead(302, {
        Location: safeNext,
        'Set-Cookie': [auth.buildSiteAccessCookie(auth.createSiteAccessToken(claims.username), req), retryCookie(req, false)],
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }

    // 站点域名不提供索引：根路径与未知路径都只回 404，不暴露已挂载的站点清单。
    const segments = pathname.split('/').filter(Boolean);
    if (!segments.length) {
      sendPlain(res, 404, '404 Not Found');
      return true;
    }

    let siteName;
    try { siteName = siteStore.normalizeSiteName(segments[0]); }
    catch { sendPlain(res, 404, '404 Not Found'); return true; }

    if (!(await siteStore.siteExists(siteName))) {
      sendPlain(res, 404, '404 Not Found');
      return true;
    }

    // 少了结尾斜杠时先重定向，否则页面里的相对路径会解析到上一层。
    if (segments.length === 1 && !pathname.endsWith('/')) {
      res.writeHead(301, { Location: `/${siteName}/${requestUrl.search || ''}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    const config = await siteStore.readConfig(siteName);

    if (config.visibility === 'authenticated') {
      const access = auth.getSiteAccessFromRequest(req);
      if (!access) {
        if (!PRIMARY_HOST) {
          sendPlain(res, 503, '该站点仅登录可见，但服务端尚未配置 BOX_PRIMARY_HOST，无法完成授权。');
          return true;
        }
        // 防重定向死循环：已经跳转过一次却仍然没有凭证，说明浏览器没能保存 Cookie。
        if (hasRetryMarker(req)) {
          sendPlain(res, 403, '无法建立访问凭证，请确认浏览器允许 Cookie 后重试。', { 'Set-Cookie': retryCookie(req, false) });
          return true;
        }
        const scheme = isHttps(req) ? 'https' : 'http';
        const returnUrl = `${scheme}://${normalizeHost(req.headers.host)}${pathname}${requestUrl.search || ''}`;
        const grantUrl = `${scheme}://${PRIMARY_HOST}/api/sites/grant?site=${encodeURIComponent(siteName)}&return=${encodeURIComponent(returnUrl)}`;
        res.writeHead(302, { Location: grantUrl, 'Set-Cookie': retryCookie(req, true), 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
    }

    const rest = pathname.slice(siteName.length + 1);
    let found = await resolveSiteFile(siteName, rest);

    // 单页应用回退：找不到实体文件时交给 index.html 自己处理路由。
    if (!found && config.spaFallback && !path.extname(rest)) {
      found = await resolveCandidate(siteName, 'index.html');
    }

    if (!found) {
      await sendSiteNotFound(req, res, siteName, config);
      return true;
    }

    sendFile(req, res, found, config);
    return true;
  }

  return { isSitesHost, handle, SITE_AUTH_PATH };
}

module.exports = { createSiteHosting, isSitesHost, SITE_AUTH_PATH };
