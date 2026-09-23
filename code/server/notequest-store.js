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
/** 人物池与永久地牢的上限与体积 */
const MAX_CHARACTERS_PER_USER = 24;
const MAX_DUNGEONS_PER_USER = 12;
const MAX_HERO_BYTES = 24 * 1024;
const MAX_DUNGEON_BYTES = 900 * 1024;
/** 存档栏位数量：每个账号三个，首页切换，栏位之间完全隔离。 */
const SLOT_COUNT = 3;

/** 栏位号只接受 0..SLOT_COUNT-1，其余一律当 0。 */
function normalizeSlot(value) {
  return clampInt(value, 0, SLOT_COUNT - 1, 0);
}

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
    slot: row.slot ?? 0,
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
    characterId: row.characterId ?? null,
    dungeonId: row.dungeonId ?? null,
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
    slot: row.slot ?? 0,
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
      slot: run.slot ?? 0,
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
    where: { ownerId, slot: run.slot ?? 0 },
    orderBy: { diedAt: 'desc' },
    skip: MAX_GRAVES,
    select: { id: true },
  });
  if (extra.length) await prisma.noteQuestGrave.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
}

/** 一个栏位最多留 MAX_RUNS_PER_USER 条存档：超了就删最旧的已经结束的那条。 */
async function pruneRuns(ownerId, slot) {
  const runs = await prisma.noteQuestRun.findMany({
    where: { ownerId, slot },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true },
  });
  if (runs.length <= MAX_RUNS_PER_USER) return;
  const removable = runs.slice(MAX_RUNS_PER_USER).filter((run) => run.status !== 'active');
  if (!removable.length) return;
  await prisma.noteQuestRun.deleteMany({ where: { id: { in: removable.map((run) => run.id) } } });
}

async function listRuns(username, slot) {
  const rows = await prisma.noteQuestRun.findMany({
    where: { owner: { username }, slot },
    orderBy: { updatedAt: 'desc' },
    take: MAX_RUNS_PER_USER,
  });
  return rows.map(toSummary);
}

async function getRun(username, id) {
  const row = await prisma.noteQuestRun.findFirst({ where: { id, owner: { username } } });
  return row ? toDetail(row) : null;
}

/* ── 存档栏位：首页切换，栏位之间完全隔离 ── */

/** 每个栏目一个概览：进行中的那局、最近一局、各类数据条数，首页用它渲染三张存档卡。 */
async function listSlots(username) {
  const slots = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const [runs, characters, dungeons, graves] = await Promise.all([
      prisma.noteQuestRun.findMany({
        where: { owner: { username }, slot },
        orderBy: { updatedAt: 'desc' },
        take: MAX_RUNS_PER_USER,
      }),
      prisma.noteQuestCharacter.count({ where: { owner: { username }, slot } }),
      prisma.noteQuestDungeon.count({ where: { owner: { username }, slot } }),
      prisma.noteQuestGrave.count({ where: { owner: { username }, slot } }),
    ]);
    const active = runs.find((run) => run.status === 'active') ?? null;
    const latest = runs[0] ?? null;
    slots.push({
      slot,
      activeRun: active ? toSummary(active) : null,
      latestRun: latest ? toSummary(latest) : null,
      runs: runs.length,
      characters,
      dungeons,
      graves,
      updatedAt: latest ? latest.updatedAt.toISOString() : null,
    });
  }
  return slots;
}

/** 清空一个栏位：存档、人物池、永久地牢与墓地一起删掉（其他栏位不受影响）。 */
async function clearSlot(username, slot) {
  const owner = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!owner) return null;
  const [runs, characters, dungeons, graves] = await Promise.all([
    prisma.noteQuestRun.deleteMany({ where: { ownerId: owner.id, slot } }),
    prisma.noteQuestCharacter.deleteMany({ where: { ownerId: owner.id, slot } }),
    prisma.noteQuestDungeon.deleteMany({ where: { ownerId: owner.id, slot } }),
    prisma.noteQuestGrave.deleteMany({ where: { ownerId: owner.id, slot } }),
  ]);
  return { slot, runs: runs.count, characters: characters.count, dungeons: dungeons.count, graves: graves.count };
}

