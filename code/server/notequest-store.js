'use strict';

/**
 * NoteQuest 单人地牢探索的 SQLite 读写。
 *
 * 一局游戏 = 一条 NoteQuestRun：
 *   - stateJson 保存完整快照（地图、角色、日志），刷新或换设备都能原样恢复；
 *   - 摘要列（角色名、地牢名、层数、金币、火把、HP、回合数）让存档列表不必解析整包 JSON；
 *   - 角色死亡或主动放弃时，自动在 NoteQuestGrave 里补一条墓地记录（原书第 24 页那张表）。
 *
 * 所有查询都以 owner.username 为边界，账户之间互相看不见。
 */

const { prisma } = require('./db');

const MAX_TITLE_LENGTH = 60;
const MAX_STATE_BYTES = 400 * 1024;
/** 请求体上限：快照 + JSON 包装的余量（读 body 时用它，超了直接 413） */
const MAX_BODY_BYTES = MAX_STATE_BYTES + 16 * 1024;
const MAX_TEXT_LENGTH = 200;
const MAX_RUNS_PER_USER = 30;
const MAX_GRAVES = 200;

class NoteQuestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asString(value, maxLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch { return fallback; }
}

/** 客户端可能提交任意结构，这里只做「形状 + 体积」两道检查，具体字段由前端引擎负责。 */
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new NoteQuestError(400, '缺少存档状态。');
  if (typeof raw.version !== 'number' || !raw.hero || !raw.dungeon || !Array.isArray(raw.dungeon.nodes)) {
    throw new NoteQuestError(400, '存档状态结构不正确。');
  }
  const text = JSON.stringify(raw);
  if (text.length > MAX_STATE_BYTES) throw new NoteQuestError(413, '存档状态过大，无法保存。');
  return text;
}

/** 从快照里抽取列表需要的摘要列（以服务端为准，避免客户端传错）。 */
function columnsFromState(state) {
  const hero = state.hero || {};
  const dungeon = state.dungeon || {};
  const stats = state.stats || {};
  const outcome = state.outcome || {};
  return {
    heroName: asString(hero.name, MAX_TEXT_LENGTH, ''),
    raceName: asString(hero.raceName, MAX_TEXT_LENGTH, ''),
    className: asString(hero.className, MAX_TEXT_LENGTH, ''),
    dungeonName: asString(dungeon.name, MAX_TEXT_LENGTH, ''),
    dungeonTypeId: asString(dungeon.typeId, 40, 'palace'),
    depth: clampInt(dungeon.depth, 1, 99, 1),
    status: ['dead', 'cleared'].includes(state.status) ? state.status : 'active',
    turns: clampInt(stats.turns, 0, 100000, 0),
    kills: clampInt(stats.kills, 0, 100000, 0),
    treasures: clampInt(stats.treasures, 0, 100000, 0),
    coins: clampInt(hero.coins, 0, 10000000, 0),
    torches: clampInt(hero.torches, 0, 99, 0),
    hp: clampInt(hero.hp, -999, 100000, 0),
    maxHp: clampInt(hero.maxHp, 1, 100000, 1),
    outcomeText: asString(outcome.text, MAX_TEXT_LENGTH, ''),
  };
}

