'use strict';

const { prisma } = require('./db');

const HOME_THEMES = ['midnight', 'aurora', 'paper', 'sunset'];
const VIEW_MODES = ['grid', 'list'];
const CATEGORY_KEYS = ['learning', 'ai', 'game', 'utility', 'visualization', 'life'];
const MAX_FAVORITES = 12;
const MAX_ORDERED_TOOLS = 64;
const MAX_RECENT_TOOLS = 8;
const PROFILE_TIMELINE_LIMIT = 6;
const PROFILE_HEATMAP_DAYS = 70;
const DAY_MS = 24 * 60 * 60 * 1000;

class HomePreferencesError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'HomePreferencesError';
    this.statusCode = statusCode;
  }
}

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function unique(values, limit) {
  return [...new Set(values)].slice(0, limit);
}

function normalizeToolSlugs(value, allowedTools, field, limit) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new HomePreferencesError(`${field} 必须是工具标识数组。`);
  const normalized = unique(value, limit);
  if (normalized.some((slug) => !allowedTools.has(slug))) throw new HomePreferencesError(`${field} 包含未授权或无效的工具。`);
  return normalized;
}

function normalizeCategories(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new HomePreferencesError('折叠分类必须是分类标识数组。');
  const normalized = unique(value, CATEGORY_KEYS.length);
  if (normalized.some((category) => !CATEGORY_KEYS.includes(category))) throw new HomePreferencesError('折叠分类包含无效值。');
  return normalized;
}

function toPublicPreference(record, allowedTools) {
  const allowed = new Set(allowedTools);
  return {
    favoriteToolSlugs: parseStringArray(record?.favoriteToolSlugsJson || '[]').filter((slug) => allowed.has(slug)),
    toolOrder: parseStringArray(record?.toolOrderJson || '[]').filter((slug) => allowed.has(slug)),
    collapsedCategories: parseStringArray(record?.collapsedCategoriesJson || '[]').filter((category) => CATEGORY_KEYS.includes(category)),
    theme: HOME_THEMES.includes(record?.theme) ? record.theme : 'midnight',
    viewMode: VIEW_MODES.includes(record?.viewMode) ? record.viewMode : 'grid',
  };
}

function dayKeyFor(date = new Date()) {
  // UTC day avoids server-local timezone shifts and keeps profile aggregation deterministic.
  return date.toISOString().slice(0, 10);
}

function recentDayKeys(count, today = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (count - 1 - index) * DAY_MS);
    return dayKeyFor(date);
  });
}

async function getOwnerId(username) {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new HomePreferencesError('账户不存在。', 404);
  return user.id;
}

async function getHomePreferences(username, allowedTools) {
  const ownerId = await getOwnerId(username);
  const [preference, usages] = await Promise.all([
    prisma.homePreference.findUnique({ where: { ownerId } }),
    prisma.homeToolUsage.findMany({
      where: { ownerId, toolSlug: { in: allowedTools } },
      orderBy: [{ lastOpenedAt: 'desc' }, { toolSlug: 'asc' }],
      take: MAX_RECENT_TOOLS,
    }),
  ]);
  return {
    ...toPublicPreference(preference, allowedTools),
    recentTools: usages.map((usage) => ({ toolSlug: usage.toolSlug, lastOpenedAt: usage.lastOpenedAt.toISOString(), openCount: usage.openCount })),
  };
}

async function saveHomePreferences(username, patch, allowedTools) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HomePreferencesError('请求体无效。');
  const allowed = new Set(allowedTools);
  const data = {};
  if (Object.hasOwn(patch, 'favoriteToolSlugs')) data.favoriteToolSlugsJson = JSON.stringify(normalizeToolSlugs(patch.favoriteToolSlugs, allowed, '收藏工具', MAX_FAVORITES));
  if (Object.hasOwn(patch, 'toolOrder')) data.toolOrderJson = JSON.stringify(normalizeToolSlugs(patch.toolOrder, allowed, '工具排序', MAX_ORDERED_TOOLS));
  if (Object.hasOwn(patch, 'collapsedCategories')) data.collapsedCategoriesJson = JSON.stringify(normalizeCategories(patch.collapsedCategories));
  if (Object.hasOwn(patch, 'theme')) {
    if (typeof patch.theme !== 'string' || !HOME_THEMES.includes(patch.theme)) throw new HomePreferencesError('首页主题无效。');
    data.theme = patch.theme;
  }
  if (Object.hasOwn(patch, 'viewMode')) {
    if (typeof patch.viewMode !== 'string' || !VIEW_MODES.includes(patch.viewMode)) throw new HomePreferencesError('工具视图无效。');
    data.viewMode = patch.viewMode;
  }
  if (Object.keys(data).length === 0) throw new HomePreferencesError('没有可保存的首页偏好。');
  const ownerId = await getOwnerId(username);
  await prisma.homePreference.upsert({
    where: { ownerId },
    create: { ownerId, ...data },
    update: data,
  });
  return getHomePreferences(username, allowedTools);
}

