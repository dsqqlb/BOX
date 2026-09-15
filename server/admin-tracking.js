'use strict';

/**
 * 管理员跟踪模块：在线状态（内存）、登录记录（SQLite）、用户活动查询。
 *
 * 在线跟踪以尽可能低的代价被动工作：
 *   1. 任何已验证的 HTTP 请求都会更新该用户的 lastSeen 时间戳。
 *   2. 定期清理超过 OFFLINE_TIMEOUT_MS 没有活动的用户。
 *   3. 聊天 WebSocket 连接也会反向同步在线状态（由 chat-server 通过回调通知）。
 */

const { prisma } = require('./db');

const OFFLINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无活动视为离线
const CLEANUP_INTERVAL_MS = 60 * 1000;     // 每分钟清理一次

// 内存中的在线状态表：username → { firstSeen, lastSeen, ipAddress, userAgent }
const onlineUsers = new Map();
let cleanupTimer = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - OFFLINE_TIMEOUT_MS;
    for (const [username, state] of onlineUsers) {
      if (state.lastSeen < cutoff) {
        onlineUsers.delete(username);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // 不要让定时器阻止进程退出
  if (cleanupTimer && cleanupTimer.unref) cleanupTimer.unref();
}

function stopCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * 记录一次在线心跳：由 routes.js 在每个已验证请求上调用。
 */
function recordHeartbeat(username, req) {
  const now = Date.now();
  const existing = onlineUsers.get(username);
  if (existing) {
    existing.lastSeen = now;
  } else {
    onlineUsers.set(username, {
      firstSeen: now,
      lastSeen: now,
      ipAddress: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 256),
    });
  }
}

/**
 * 由聊天 WebSocket 通知：某个用户在聊天中上线/下线时反向同步。
 */
function syncChatPresence(usernames) {
  const chatSet = new Set(usernames);
  const now = Date.now();
  // 聊天中出现的用户，如果不在在线表里，以当前时间补入
  for (const username of usernames) {
    if (!onlineUsers.has(username)) {
      onlineUsers.set(username, { firstSeen: now, lastSeen: now, ipAddress: '', userAgent: 'chat-ws' });
    }
  }
  // 不在聊天列表且仅标记为 chat-ws 的用户，移除（他们只在聊天里出现过）
  for (const [username, state] of onlineUsers) {
    if (state.userAgent === 'chat-ws' && !chatSet.has(username)) {
      onlineUsers.delete(username);
    }
  }
}

/**
 * 获取当前在线用户列表（含详情）。
 */
function getOnlineUsers() {
  const now = Date.now();
  const items = [];
  for (const [username, state] of onlineUsers) {
    if (now - state.lastSeen < OFFLINE_TIMEOUT_MS) {
      items.push({
        username,
        onlineSince: new Date(state.firstSeen).toISOString(),
        lastActivity: new Date(state.lastSeen).toISOString(),
        ipAddress: state.ipAddress,
        userAgent: state.userAgent,
        idleSeconds: Math.round((now - state.lastSeen) / 1000),
      });
    }
  }
  items.sort((a, b) => a.username.localeCompare(b.username));
  return items;
}

// ---- 登录/登出记录 ----

async function recordLogin(username, req) {
  try {
    // 查找 userId
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    await prisma.loginRecord.create({
      data: {
        username,
        userId: user?.id || null,
        action: 'login',
        ipAddress: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 256),
      },
    });
  } catch (error) {
    console.error('❌ 记录登录失败:', error.message);
  }
}

async function recordLogout(username, req) {
  try {
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    await prisma.loginRecord.create({
      data: {
        username,
        userId: user?.id || null,
        action: 'logout',
        ipAddress: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 256),
      },
    });
  } catch (error) {
    console.error('❌ 记录登出失败:', error.message);
  }
}

/**
 * 异步补全 LoginRecord 的 userId：auth.js 里拿不到 user.id，需要后补。
 */
async function backfillLoginUserIds() {
  try {
    const records = await prisma.loginRecord.findMany({
      where: { userId: '' },
      take: 1000,
    });
    for (const record of records) {
      const user = await prisma.user.findUnique({ where: { username: record.username }, select: { id: true } });
      if (user) {
        await prisma.loginRecord.update({ where: { id: record.id }, data: { userId: user.id } });
      }
    }
  } catch (error) {
    console.error('❌ 补全 userId 失败:', error.message);
  }
}

// ---- 管理员查询 API ----

