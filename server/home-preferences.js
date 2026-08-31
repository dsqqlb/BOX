'use strict';

const { prisma } = require('./db');

const HOME_THEMES = ['midnight', 'aurora', 'paper', 'sunset'];
const VIEW_MODES = ['grid', 'list'];
const CATEGORY_KEYS = ['learning', 'ai', 'game', 'utility', 'visualization', 'life'];
const MAX_FAVORITES = 12;
const MAX_ORDERED_TOOLS = 64;
const MAX_RECENT_TOOLS = 8;

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
  await prisma.homeToolUsage.upsert({
    where: { ownerId_toolSlug: { ownerId, toolSlug } },
    create: { ownerId, toolSlug, lastOpenedAt: now, openCount: 1 },
    update: { lastOpenedAt: now, openCount: { increment: 1 } },
  });
}

module.exports = { HomePreferencesError, HOME_THEMES, VIEW_MODES, CATEGORY_KEYS, getHomePreferences, saveHomePreferences, recordToolUsage };