async function recordToolUsage(username, toolSlug, allowedTools) {
  if (typeof toolSlug !== 'string' || !allowedTools.includes(toolSlug)) throw new HomePreferencesError('工具不存在或当前账户无权访问。', 403);
  const ownerId = await getOwnerId(username);
  const now = new Date();
  await Promise.all([
    prisma.homeToolUsage.upsert({
      where: { ownerId_toolSlug: { ownerId, toolSlug } },
      create: { ownerId, toolSlug, lastOpenedAt: now, openCount: 1 },
      update: { lastOpenedAt: now, openCount: { increment: 1 } },
    }),
    prisma.dailyToolUsage.upsert({
      where: { ownerId_toolSlug_dayKey: { ownerId, toolSlug, dayKey: dayKeyFor(now) } },
      create: { ownerId, toolSlug, dayKey: dayKeyFor(now), openCount: 1 },
      update: { openCount: { increment: 1 } },
    }),
  ]);
}

async function getProfileSummary(username, allowedTools) {
  const ownerId = await getOwnerId(username);
  const [preference, usages, daily] = await Promise.all([
    prisma.homePreference.findUnique({ where: { ownerId } }),
    prisma.homeToolUsage.findMany({ where: { ownerId, toolSlug: { in: allowedTools } }, orderBy: [{ lastOpenedAt: 'desc' }, { toolSlug: 'asc' }] }),
    prisma.dailyToolUsage.findMany({ where: { ownerId, toolSlug: { in: allowedTools }, dayKey: { in: recentDayKeys(PROFILE_HEATMAP_DAYS) } }, orderBy: [{ dayKey: 'asc' }, { updatedAt: 'desc' }] }),
  ]);
  const recentTools = usages.slice(0, MAX_RECENT_TOOLS).map((usage) => ({ toolSlug: usage.toolSlug, lastOpenedAt: usage.lastOpenedAt.toISOString(), openCount: usage.openCount }));
  const frequentTools = [...usages].sort((left, right) => right.openCount - left.openCount || right.lastOpenedAt - left.lastOpenedAt || left.toolSlug.localeCompare(right.toolSlug)).slice(0, 8).map((usage) => ({ toolSlug: usage.toolSlug, lastOpenedAt: usage.lastOpenedAt.toISOString(), openCount: usage.openCount }));
  const days = recentDayKeys(PROFILE_HEATMAP_DAYS);
  const activityByDay = new Map(days.map((dayKey) => [dayKey, 0]));
  for (const usage of daily) activityByDay.set(usage.dayKey, (activityByDay.get(usage.dayKey) || 0) + usage.openCount);
  const today = dayKeyFor();
  let activeDays = 0;
  let streak = 0;
  let streakStarted = false;
  for (const dayKey of [...days].reverse()) {
    const count = activityByDay.get(dayKey) || 0;
    if (count > 0) activeDays += 1;
    // 今天尚未使用时，不让它中断截至昨天的连续记录；一旦遇到真正的空档则结束。
    if (!streakStarted && dayKey === today && count === 0) continue;
    if (count > 0) { streak += 1; streakStarted = true; } else if (streakStarted) break;
  }
  const totalOpens = usages.reduce((sum, usage) => sum + usage.openCount, 0);
  const exploredTools = usages.length;
  const weekKeys = new Set(days.slice(-7));
  const weekOpens = daily.filter((usage) => weekKeys.has(usage.dayKey)).reduce((sum, usage) => sum + usage.openCount, 0);
  return {
    ...toPublicPreference(preference, allowedTools), recentTools, frequentTools,
    activity: { days: days.map((dayKey) => ({ dayKey, openCount: activityByDay.get(dayKey) || 0 })), activeDays, streak, weekOpens, totalOpens, exploredTools },
    milestones: [
      { id: 'first-tool', title: '初次探索', description: '打开过第一个工具', unlocked: exploredTools >= 1, value: exploredTools, target: 1 },
      { id: 'collector', title: '工具探索者', description: '探索 5 个不同工具', unlocked: exploredTools >= 5, value: exploredTools, target: 5 },
      { id: 'regular', title: '持续使用', description: '连续使用 3 天', unlocked: streak >= 3, value: streak, target: 3 },
      { id: 'power-user', title: '高频玩家', description: '累计打开 25 次工具', unlocked: totalOpens >= 25, value: totalOpens, target: 25 },
    ],
  };
}

module.exports = { HomePreferencesError, HOME_THEMES, VIEW_MODES, CATEGORY_KEYS, getHomePreferences, getProfileSummary, saveHomePreferences, recordToolUsage };
