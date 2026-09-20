'use strict';

/**
 * 先攻追踪器遥控器的「备选角色池」：按账户存进 SQLite，不再只存在浏览器 localStorage。
 *
 * 为什么搬到服务端：角色池是 DM 每场都要用的东西，之前只存在 localStorage，换浏览器、
 * 清缓存、换设备就全没了。这里一人一行（InitiativeReservePool.poolJson），遥控器打开时
 * 拉一次、改动后防抖回写。
 *
 * 只保存备选池里的角色（inCombat = false）：战斗区角色属于房间，由 WebSocket 实时同步。
 * 同一账户多端同时改是「最后写入生效」，不做字段级合并——角色池是一个整体列表，
 * 按条目合并反而会拼出难以解释的半成品状态。
 *
 * 写入按外部输入处理：字段级白名单 + 逐项丢弃非法条目（而不是整包报错），
 * 保证遥控器任何时候都能加载出一个可用的池子。
 */

const { prisma } = require('./db');

const MAX_CHARACTERS = 200;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_TOKEN_LENGTH = 40;
const MAX_URL_LENGTH = 600;
const MAX_STATUSES = 32;
const MAX_STATUS_ID_LENGTH = 40;
const MAX_INITIATIVE = 9999;
const MIN_INITIATIVE = -999;
const CHARACTER_TYPES = ['player', 'enemy', 'npc'];
const DEFAULT_COLOR = '#64748b';
// 颜色统一成 #rgb / #rrggbb / #rrggbbaa，前端两类颜色（card 底色、自定义边框色）都是这个格式。
const HEX_COLOR = /^#[0-9a-f]{3,8}$/;
// 请求体上限：200 个带状态的角色序列化后约 200 KB，留一倍余量。
const MAX_POOL_BYTES = 512 * 1024;

class InitiativePoolError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InitiativePoolError';
    this.statusCode = statusCode;
  }
}

function text(value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; }
function hexColor(value) { const raw = text(value, MAX_ID_LENGTH).trim().toLowerCase(); return HEX_COLOR.test(raw) ? raw : ''; }
function integersInRange(value, min, max) { return Number.isFinite(Number(value)) ? Math.min(Math.max(Math.round(Number(value)), min), max) : null; }

/** 状态实例：白名单字段；statusId 不做枚举校验（服务端不复制客户端的常量表，版本差异不该丢数据）。 */
function normalizeStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = text(value.id, MAX_ID_LENGTH).trim();
  const statusId = text(value.statusId, MAX_STATUS_ID_LENGTH).trim();
  if (!id || !statusId) return null;

  const status = {
    id,
    statusId,
    // duration：null = 无限，不随回合递减；其余按剩余回合数存。
    duration: value.duration === null || value.duration === undefined ? null : integersInRange(value.duration, 0, 9999),
  };
  // 力竭专用：等级 1~6
  if (value.level !== undefined && value.level !== null) {
    const level = integersInRange(value.level, 1, 6);
    if (level !== null) status.level = level;
  }
  // 濒死专用：死亡豁免成功/失败次数
  for (const key of ['successes', 'failures']) {
    if (value[key] === undefined || value[key] === null) continue;
    const count = integersInRange(value[key], 0, 99);
    if (count !== null) status[key] = count;
  }
  return status;
}

function normalizeCharacter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = text(value.id, MAX_ID_LENGTH).trim();
  const name = text(value.name, MAX_NAME_LENGTH).trim();
  if (!id || !name) return null;

  const character = {
    id,
    name,
    initiative: integersInRange(value.initiative, MIN_INITIATIVE, MAX_INITIATIVE) ?? 0,
    token: text(value.token, MAX_TOKEN_LENGTH),
    type: CHARACTER_TYPES.includes(value.type) ? value.type : 'enemy',
    color: hexColor(value.color) || DEFAULT_COLOR,
    // 备选池里的角色一律不在战斗区，也不保留 combatId（拖进战斗区时会重新生成）。
    inCombat: false,
  };

  const imageUrl = text(value.imageUrl, MAX_URL_LENGTH).trim();
  if (imageUrl) character.imageUrl = imageUrl;
  const borderColor = hexColor(value.borderColor);
  if (borderColor) character.borderColor = borderColor;

  const statuses = Array.isArray(value.statuses)
    ? value.statuses.map(normalizeStatus).filter(Boolean).slice(0, MAX_STATUSES)
    : [];
  if (statuses.length) character.statuses = statuses;

  return character;
}

/** 归一化整个角色池：非法条目与重复 id 直接丢弃。 */
function normalizePool(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new InitiativePoolError('角色池必须是数组。');
  if (value.length > MAX_CHARACTERS * 4) throw new InitiativePoolError(`备选角色池最多 ${MAX_CHARACTERS} 个角色。`, 413);

  const seen = new Set();
  const pool = [];
  for (const item of value) {
    const character = normalizeCharacter(item);
    if (!character || seen.has(character.id)) continue;
    seen.add(character.id);
    pool.push(character);
  }
  if (pool.length > MAX_CHARACTERS) throw new InitiativePoolError(`备选角色池最多 ${MAX_CHARACTERS} 个角色。`, 413);
  return pool;
}

async function ownerIdFor(username) {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new InitiativePoolError('账户不存在。', 404);
  return user.id;
}

function toPublicPool(record) {
  let pool = [];
  try { pool = normalizePool(JSON.parse(record?.poolJson || '[]')); } catch { pool = []; }
  return {
    pool,
    updatedAt: record?.updatedAt ? record.updatedAt.toISOString() : null,
    limit: MAX_CHARACTERS,
  };
}

async function getPool(username) {
  const ownerId = await ownerIdFor(username);
  return toPublicPool(await prisma.initiativeReservePool.findUnique({ where: { ownerId } }));
}

async function savePool(username, value) {
  const pool = normalizePool(value);
  const ownerId = await ownerIdFor(username);
  const record = await prisma.initiativeReservePool.upsert({
    where: { ownerId },
    create: { ownerId, poolJson: JSON.stringify(pool) },
    update: { poolJson: JSON.stringify(pool) },
  });
  return toPublicPool(record);
}

module.exports = { InitiativePoolError, MAX_POOL_BYTES, MAX_CHARACTERS, normalizePool, getPool, savePool };