async function getLoginHistory(username, limit = 50) {
  try {
    const records = await prisma.loginRecord.findMany({
      where: { username },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return records.map((r) => ({
      id: r.id,
      action: r.action,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('❌ 查询登录历史失败:', error.message);
    return [];
  }
}

async function getUserActivityTimeline(username, limit = 100) {
  try {
    // 结合 homeToolUsage 和 dailyToolUsage 给出用户的完整活动时间线
    const [toolUsages, loginRecords] = await Promise.all([
      prisma.homeToolUsage.findMany({
        where: { owner: { username } },
        select: { toolSlug: true, lastOpenedAt: true, openCount: true },
        orderBy: { lastOpenedAt: 'desc' },
        take: limit,
      }),
      prisma.loginRecord.findMany({
        where: { username },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    // 合并成统一时间线
    const timeline = [];

    for (const usage of toolUsages) {
      timeline.push({
        type: 'tool_access',
        toolSlug: usage.toolSlug,
        detail: `访问了 ${usage.toolSlug}（共 ${usage.openCount} 次）`,
        timestamp: usage.lastOpenedAt.toISOString(),
      });
    }

    for (const record of loginRecords) {
      timeline.push({
        type: record.action === 'login' ? 'login' : 'logout',
        detail: record.action === 'login' ? '登录系统' : '退出登录',
        ipAddress: record.ipAddress,
        timestamp: record.createdAt.toISOString(),
      });
    }

    timeline.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return timeline.slice(0, limit);
  } catch (error) {
    console.error('❌ 查询活动时间线失败:', error.message);
    return [];
  }
}

async function searchUsers(query) {
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query } },
        ],
      },
      include: {
        permissions: { select: { permission: true } },
        _count: {
          select: {
            homeToolUsage: true,
            loginRecords: true,
          },
        },
      },
      orderBy: { username: 'asc' },
      take: 50,
    });

    const now = Date.now();
    return users.map((user) => {
      const online = onlineUsers.has(user.username) && (now - onlineUsers.get(user.username).lastSeen) < OFFLINE_TIMEOUT_MS;
      return {
        username: user.username,
        permissions: user.permissions.map((p) => p.permission),
        isAdmin: user.permissions.some((p) => p.permission === '*'),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        online,
        toolCount: user._count.homeToolUsage,
        loginCount: user._count.loginRecords,
      };
    });
  } catch (error) {
    console.error('❌ 搜索用户失败:', error.message);
    return [];
  }
}

async function getUserDetail(username) {
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        permissions: { select: { permission: true } },
        _count: {
          select: {
            homeToolUsage: true,
            loginRecords: true,
            decks: true,
            savings: true,
            chatMessages: true,
            edhLifeGames: true,
          },
        },
      },
    });
    if (!user) return null;

    const now = Date.now();
    const onlineState = onlineUsers.get(username);
    const online = Boolean(onlineState && (now - onlineState.lastSeen) < OFFLINE_TIMEOUT_MS);

    // 获取最常用的工具
    const topTools = await prisma.homeToolUsage.findMany({
      where: { ownerId: user.id },
      orderBy: { openCount: 'desc' },
      take: 10,
      select: { toolSlug: true, openCount: true, lastOpenedAt: true },
    });

    // 获取最后登录记录
    const lastLogin = await prisma.loginRecord.findFirst({
      where: { username, action: 'login' },
      orderBy: { createdAt: 'desc' },
    });

    // 最近7天活跃概况
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentDaily = await prisma.dailyToolUsage.findMany({
      where: { ownerId: user.id, dayKey: { gte: weekAgo } },
      select: { dayKey: true, openCount: true },
      orderBy: { dayKey: 'asc' },
    });

    const lastActivityTime = onlineState?.lastSeen
      ? new Date(onlineState.lastSeen).toISOString()
      : topTools.length > 0
        ? topTools[0].lastOpenedAt.toISOString()
        : user.updatedAt.toISOString();

    return {
      username: user.username,
      permissions: user.permissions.map((p) => p.permission),
      isAdmin: user.permissions.some((p) => p.permission === '*'),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      online,
      onlineSince: onlineState ? new Date(onlineState.firstSeen).toISOString() : null,
      lastActivity: lastActivityTime,
      ipAddress: onlineState?.ipAddress || (lastLogin?.ipAddress || null),
      counts: {
        toolsUsed: user._count.homeToolUsage,
        logins: user._count.loginRecords,
        decks: user._count.decks,
        savings: user._count.savings,
        chatMessages: user._count.chatMessages,
        games: user._count.edhLifeGames,
      },
      topTools: topTools.map((t) => ({
        toolSlug: t.toolSlug,
        openCount: t.openCount,
        lastOpenedAt: t.lastOpenedAt.toISOString(),
      })),
      lastLogin: lastLogin
        ? { ipAddress: lastLogin.ipAddress, createdAt: lastLogin.createdAt.toISOString() }
        : null,
      weeklyActivity: recentDaily.map((d) => ({
        dayKey: d.dayKey,
        openCount: d.openCount,
      })),
    };
  } catch (error) {
    console.error('❌ 查询用户详情失败:', error.message);
    return null;
  }
}

module.exports = {
  startCleanup,
  stopCleanup,
  recordHeartbeat,
  syncChatPresence,
  getOnlineUsers,
  recordLogin,
  recordLogout,
  getLoginHistory,
  getUserActivityTimeline,
  searchUsers,
  getUserDetail,
  onlineUsers,
};