async function createRun(username, payload, slot) {
  const stateText = sanitizeState(payload?.state);
  const state = parseJson(stateText, {});
  const columns = columnsFromState(state);
  const title = asString(payload?.title, MAX_TITLE_LENGTH, '') || `${columns.heroName} · ${columns.dungeonName}`;
  // 关联到人物池与永久地牢：只有属于本账号的 id 才会写入（否则留 null）。
  // 用嵌套 connect 而不是裸外键字段：create 里已经用了 owner 的嵌套写法，不能混用 unchecked 形式。
  const characterId = await ownCharacterId(username, payload?.characterId ?? state.characterId);
  const dungeonId = await ownDungeonId(username, payload?.dungeonId ?? state.dungeonId);
  const created = await prisma.noteQuestRun.create({
    data: {
      owner: { connect: { username } },
      slot: normalizeSlot(slot),
      ...(characterId ? { character: { connect: { id: characterId } } } : {}),
      ...(dungeonId ? { dungeon: { connect: { id: dungeonId } } } : {}),
      title,
      stateJson: stateText,
      endedAt: columns.status === 'active' ? null : new Date(),
      ...columns,
    },
  });
  await pruneRuns(created.ownerId, created.slot);
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

async function listGraves(username, slot) {
  const rows = await prisma.noteQuestGrave.findMany({
    where: { owner: { username }, slot },
    orderBy: { diedAt: 'desc' },
    take: MAX_GRAVES,
  });
  return rows.map(toGrave);
}

/* ── 人物池：掷骰建角与自定义建角共用一张表，存完整角色快照 ── */

function sanitizeHero(raw) {
  if (!raw || typeof raw !== 'object') throw new NoteQuestError(400, '缺少角色状态。');
  if (typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.raceId !== 'string' || typeof raw.classId !== 'string') {
    throw new NoteQuestError(400, '角色状态结构不正确（需要 name / raceId / classId）。');
  }
  const text = JSON.stringify(raw);
  if (text.length > MAX_HERO_BYTES) throw new NoteQuestError(413, '角色状态过大，无法保存。');
  return text;
}

function characterColumns(hero) {
  return {
    name: asString(hero.name, MAX_TEXT_LENGTH, '无名探索者'),
    raceId: asString(hero.raceId, 40, ''),
    raceName: asString(hero.raceName, MAX_TEXT_LENGTH, ''),
    classId: asString(hero.classId, 40, ''),
    className: asString(hero.className, MAX_TEXT_LENGTH, ''),
    maxHp: clampInt(hero.maxHp, 1, 100000, 1),
  };
}

function toCharacter(row) {
  return {
    id: row.id,
    slot: row.slot ?? 0,
    name: row.name,
    raceId: row.raceId,
    raceName: row.raceName,
    classId: row.classId,
    className: row.className,
    status: ['dead', 'retired'].includes(row.status) ? row.status : 'active',
    maxHp: row.maxHp,
    hero: parseJson(row.heroJson, {}),
    runs: row.runs,
    deaths: row.deaths,
    lastOutcome: row.lastOutcome,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 一个栏位最多留 MAX_CHARACTERS_PER_USER 个角色：超了删最旧的（有进行中存档的跳过）。 */
async function pruneCharacters(ownerId, slot) {
  const rows = await prisma.noteQuestCharacter.findMany({ where: { ownerId, slot }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  if (rows.length <= MAX_CHARACTERS_PER_USER) return;
  const removable = rows.slice(MAX_CHARACTERS_PER_USER);
  const busy = await prisma.noteQuestRun.findMany({
    where: { ownerId, slot, status: 'active', characterId: { in: removable.map((row) => row.id) } },
    select: { characterId: true },
  });
  const busyIds = new Set(busy.map((row) => row.characterId));
  const ids = removable.filter((row) => !busyIds.has(row.id)).map((row) => row.id);
  if (ids.length) await prisma.noteQuestCharacter.deleteMany({ where: { id: { in: ids } } });
}

async function listCharacters(username, slot) {
  const rows = await prisma.noteQuestCharacter.findMany({
    where: { owner: { username }, slot },
    orderBy: { updatedAt: 'desc' },
    take: MAX_CHARACTERS_PER_USER,
  });
  return rows.map(toCharacter);
}

async function getCharacter(username, id) {
  const row = await prisma.noteQuestCharacter.findFirst({ where: { id, owner: { username } } });
  return row ? toCharacter(row) : null;
}

async function createCharacter(username, payload, slot) {
  const heroText = sanitizeHero(payload?.hero);
  const hero = parseJson(heroText, {});
  const created = await prisma.noteQuestCharacter.create({
    data: { owner: { connect: { username } }, slot: normalizeSlot(slot), heroJson: heroText, ...characterColumns(hero) },
  });
  await pruneCharacters(created.ownerId, created.slot);
  return toCharacter(created);
}

/** 人物池回写：状态、最近结局、战绩（runs / deaths 计数）。 */
async function updateCharacter(username, id, payload) {
  const existing = await prisma.noteQuestCharacter.findFirst({ where: { id, owner: { username } } });
  if (!existing) return null;
  const data = {};
  if (payload?.hero !== undefined) {
    const heroText = sanitizeHero(payload.hero);
    data.heroJson = heroText;
    Object.assign(data, characterColumns(parseJson(heroText, {})));
  }
  if (typeof payload?.status === 'string' && ['active', 'dead', 'retired'].includes(payload.status)) data.status = payload.status;
  if (typeof payload?.lastOutcome === 'string') data.lastOutcome = asString(payload.lastOutcome, MAX_TEXT_LENGTH, '');
  if (payload?.incrementRuns) data.runs = { increment: 1 };
  if (payload?.incrementDeaths) data.deaths = { increment: 1 };
  const updated = await prisma.noteQuestCharacter.update({ where: { id }, data });
  return toCharacter(updated);
}

async function deleteCharacter(username, id) {
  const result = await prisma.noteQuestCharacter.deleteMany({ where: { id, owner: { username } } });
  return result.count > 0;
}

/* ── 永久地牢：一个账号 × 一种地牢类型 = 一张永久地图 ── */

function sanitizeNodes(raw) {
  if (!Array.isArray(raw)) throw new NoteQuestError(400, '地牢地图结构不正确。');
  const text = JSON.stringify(raw);
  if (text.length > MAX_DUNGEON_BYTES) throw new NoteQuestError(413, '地牢地图过大，无法保存。');
  return text;
}

function dungeonColumns(payload) {
  return {
    typeId: asString(payload?.typeId, 40, ''),
    name: asString(payload?.name, MAX_TEXT_LENGTH, '无名地牢'),
    depth: clampInt(payload?.depth, 1, 99, 1),
    rooms: clampInt(payload?.rooms, 0, 9999, 0),
    corpses: clampInt(payload?.corpses, 0, 9999, 0),
  };
}

function toDungeonSummary(row) {
  return {
    id: row.id,
    slot: row.slot ?? 0,
    typeId: row.typeId,
    name: row.name,
    depth: row.depth,
    rooms: row.rooms,
    corpses: row.corpses,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDungeonDetail(row) {
  return { ...toDungeonSummary(row), nodes: parseJson(row.nodesJson, []) };
}

/** 一个栏位最多留 MAX_DUNGEONS_PER_USER 张地图：超了删最旧的（有进行中存档的跳过）。 */
async function pruneDungeons(ownerId, slot) {
  const rows = await prisma.noteQuestDungeon.findMany({ where: { ownerId, slot }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  if (rows.length <= MAX_DUNGEONS_PER_USER) return;
  const removable = rows.slice(MAX_DUNGEONS_PER_USER);
  const busy = await prisma.noteQuestRun.findMany({
    where: { ownerId, slot, status: 'active', dungeonId: { in: removable.map((row) => row.id) } },
    select: { dungeonId: true },
  });
  const busyIds = new Set(busy.map((row) => row.dungeonId));
  const ids = removable.filter((row) => !busyIds.has(row.id)).map((row) => row.id);
  if (ids.length) await prisma.noteQuestDungeon.deleteMany({ where: { id: { in: ids } } });
}

async function listDungeons(username, slot) {
  const rows = await prisma.noteQuestDungeon.findMany({
    where: { owner: { username }, slot },
    orderBy: { updatedAt: 'desc' },
    take: MAX_DUNGEONS_PER_USER,
  });
  return rows.map(toDungeonSummary);
}

async function getDungeon(username, id) {
  const row = await prisma.noteQuestDungeon.findFirst({ where: { id, owner: { username } } });
  return row ? toDungeonDetail(row) : null;
}

/** 按地牢类型取这个栏位里的永久地牢：新开一局时复用同一张图（含遗体与掉落）。 */
async function getDungeonByType(username, typeId, slot) {
  const row = await prisma.noteQuestDungeon.findFirst({ where: { typeId, slot, owner: { username } } });
  return row ? toDungeonDetail(row) : null;
}

/** 保存地图：给了 id 就按 id 更新，否则按 (账号, 栏位, 类型) 新建或更新。 */
async function saveDungeon(username, payload, slot) {
  const columns = dungeonColumns(payload);
  if (!columns.typeId) throw new NoteQuestError(400, '缺少地牢类型。');
  const slotValue = normalizeSlot(slot);
  const nodesJson = sanitizeNodes(payload?.nodes ?? []);
  const existing = payload?.id
    ? await prisma.noteQuestDungeon.findFirst({ where: { id: asString(payload.id, 40, ''), owner: { username } } })
    : await prisma.noteQuestDungeon.findFirst({ where: { typeId: columns.typeId, slot: slotValue, owner: { username } } });
  const row = existing
    ? await prisma.noteQuestDungeon.update({ where: { id: existing.id }, data: { ...columns, nodesJson } })
    : await prisma.noteQuestDungeon.create({ data: { owner: { connect: { username } }, slot: slotValue, ...columns, nodesJson } });
  if (!existing) await pruneDungeons(row.ownerId, row.slot);
  return toDungeonDetail(row);
}

async function deleteDungeon(username, id) {
  const result = await prisma.noteQuestDungeon.deleteMany({ where: { id, owner: { username } } });
  return result.count > 0;
}

/** 关联校验：只有属于这个账号的角色/地牢 id 才会写进存档，避免外键报错。 */
async function ownCharacterId(username, id) {
  const value = asString(id, 40, '');
  if (!value) return null;
  const row = await prisma.noteQuestCharacter.findFirst({ where: { id: value, owner: { username } }, select: { id: true } });
  return row ? row.id : null;
}

async function ownDungeonId(username, id) {
  const value = asString(id, 40, '');
  if (!value) return null;
  const row = await prisma.noteQuestDungeon.findFirst({ where: { id: value, owner: { username } }, select: { id: true } });
  return row ? row.id : null;
}

module.exports = {
  NoteQuestError,
  MAX_RUNS_PER_USER,
  MAX_STATE_BYTES,
  MAX_BODY_BYTES,
  MAX_CHARACTERS_PER_USER,
  MAX_DUNGEONS_PER_USER,
  MAX_DUNGEON_BYTES,
  SLOT_COUNT,
  normalizeSlot,
  listRuns,
  listSlots,
  clearSlot,
  getRun,
  createRun,
  updateRun,
  deleteRun,
  listGraves,
  listCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  listDungeons,
  getDungeon,
  getDungeonByType,
  saveDungeon,
  deleteDungeon,
};