function toSummary(row) {
  return {
    id: row.id,
    title: row.title,
    heroName: row.heroName,
    raceName: row.raceName,
    className: row.className,
    dungeonName: row.dungeonName,
    dungeonTypeId: row.dungeonTypeId,
    depth: row.depth,
    status: row.status,
    turns: row.turns,
    kills: row.kills,
    treasures: row.treasures,
    coins: row.coins,
    torches: row.torches,
    hp: row.hp,
    maxHp: row.maxHp,
    outcomeText: row.outcomeText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

function toDetail(row) {
  return { ...toSummary(row), state: parseJson(row.stateJson, null) };
}

function toGrave(row) {
  return {
    id: row.id,
    runId: row.runId,
    characterName: row.characterName,
    raceName: row.raceName,
    className: row.className,
    dungeonName: row.dungeonName,
    dungeonTypeId: row.dungeonTypeId,
    depth: row.depth,
    cause: row.cause,
    kills: row.kills,
    treasures: row.treasures,
    diedAt: row.diedAt.toISOString(),
  };
}

/** 死亡结算：同一条存档只写一次墓地记录。 */
async function ensureGrave(ownerId, run, state) {
  if (run.status !== 'dead') return;
  const existing = await prisma.noteQuestGrave.findFirst({ where: { runId: run.id } });
  if (existing) return;
  const hero = state.hero || {};
  const dungeon = state.dungeon || {};
  const outcome = state.outcome || {};
  await prisma.noteQuestGrave.create({
    data: {
      ownerId,
      runId: run.id,
      characterName: asString(hero.name, MAX_TEXT_LENGTH, '无名探索者'),
      raceName: asString(hero.raceName, MAX_TEXT_LENGTH, ''),
      className: asString(hero.className, MAX_TEXT_LENGTH, ''),
      dungeonName: asString(dungeon.name, MAX_TEXT_LENGTH, ''),
      dungeonTypeId: asString(dungeon.typeId, 40, ''),
      depth: clampInt(dungeon.depth, 1, 99, 1),
      cause: asString(outcome.text, MAX_TEXT_LENGTH, '未知原因'),
      kills: clampInt((state.stats || {}).kills, 0, 100000, 0),
      treasures: clampInt((state.stats || {}).treasures, 0, 100000, 0),
    },
  });
  const extra = await prisma.noteQuestGrave.findMany({
    where: { ownerId },
    orderBy: { diedAt: 'desc' },
    skip: MAX_GRAVES,
    select: { id: true },
  });
  if (extra.length) await prisma.noteQuestGrave.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
}

/** 每个账号最多留 MAX_RUNS_PER_USER 条存档：超了就删最旧的已经结束的那条。 */
async function pruneRuns(ownerId) {
  const runs = await prisma.noteQuestRun.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true },
  });
  if (runs.length <= MAX_RUNS_PER_USER) return;
  const removable = runs.slice(MAX_RUNS_PER_USER).filter((run) => run.status !== 'active');
  if (!removable.length) return;
  await prisma.noteQuestRun.deleteMany({ where: { id: { in: removable.map((run) => run.id) } } });
}

async function listRuns(username) {
  const rows = await prisma.noteQuestRun.findMany({
    where: { owner: { username } },
    orderBy: { updatedAt: 'desc' },
    take: MAX_RUNS_PER_USER,
  });
  return rows.map(toSummary);
}

async function getRun(username, id) {
  const row = await prisma.noteQuestRun.findFirst({ where: { id, owner: { username } } });
  return row ? toDetail(row) : null;
}

async function createRun(username, payload) {
  const stateText = sanitizeState(payload?.state);
  const state = parseJson(stateText, {});
  const columns = columnsFromState(state);
  const title = asString(payload?.title, MAX_TITLE_LENGTH, '') || `${columns.heroName} · ${columns.dungeonName}`;
  const created = await prisma.noteQuestRun.create({
    data: {
      owner: { connect: { username } },
      title,
      stateJson: stateText,
      endedAt: columns.status === 'active' ? null : new Date(),
      ...columns,
    },
  });
  await pruneRuns(created.ownerId);
  return toDetail(created);
}

async function updateRun(username, id, payload) {
  const existing = await prisma.noteQuestRun.findFirst({ where: { id, owner: { username } } });
  if (!existing) return null;
  const data = {};
  if (payload?.title !== undefined) data.title = asString(payload.title, MAX_TITLE_LENGTH, '') || existing.title;
  if (payload?.state !== undefined) {
    const stateText = sanitizeState(payload.state);
    data.stateJson = stateText;
    Object.assign(data, columnsFromState(parseJson(stateText, {})));
    if (data.status !== 'active' && !existing.endedAt) data.endedAt = new Date();
  }
  const updated = await prisma.noteQuestRun.update({ where: { id }, data });
  await ensureGrave(updated.ownerId, updated, parseJson(updated.stateJson, {}));
  return toDetail(updated);
}

async function deleteRun(username, id) {
  const result = await prisma.noteQuestRun.deleteMany({ where: { id, owner: { username } } });
  return result.count > 0;
}

async function listGraves(username) {
  const rows = await prisma.noteQuestGrave.findMany({
    where: { owner: { username } },
    orderBy: { diedAt: 'desc' },
    take: MAX_GRAVES,
  });
  return rows.map(toGrave);
}

module.exports = {
  NoteQuestError,
  MAX_RUNS_PER_USER,
  MAX_STATE_BYTES,
  MAX_BODY_BYTES,
  listRuns,
  getRun,
  createRun,
  updateRun,
  deleteRun,
  listGraves,
};