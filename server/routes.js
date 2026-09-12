'use strict';

/**
 * HTTP 请求管线与业务 API 路由。
 *
 * createRequestHandler 组装出完整的请求处理函数：URL 规范化 → 认证（登录页/登录接口除外）
 * → 工具权限校验 → 各业务 API → 静态产物/Next.js 兜底。
 * 依赖（auth/userData/edhDecks/roomServer/config）由 server/index.js 注入，本模块不直接 require。
 */

const crypto = require('crypto');
const fs = require('fs');
const { TOOL_SLUGS } = require('./config');
const httpUtils = require('./http-utils');
const loginPage = require('./login-page');
const staticFiles = require('./static-files');
const edhCards = require('./edh-cards');
const images = require('./images');
const kardsDecks = require('./kards-decks');
const chatStore = require('./chat-store');
// EDH 记血器：纯 SQLite 读写、不持有连接状态，所以像 edhCards/images 一样直接 require。
const edhLife = require('./edh-life');

function createRequestHandler({ auth, userData, edhDecks, carcassonneSaves, accountAdmin, homePreferences, medicineStore, sceneMedia, holdemStore, siteStore, siteHosting, roomServer, kardsRoomServer, chatServer, holdemRoomServer, config }) {
  function isAuthorizedForRequest(req, user, pathname) {
    const toolSlug = httpUtils.toolSlugForPath(pathname) || httpUtils.requiredToolForApi(pathname) || httpUtils.requiredToolForStaticAsset(pathname);
    return !toolSlug || auth.hasToolAccess(user, toolSlug);
  }

  function getAllowedToolSlugs(user) {
    return TOOL_SLUGS.filter((slug) => auth.hasToolAccess(user, slug));
  }

  function randomId() {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  }

  function sendChatAttachment(req, res, attachment, filePath) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { return httpUtils.sendAuthError(res, 404, '附件文件不存在或已被清理。'); }
    if (!stat.isFile()) return httpUtils.sendAuthError(res, 404, '附件文件不存在。');
    const inline = /^(image\/(jpeg|png|gif|webp|avif)|video\/|audio\/)/.test(attachment.mimeType);
    const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`;
    const baseHeaders = {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': disposition,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    };
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filePath).pipe(res);
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) { res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  return async function requestHandler(req, res, ctx) {
    let requestUrl;
    let pathname = '/';
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = requestUrl.pathname;
    } catch {
      requestUrl = new URL('http://localhost/');
      // URL解析失败就按根路径兜底
    }
    pathname = httpUtils.canonicalizePathname(pathname);
    if (!pathname) {
      return httpUtils.sendAuthError(res, 400, '请求路径无效。');
    }

    // 静态站点域名：与主站不同源，且公开站点允许匿名访问，因此必须在认证网关之前分流。
    // 站点托管自己完成全部访问控制（公开直接放行，仅登录可见的走跨源授权握手）。
    if (siteHosting.isSitesHost(req)) {
      return siteHosting.handle(req, res, requestUrl, pathname);
    }

    // 登录页和认证接口是唯一允许匿名访问的 HTTP 入口；它们不依赖 Next.js，生产静态导出也可用。
    const requestUser = await auth.getUserFromRequest(req);
    if (pathname === '/login' && req.method === 'GET') {
      if (requestUser) {
        res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
        return res.end();
      }
      return loginPage.sendLoginPage(
        res,
        requestUrl.searchParams.get('error') === '1',
        httpUtils.safeReturnPath(requestUrl.searchParams.get('next') || '/'),
      );
    }

    if (pathname === '/api/auth/login') {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST 登录。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      const attempt = auth.loginAllowed(req);
      if (!attempt.allowed) {
        res.writeHead(303, { Location: '/login?error=1', 'Retry-After': String(attempt.retryAfterSeconds), 'Cache-Control': 'no-store' });
        return res.end();
      }
      const raw = await httpUtils.readRawBody(req, 8 * 1024);
      const form = raw === null ? null : new URLSearchParams(raw);
      const username = form?.get('username')?.trim() || '';
      const password = form?.get('password') || '';
      const user = (await auth.loadUsers()).get(username);
      if (!user || !auth.verifyPassword(user, password)) {
        auth.recordLoginFailure(req);
        res.writeHead(303, { Location: '/login?error=1', 'Cache-Control': 'no-store' });
        return res.end();
      }
      auth.clearLoginFailures(req);
      const next = httpUtils.safeReturnPath(form?.get('next') || '/');
      res.writeHead(303, {
        Location: next,
        'Set-Cookie': auth.buildSessionCookie(auth.createSession(user), req),
        'Cache-Control': 'no-store',
      });
      return res.end();
    }

    if (pathname === '/api/auth/logout') {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST 登出。');
      if (!requestUser) return httpUtils.sendAuthError(res, 401, '尚未登录。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      res.writeHead(204, { 'Set-Cookie': auth.clearSessionCookie(req), 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (pathname === '/api/auth/me') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      if (!requestUser) return httpUtils.sendAuthError(res, 401, '尚未登录。');
      return httpUtils.sendJson(res, { username: requestUser.username, allowedTools: getAllowedToolSlugs(requestUser), isAdmin: accountAdmin.isAdmin(requestUser) });
    }

    // 认证在所有业务 API、静态资源和开发页面之前执行，前端链接隐藏不是安全边界。
    if (!requestUser) {
      if (pathname.startsWith('/api/')) return httpUtils.sendAuthError(res, 401, '需要登录。');
      return httpUtils.redirectToLogin(req, res);
    }

    // 账户管理不是普通工具：页面与接口均要求精确的通配符管理员权限。
    const isAdminPage = pathname === '/admin/accounts' || pathname === '/admin/accounts/' || pathname === '/admin/accounts.html';
    const isAdminApi = pathname === '/api/admin/accounts' || pathname.startsWith('/api/admin/accounts/');
    if ((isAdminPage || isAdminApi) && !accountAdmin.isAdmin(requestUser)) {
      if (isAdminApi) return httpUtils.sendAuthError(res, 403, '需要管理员权限。');
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('403 需要管理员权限');
    }
    if (!isAuthorizedForRequest(req, requestUser, pathname)) {
      if (pathname.startsWith('/api/')) return httpUtils.sendAuthError(res, 403, '当前账户没有访问此工具的权限。');
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('403 无权访问此工具');
    }

    // 个人中心汇总：使用记录、热力图和里程碑都由当前会话的账户与权限边界计算。
    if (pathname === '/api/profile/summary') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      try {
        return httpUtils.sendJson(res, await homePreferences.getProfileSummary(requestUser.username, getAllowedToolSlugs(requestUser)));
      } catch (error) {
        if (error instanceof homePreferences.HomePreferencesError) return httpUtils.sendAuthError(res, error.statusCode, error.message);
        throw error;
      }
    }

    // 首页偏好：按账户保存，但返回和写入都以当前权限的工具集合为边界。
    if (pathname === '/api/home/preferences') {
      try {
        const allowedTools = getAllowedToolSlugs(requestUser);
        if (req.method === 'GET') return httpUtils.sendJson(res, await homePreferences.getHomePreferences(requestUser.username, allowedTools));
        if (req.method === 'PATCH') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          const body = await httpUtils.readBody(req);
          return httpUtils.sendJson(res, await homePreferences.saveHomePreferences(requestUser.username, body, allowedTools));
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) {
        if (error instanceof homePreferences.HomePreferencesError) return httpUtils.sendAuthError(res, error.statusCode, error.message);
        throw error;
      }
    }

    if (pathname === '/api/home/tool-usage') {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try {
        const body = await httpUtils.readBody(req);
        if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
        await homePreferences.recordToolUsage(requestUser.username, body.toolSlug, getAllowedToolSlugs(requestUser));
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      } catch (error) {
        if (error instanceof homePreferences.HomePreferencesError) return httpUtils.sendAuthError(res, error.statusCode, error.message);
        throw error;
      }
    }

    // EDH 指挥官记血器：一局对战一条记录（含时长与完整快照），座位与掷骰各自成行。
    // 全部接口按账户隔离，写操作要求同源请求。
    if (pathname === '/api/edh-life/games' || pathname.startsWith('/api/edh-life/games/')) {
      const rest = pathname.slice('/api/edh-life/games'.length).replace(/^\/+/, '');
      const segments = rest ? rest.split('/') : [];
      try {
        // 未结束的最新一局：页面加载时恢复上次中断的对局。
        // 必须排在 :id 之前，否则 "running" 会被当成一局对战的 id。
        if (segments.length === 1 && segments[0] === 'running') {
          if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
          return httpUtils.sendJson(res, { game: await edhLife.getRunningGame(requestUser.username) });
        }

        if (!segments.length) {
          if (req.method === 'GET') return httpUtils.sendJson(res, { games: await edhLife.listGames(requestUser.username) });
          if (req.method === 'POST') {
            if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
            const body = await httpUtils.readBody(req);
            if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
            return httpUtils.sendJson(res, { game: await edhLife.createGame(requestUser.username, body) }, 201);
          }
          return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
        }

        if (segments.length === 1) {
          const gameId = segments[0];
          if (req.method === 'GET') {
            const game = await edhLife.getGame(requestUser.username, gameId);
            return game ? httpUtils.sendJson(res, { game }) : httpUtils.sendAuthError(res, 404, '对局不存在。');
          }
          if (req.method === 'PATCH') {
            if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
            const body = await httpUtils.readBody(req);
            if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
            const game = await edhLife.updateGame(requestUser.username, gameId, body);
            return game ? httpUtils.sendJson(res, { game }) : httpUtils.sendAuthError(res, 404, '对局不存在。');
          }
          if (req.method === 'DELETE') {
            if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
            if (!(await edhLife.deleteGame(requestUser.username, gameId))) return httpUtils.sendAuthError(res, 404, '对局不存在。');
            return httpUtils.sendJson(res, { success: true });
          }
          return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
        }

        // 掷骰历史：写一条 / 读最近 N 条
        if (segments.length === 2 && segments[1] === 'rolls') {
          const gameId = segments[0];
          if (req.method === 'GET') {
            const rolls = await edhLife.listRolls(requestUser.username, gameId);
            return rolls ? httpUtils.sendJson(res, { rolls }) : httpUtils.sendAuthError(res, 404, '对局不存在。');
          }
          if (req.method === 'POST') {
            if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
            const body = await httpUtils.readBody(req);
            if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
            const roll = await edhLife.addRoll(requestUser.username, gameId, body);
            return roll ? httpUtils.sendJson(res, { roll }, 201) : httpUtils.sendAuthError(res, 404, '对局不存在。');
          }
          return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
        }

        return httpUtils.sendAuthError(res, 404, '接口不存在。');
      } catch (error) {
        if (error instanceof edhLife.EdhLifeError) return httpUtils.sendAuthError(res, error.statusCode, error.message);
        throw error;
      }
    }

    // 静态站点管理：站点文件托管在独立域名上，这里只提供受权限保护的管理接口。
    // 授权端点例外——它服务的是「访客要看仅登录可见的站点」，只需要登录，不需要管理权限。
    if (pathname === '/api/sites/grant') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      const target = requestUrl.searchParams.get('return') || '';
      let returnUrl;
      try { returnUrl = new URL(target); } catch { return httpUtils.sendAuthError(res, 400, '回跳地址无效。'); }
      // 防开放重定向：只允许跳回已配置的站点域名，且必须是 http/https。
      const allowedHost = config.SITES_HOSTS.includes(returnUrl.host.toLowerCase());
      if (!allowedHost || !['http:', 'https:'].includes(returnUrl.protocol)) {
        return httpUtils.sendAuthError(res, 400, '回跳地址不在允许的站点域名内。');
      }
      const grantToken = auth.createSiteGrantToken(requestUser.username);
      const authUrl = `${returnUrl.origin}${siteHosting.SITE_AUTH_PATH}?token=${encodeURIComponent(grantToken)}&next=${encodeURIComponent(`${returnUrl.pathname}${returnUrl.search}`)}`;
      res.writeHead(302, { Location: authUrl, 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (pathname === '/api/sites') {
      try {
        if (req.method === 'GET') {
          return httpUtils.sendJson(res, {
            sites: await siteStore.listSites(),
            sitesHosts: config.SITES_HOSTS,
            primaryHost: config.PRIMARY_HOST,
            limits: {
              maxFileBytes: config.SITES_MAX_FILE_BYTES,
              maxArchiveBytes: config.SITES_MAX_ARCHIVE_BYTES,
              maxTotalBytes: config.SITES_MAX_TOTAL_BYTES,
            },
          });
        }
        if (req.method === 'POST') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          const body = await httpUtils.readBody(req);
          if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
          return httpUtils.sendJson(res, await siteStore.createSite(body.name, body.config), 201);
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof siteStore.SiteStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    const siteFilesMatch = /^\/api\/sites\/([^/]+)\/files$/.exec(pathname);
    const siteArchiveMatch = /^\/api\/sites\/([^/]+)\/archive$/.exec(pathname);
    const siteConfigMatch = /^\/api\/sites\/([^/]+)\/config$/.exec(pathname);
    const siteDetailMatch = /^\/api\/sites\/([^/]+)$/.exec(pathname);

    if (siteFilesMatch) {
      try {
        const siteName = decodeURIComponent(siteFilesMatch[1]);
        if (req.method === 'GET') return httpUtils.sendJson(res, { files: await siteStore.listSiteFiles(siteName) });
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        if (req.method === 'POST') {
          // 单个文件上传：原始请求体是文件内容，站内相对路径由请求头携带。
          const saved = await siteStore.saveUploadedFile(siteName, req.headers['x-site-file-path'], req);
          return httpUtils.sendJson(res, saved, 201);
        }
        if (req.method === 'DELETE') {
          const target = requestUrl.searchParams.get('path');
          if (target) return httpUtils.sendJson(res, await siteStore.deleteSiteFile(siteName, target));
          return httpUtils.sendJson(res, await siteStore.clearSiteFiles(siteName));
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof siteStore.SiteStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    if (siteArchiveMatch) {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try {
        const siteName = decodeURIComponent(siteArchiveMatch[1]);
        const replace = requestUrl.searchParams.get('replace') === '1';
        return httpUtils.sendJson(res, await siteStore.extractUploadedArchive(siteName, req, { replace }), 201);
      } catch (error) { if (error instanceof siteStore.SiteStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    if (siteConfigMatch) {
      if (req.method !== 'PUT') return httpUtils.sendAuthError(res, 405, '只支持 PUT。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try {
        const body = await httpUtils.readBody(req);
        if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
        return httpUtils.sendJson(res, await siteStore.writeConfig(decodeURIComponent(siteConfigMatch[1]), body));
      } catch (error) { if (error instanceof siteStore.SiteStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    if (siteDetailMatch) {
      try {
        const siteName = decodeURIComponent(siteDetailMatch[1]);
        if (req.method === 'GET') return httpUtils.sendJson(res, await siteStore.siteSummary(siteName));
        if (req.method === 'DELETE') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          return httpUtils.sendJson(res, await siteStore.deleteSite(siteName));
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof siteStore.SiteStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    // 德州扑克：筹码账户与房间大厅。牌局本身走 WebSocket，这里只提供余额、流水与房间列表。
    if (pathname === '/api/holdem/account') {
      try {
        if (req.method === 'GET') return httpUtils.sendJson(res, await holdemStore.getAccount(requestUser.username));
        if (req.method === 'POST') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          const body = await httpUtils.readBody(req);
          if (!body || body.action !== 'reset') return httpUtils.sendAuthError(res, 400, '请求体无效。');
          return httpUtils.sendJson(res, await holdemStore.resetChips(requestUser.username));
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof holdemStore.HoldemStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (pathname === '/api/holdem/ledger') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      try { return httpUtils.sendJson(res, { entries: await holdemStore.listLedger(requestUser.username) }); }
      catch (error) { if (error instanceof holdemStore.HoldemStoreError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (pathname === '/api/holdem/rooms') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      return httpUtils.sendJson(res, { rooms: holdemRoomServer.lobbyList() });
    }

    // 先攻场景媒体：共享资源库在 SQLite 记录元数据，字节只通过受保护的 Range 流接口读取。
    if (pathname === '/api/initiative/scenes') {
      try {
        if (req.method === 'GET') return httpUtils.sendJson(res, await sceneMedia.list());
        return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      } catch (error) { if (error instanceof sceneMedia.SceneMediaError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (pathname === '/api/initiative/scenes/uploads') {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { return httpUtils.sendJson(res, await sceneMedia.upload(req, requestUser), 201); }
      catch (error) { if (error instanceof sceneMedia.SceneMediaError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    const sceneMediaFileMatch = /^\/api\/initiative\/scenes\/files\/([^/]+)$/.exec(pathname);
    if (sceneMediaFileMatch) {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') { const resource = await sceneMedia.get(sceneMediaFileMatch[1]); return sendChatAttachment(req, res, resource.media, resource.filePath); }
        if (req.method === 'DELETE') { if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。'); return httpUtils.sendJson(res, await sceneMedia.remove(sceneMediaFileMatch[1])); }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof sceneMedia.SceneMediaError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    // 家庭药箱：库存供具有 medicine-inventory 权限的家庭账户共享；图片只通过本受保护端点读取。
    if (pathname === '/api/medicine/products') {
      try {
        if (req.method === 'GET') return httpUtils.sendJson(res, await medicineStore.listProducts({ q: requestUrl.searchParams.get('q') || '', category: requestUrl.searchParams.get('category') || '', filter: requestUrl.searchParams.get('filter') || '', days: requestUrl.searchParams.get('days') || '' }));
        if (req.method === 'POST') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          return httpUtils.sendJson(res, await medicineStore.createProduct(requestUser, await httpUtils.readBody(req)), 201);
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    const medicinePhotoMatch = /^\/api\/medicine\/photos\/([^/]+)$/.exec(pathname);
    if (medicinePhotoMatch) {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') { const resource = await medicineStore.getPhoto(medicinePhotoMatch[1]); return sendChatAttachment(req, res, resource.photo, resource.filePath); }
        if (req.method === 'DELETE') { if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。'); return httpUtils.sendJson(res, await medicineStore.deletePhoto(medicinePhotoMatch[1])); }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    const medicineProductMatch = /^\/api\/medicine\/products\/([^/]+)$/.exec(pathname);
    const medicinePhotoUploadMatch = /^\/api\/medicine\/products\/([^/]+)\/photos$/.exec(pathname);
    const medicineBatchCreateMatch = /^\/api\/medicine\/products\/([^/]+)\/batches$/.exec(pathname);
    const medicineBatchMatch = /^\/api\/medicine\/batches\/([^/]+)$/.exec(pathname);
    const medicineUseMatch = /^\/api\/medicine\/batches\/([^/]+)\/use$/.exec(pathname);
    if (medicinePhotoUploadMatch) {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { return httpUtils.sendJson(res, await medicineStore.uploadPhoto(req, medicinePhotoUploadMatch[1]), 201); }
      catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (medicineBatchCreateMatch) {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { return httpUtils.sendJson(res, await medicineStore.createBatch(medicineBatchCreateMatch[1], await httpUtils.readBody(req)), 201); }
      catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (medicineUseMatch) {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { return httpUtils.sendJson(res, await medicineStore.recordUse(requestUser, medicineUseMatch[1], await httpUtils.readBody(req)), 201); }
      catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (medicineBatchMatch) {
      try {
        if (req.method === 'PUT') { if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。'); return httpUtils.sendJson(res, await medicineStore.updateBatch(medicineBatchMatch[1], await httpUtils.readBody(req))); }
        if (req.method === 'DELETE') { if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。'); return httpUtils.sendJson(res, await medicineStore.deleteBatch(medicineBatchMatch[1])); }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (medicineProductMatch) {
      try {
        if (req.method === 'GET') return httpUtils.sendJson(res, await medicineStore.getProduct(medicineProductMatch[1]));
        if (req.method === 'PUT') { if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。'); return httpUtils.sendJson(res, await medicineStore.updateProduct(medicineProductMatch[1], await httpUtils.readBody(req))); }
        if (req.method === 'DELETE') { if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。'); return httpUtils.sendJson(res, await medicineStore.deleteProduct(medicineProductMatch[1])); }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) { if (error instanceof medicineStore.MedicineError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    // 局域网大厅：消息与元数据保存在 SQLite，附件仅由受保护端点读取，绝不作为公开静态目录暴露。
    if (pathname === '/api/chat/messages') {
      try {
        if (req.method === 'GET') return httpUtils.sendJson(res, await chatStore.getMessages(requestUser, requestUrl.searchParams.get('cursor') || undefined));
        if (req.method === 'POST') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          const body = await httpUtils.readBody(req);
          const message = await chatStore.createMessage(requestUser, body);
          chatServer?.broadcast({ type: 'MESSAGE_CREATED', payload: message });
          return httpUtils.sendJson(res, message, 201);
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) {
        if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message);
        throw error;
      }
    }

    if (pathname === '/api/chat/search') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      try { return httpUtils.sendJson(res, { messages: await chatStore.searchMessages(requestUser, requestUrl.searchParams.get('q') || '') }); }
      catch (error) { if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    if (pathname === '/api/chat/members') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      return httpUtils.sendJson(res, { usernames: await chatStore.listMembers(auth) });
    }

    if (pathname === '/api/chat/uploads') {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { return httpUtils.sendJson(res, await chatStore.uploadAttachment(req, requestUser), 201); }
      catch (error) { if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    if (pathname.startsWith('/api/chat/files/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return httpUtils.sendAuthError(res, 405, '只支持 GET 或 HEAD。');
      try { const resource = await chatStore.getAttachment(pathname.slice('/api/chat/files/'.length)); return sendChatAttachment(req, res, resource.attachment, resource.filePath); }
      catch (error) { if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    const chatReactionMatch = /^\/api\/chat\/messages\/([^/]+)\/reactions$/.exec(pathname);
    const chatWithdrawMatch = /^\/api\/chat\/messages\/([^/]+)\/withdraw$/.exec(pathname);
    const chatAdminDeleteMatch = /^\/api\/chat\/admin\/messages\/([^/]+)$/.exec(pathname);
    if (chatReactionMatch) {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { const body = await httpUtils.readBody(req); const message = await chatStore.toggleReaction(requestUser, chatReactionMatch[1], body?.emoji); chatServer?.broadcast({ type: 'MESSAGE_CHANGED', payload: { id: message.id } }); return httpUtils.sendJson(res, message); }
      catch (error) { if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (chatWithdrawMatch) {
      if (req.method !== 'POST') return httpUtils.sendAuthError(res, 405, '只支持 POST。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { const message = await chatStore.withdrawMessage(requestUser, chatWithdrawMatch[1]); chatServer?.broadcast({ type: 'MESSAGE_CHANGED', payload: { id: message.id } }); return httpUtils.sendJson(res, message); }
      catch (error) { if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }
    if (pathname === '/api/chat/admin/stats') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      if (!accountAdmin.isAdmin(requestUser)) return httpUtils.sendAuthError(res, 403, '需要管理员权限。');
      return httpUtils.sendJson(res, await chatStore.getAdminStats());
    }
    if (chatAdminDeleteMatch) {
      if (req.method !== 'DELETE') return httpUtils.sendAuthError(res, 405, '只支持 DELETE。');
      if (!accountAdmin.isAdmin(requestUser)) return httpUtils.sendAuthError(res, 403, '需要管理员权限。');
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      try { const removed = await chatStore.deleteMessageAsAdmin(chatAdminDeleteMatch[1]); chatServer?.broadcast({ type: 'MESSAGE_DELETED', payload: removed }); return httpUtils.sendJson(res, removed); }
      catch (error) { if (error instanceof chatStore.ChatError) return httpUtils.sendAuthError(res, error.statusCode, error.message); throw error; }
    }

    // 管理员账户 API：只返回公开账户信息，密码哈希永不离开服务端。
    if (isAdminApi) {
      const accountPrefix = '/api/admin/accounts';
      const targetUsername = pathname.slice(accountPrefix.length).replace(/^\/+/, '');
      try {
        if (!targetUsername) {
          if (req.method === 'GET') return httpUtils.sendJson(res, { users: await accountAdmin.listAccounts(), availablePermissions: TOOL_SLUGS });
          if (req.method === 'POST') {
            if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
            const body = await httpUtils.readBody(req);
            if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
            return httpUtils.sendJson(res, await accountAdmin.createAccount(body), 201);
          }
          return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
        }
        if (targetUsername.includes('/')) return httpUtils.sendAuthError(res, 400, '账户标识无效。');
        if (req.method === 'PUT') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          const body = await httpUtils.readBody(req);
          if (!body || typeof body !== 'object') return httpUtils.sendAuthError(res, 400, '请求体无效。');
          return httpUtils.sendJson(res, await accountAdmin.updateAccount(requestUser.username, targetUsername, body));
        }
        if (req.method === 'DELETE') {
          if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
          await accountAdmin.deleteAccount(requestUser.username, targetUsername);
          return httpUtils.sendJson(res, { success: true });
        }
        return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      } catch (error) {
        if (error instanceof accountAdmin.AccountAdminError) return httpUtils.sendAuthError(res, error.statusCode, error.message);
        throw error;
      }
    }

    // 图片清单接口：在静态文件/Next路由前处理，但已通过先攻追踪器工具权限校验。
    if (pathname === '/api/enemies') return httpUtils.sendJson(res, images.getEnemyList());
    if (pathname === '/api/player-images') return httpUtils.sendJson(res, images.getPlayerImageList());
    if (pathname === '/api/health') {
      return httpUtils.sendJson(res, { ok: true, dev: config.DEV, rooms: roomServer.rooms.size });
    }
    // 房间列表：仅拥有先攻追踪器权限的用户可访问。
    if (pathname === '/api/rooms') {
      const list = Array.from(roomServer.rooms.values())
        .map((room) => ({
          roomId: room.roomId,
          characterCount: room.characters.length,
          roundNumber: room.roundNumber,
          displayConnected: room.displayConnected !== false,
          lastActivity: room.lastActivity || room.createdAt,
        }))
        .sort((a, b) => b.lastActivity - a.lastActivity);
      return httpUtils.sendJson(res, list);
    }

    // Kards 公共房间列表：展示内存中所有房间，供大厅"像公共服务一样"浏览/加入。
    if (pathname === '/api/kards/rooms') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      const list = Array.from(kardsRoomServer.rooms.values())
        .map((room) => ({
          roomId: room.roomId,
          hostUsername: room.hostUsername,
          joinerUsername: room.joinerUsername,
          playerCount: room.players.filter((player) => player.username).length,
          connectedCount: room.players.filter((player) => player.connected).length,
          lastActivity: room.lastActivity || room.createdAt,
        }))
        .sort((a, b) => b.lastActivity - a.lastActivity);
      return httpUtils.sendJson(res, list);
    }

    // 省钱记录 API：SQLite 按账户隔离，写操作要求同源请求。
    if (pathname === '/api/savings') {
      if (req.method === 'POST') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const body = await httpUtils.readBody(req);
        if (!body || !body.date || !body.time || !body.activity || !body.item || body.amount == null || !Number.isFinite(Number(body.amount))) return httpUtils.sendAuthError(res, 400, '缺少或包含无效的必填字段。');
        const record = await userData.createSavings(requestUser.username, {
          id: randomId(),
          date: String(body.date), time: String(body.time), activity: String(body.activity), item: String(body.item), amount: Number(body.amount), createdAt: new Date().toISOString(),
        });
        return httpUtils.sendJson(res, record);
      }
      if (req.method === 'DELETE') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const id = requestUrl.searchParams.get('id');
        if (!id) return httpUtils.sendAuthError(res, 400, '缺少 id 参数。');
        if (!(await userData.deleteSavings(requestUser.username, id))) return httpUtils.sendAuthError(res, 404, '记录不存在。');
        return httpUtils.sendJson(res, { success: true });
      }
      if (req.method === 'PUT') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const body = await httpUtils.readBody(req);
        if (!body || typeof body.id !== 'string') return httpUtils.sendAuthError(res, 400, '缺少 id 参数。');
        const current = (await userData.listSavings(requestUser.username)).find((record) => record.id === body.id);
        if (!current) return httpUtils.sendAuthError(res, 404, '记录不存在。');
        const patch = {
          date: body.date == null ? current.date : String(body.date), time: body.time == null ? current.time : String(body.time),
          activity: body.activity == null ? current.activity : String(body.activity), item: body.item == null ? current.item : String(body.item),
          amount: body.amount == null ? current.amount : Number(body.amount),
        };
        if (!Number.isFinite(patch.amount)) return httpUtils.sendAuthError(res, 400, '金额无效。');
        return httpUtils.sendJson(res, await userData.updateSavings(requestUser.username, body.id, patch));
      }
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      return httpUtils.sendJson(res, await userData.listSavings(requestUser.username));
    }

    // 卡卡颂计分存档：SQLite 按账户隔离；页面保存快照，历史列表与删除都在同一接口下。
    if (pathname === '/api/carcassonne/saves') {
      if (req.method === 'POST') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const body = await httpUtils.readBody(req);
        if (!body || typeof body.state !== 'object' || body.state === null || Array.isArray(body.state)) {
          return httpUtils.sendAuthError(res, 400, '缺少有效的游戏状态。');
        }
        const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : '未命名存档';
        const now = new Date().toISOString();
        const save = await carcassonneSaves.createSave(requestUser.username, {
          id: randomId(),
          title,
          state: body.state,
          createdAt: now,
        });
        return httpUtils.sendJson(res, save, 201);
      }
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
      return httpUtils.sendJson(res, await carcassonneSaves.listSaves(requestUser.username));
    }

    const carcassonneDeleteMatch = /^\/api\/carcassonne\/saves\/([^/]+)$/.exec(pathname);
    if (carcassonneDeleteMatch && req.method === 'DELETE') {
      if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
      if (!(await carcassonneSaves.deleteSave(requestUser.username, carcassonneDeleteMatch[1]))) {
        return httpUtils.sendAuthError(res, 404, '存档不存在。');
      }
      return httpUtils.sendJson(res, { success: true });
    }

    // EDH 卡牌搜索：只读接口，卡牌数据库对所有已授权账户共享（不区分 owner）。
    if (pathname === '/api/edh/cards/search') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      const database = edhCards.loadEdhCardDatabase();
      if (!database) return httpUtils.sendAuthError(res, 503, '卡牌数据库尚未同步，请先在服务器上执行 npm run sync:edh-cards。');
      const params = {
        q: requestUrl.searchParams.get('q') || '',
        colors: (requestUrl.searchParams.get('colors') || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
        colorMode: requestUrl.searchParams.get('colorMode') || 'subset',
        types: (requestUrl.searchParams.get('types') || '').split(',').map((t) => t.trim()).filter(Boolean),
        cmcMin: requestUrl.searchParams.get('cmcMin'),
        cmcMax: requestUrl.searchParams.get('cmcMax'),
        rarities: (requestUrl.searchParams.get('rarities') || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
        powerMin: requestUrl.searchParams.get('powerMin'),
        powerMax: requestUrl.searchParams.get('powerMax'),
        toughnessMin: requestUrl.searchParams.get('toughnessMin'),
        toughnessMax: requestUrl.searchParams.get('toughnessMax'),
        format: requestUrl.searchParams.get('format') || '',
        nonReprint: requestUrl.searchParams.get('nonReprint') === '1',
        searchField: requestUrl.searchParams.get('searchField') || 'all',
        commanderOnly: requestUrl.searchParams.get('commanderOnly') === '1',
        limit: requestUrl.searchParams.get('limit'),
      };
      return httpUtils.sendJson(res, edhCards.searchEdhCards(database, params));
    }

    // EDH 卡牌数据库元信息：给前端展示"数据更新于/中文覆盖率"等状态，不含卡牌本体。
    if (pathname === '/api/edh/cards/meta') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      const database = edhCards.loadEdhCardDatabase();
      if (!database) return httpUtils.sendJson(res, { synced: false });
      return httpUtils.sendJson(res, {
        synced: true,
        generatedAt: database.generatedAt,
        cardCount: database.cardCount,
        chineseCoverage: database.chineseCoverage,
      });
    }

    // EDH 卡牌详情批量查询：牌组只存 oracleId+数量，渲染时用这个接口换回完整卡牌信息。
    if (pathname === '/api/edh/cards/lookup') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      const database = edhCards.loadEdhCardDatabase();
      if (!database) return httpUtils.sendAuthError(res, 503, '卡牌数据库尚未同步，请先在服务器上执行 npm run sync:edh-cards。');
      const ids = (requestUrl.searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200);
      const cards = ids.map((id) => database.byOracleId.get(id)).filter(Boolean);
      return httpUtils.sendJson(res, cards);
    }

    // EDH 牌组：数据保存在 SQLite，响应格式保持与原 JSON API 完全一致。
    if (pathname === '/api/edh/decks') {
      if (req.method === 'GET') return httpUtils.sendJson(res, await edhDecks.listDecks(requestUser.username));
      if (req.method === 'POST') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const body = await httpUtils.readBody(req);
        if (!body || typeof body.name !== 'string' || !body.name.trim()) return httpUtils.sendAuthError(res, 400, '缺少牌组名称。');
        const now = new Date().toISOString();
        const deck = await edhDecks.createDeck(requestUser.username, {
          id: randomId(),
          name: body.name.trim().slice(0, 100), commanderOracleId: typeof body.commanderOracleId === 'string' ? body.commanderOracleId : null,
          createdAt: now, updatedAt: now,
        });
        return httpUtils.sendJson(res, deck, 201);
      }
      return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
    }

    if (pathname.startsWith('/api/edh/decks/')) {
      const deckId = pathname.slice('/api/edh/decks/'.length);
      if (!deckId) return httpUtils.sendAuthError(res, 400, '缺少牌组 id。');
      const current = await edhDecks.getDeck(requestUser.username, deckId);
      if (req.method === 'GET') return current ? httpUtils.sendJson(res, current) : httpUtils.sendAuthError(res, 404, '牌组不存在。');
      if (req.method === 'PUT') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        if (!current) return httpUtils.sendAuthError(res, 404, '牌组不存在。');
        const body = await httpUtils.readBody(req);
        if (!body) return httpUtils.sendAuthError(res, 400, '请求体无效。');
        const cards = Array.isArray(body.cards) ? body.cards.filter((entry) => entry && typeof entry.oracleId === 'string' && Number.isFinite(Number(entry.quantity)) && Number(entry.quantity) > 0).map((entry) => ({ oracleId: entry.oracleId, quantity: Math.min(Math.floor(Number(entry.quantity)), 99) })) : undefined;
        const layout = body.layout && typeof body.layout === 'object' && !Array.isArray(body.layout) ? {
          viewMode: ['free', 'type', 'cmc'].includes(body.layout.viewMode) ? body.layout.viewMode : (current.layout?.viewMode || 'free'),
          positions: typeof body.layout.positions === 'object' && body.layout.positions && !Array.isArray(body.layout.positions) ? Object.fromEntries(Object.entries(body.layout.positions).slice(0, 250).flatMap(([id, point]) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) ? [[id, { x: Math.max(0, Math.min(Number(point.x), 10000)), y: Math.max(0, Math.min(Number(point.y), 10000)) }]] : [])) : (current.layout?.positions || {}),
        } : undefined;
        const saved = await edhDecks.updateDeck(requestUser.username, deckId, {
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : current.name,
          commanderOracleId: body.commanderOracleId === null || typeof body.commanderOracleId === 'string' ? body.commanderOracleId : current.commanderOracleId,
          cards, layout,
        });
        return httpUtils.sendJson(res, saved);
      }
      if (req.method === 'DELETE') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        if (!(await edhDecks.deleteDeck(requestUser.username, deckId))) return httpUtils.sendAuthError(res, 404, '牌组不存在。');
        return httpUtils.sendJson(res, { success: true });
      }
      return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
    }

    // Kards 卡牌目录：由 scripts/build-kards-catalog.mjs 扫描卡图生成，
    // 只包含名称/阵营/费用/图片路径等轻量元数据（数值与效果印在卡图上）。
    if (pathname === '/api/kards/cards') {
      if (req.method !== 'GET') return httpUtils.sendAuthError(res, 405, '只支持 GET。');
      const catalog = kardsDecks.getCatalogJson();
      if (!catalog || !catalog.cards || catalog.cards.length === 0) return httpUtils.sendAuthError(res, 503, '卡牌目录尚未生成，请先在服务器上执行 npm run build:kards。');
      return httpUtils.sendJson(res, catalog);
    }

    // Kards 牌组：按账户隔离，存卡牌 id 数组（含重复=多张）。
    if (pathname === '/api/kards/decks') {
      if (req.method === 'GET') return httpUtils.sendJson(res, await kardsDecks.listDecks(requestUser.username));
      if (req.method === 'POST') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const body = await httpUtils.readBody(req);
        if (!body || typeof body.name !== 'string' || !body.name.trim()) return httpUtils.sendAuthError(res, 400, '缺少牌组名称。');
        const now = new Date().toISOString();
        const deck = await kardsDecks.createDeck(requestUser.username, {
          id: randomId(),
          name: body.name.trim().slice(0, 100),
          cards: Array.isArray(body.cards) ? body.cards : [],
          createdAt: now,
          updatedAt: now,
        });
        return httpUtils.sendJson(res, deck, 201);
      }
      return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
    }

    if (pathname.startsWith('/api/kards/decks/')) {
      const deckId = pathname.slice('/api/kards/decks/'.length);
      if (!deckId) return httpUtils.sendAuthError(res, 400, '缺少牌组 id。');
      const current = await kardsDecks.getDeck(requestUser.username, deckId);
      if (req.method === 'GET') return current ? httpUtils.sendJson(res, current) : httpUtils.sendAuthError(res, 404, '牌组不存在。');
      if (req.method === 'PUT') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        if (!current) return httpUtils.sendAuthError(res, 404, '牌组不存在。');
        const body = await httpUtils.readBody(req);
        if (!body) return httpUtils.sendAuthError(res, 400, '请求体无效。');
        const saved = await kardsDecks.updateDeck(requestUser.username, deckId, {
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : current.name,
          faction: body.faction === null || typeof body.faction === 'string' ? body.faction : current.faction,
          cards: Array.isArray(body.cards) ? body.cards : current.cards,
        });
        return httpUtils.sendJson(res, saved);
      }
      if (req.method === 'DELETE') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        if (!(await kardsDecks.deleteDeck(requestUser.username, deckId))) return httpUtils.sendAuthError(res, 404, '牌组不存在。');
        return httpUtils.sendJson(res, { success: true });
      }
      return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
    }

    // DND 角色卡存档：一行一个 key 存 SQLite；POST 只提交变化的键（null = 删除该键），
    // 因此不同设备改不同字段不会互相覆盖，上传体积也只跟改动量相关。
    if (pathname === '/api/dnd/save') {
      if (req.method === 'GET') {
        const save = await userData.getDndSave(requestUser.username);
        return httpUtils.sendJson(res, { data: save.data, updatedAt: save.updatedAt });
      }
      if (req.method === 'POST') {
        if (!httpUtils.isSameOrigin(req)) return httpUtils.sendAuthError(res, 403, '请求来源无效。');
        const raw = await httpUtils.readRawBody(req, 5 * 1024 * 1024);
        let body = null;
        if (raw !== null) { try { body = JSON.parse(raw); } catch { body = null; } }
        if (!body || typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) return httpUtils.sendAuthError(res, 400, '请求体无效：需要 { data: {…} } 对象。');
        const patch = {};
        for (const [key, value] of Object.entries(body.data)) {
          if (!key || key.length > 128) return httpUtils.sendAuthError(res, 400, '存档键无效。');
          if (value !== null && typeof value !== 'string') return httpUtils.sendAuthError(res, 400, '存档值必须是字符串，或用 null 表示删除该键。');
          patch[key] = value;
        }
        if (!Object.keys(patch).length) return httpUtils.sendAuthError(res, 400, '请求体里没有任何要保存的字段。');
        const result = await userData.patchDndSave(requestUser.username, patch);
        return httpUtils.sendJson(res, { success: true, saved: Object.keys(patch).length, updatedAt: result.updatedAt });
      }
      return httpUtils.sendAuthError(res, 405, '不支持的请求方法。');
    }

    // 页面：开发交给Next dev server，生产读静态产物
    if (config.DEV) return ctx.nextRequestHandler(req, res);

    const found = staticFiles.resolveStaticFile(pathname);
    if (!found) return staticFiles.sendNotFound(req, res);
    return staticFiles.sendStaticFile(req, res, found, 200, staticFiles.cacheControlFor(pathname));
  };
}

module.exports = { createRequestHandler };
