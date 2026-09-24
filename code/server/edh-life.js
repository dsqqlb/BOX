'use strict';

/**
 * EDH 指挥官记血器的 SQLite 读写。
 *
 * 一个账户 = 一条 EdhLifeGame 记录，内容就是「当前这张桌子」的完整快照 stateJson：
 *   - 没有存档、没有读档：状态随时被客户端防抖 PATCH 回来，刷新/换设备后原样恢复；
 *   - 座位（EdhLifePlayer）另外成行，便于按颜色/血量做统计；
 *   - EdhLifeRoll 是历史遗留表，新版本不再写入（掷骰历史改为存在快照里）。
 *
 * 所有查询都以 owner.username 为边界，账户之间互相看不见。
 */

const { prisma } = require('./db');

const MAX_PLAYERS = 4;
const MAX_TITLE_LENGTH = 60;
const MAX_NAME_LENGTH = 24;
const COUNTER_KEYS = ['poison', 'energy', 'treasure', 'clue', 'food', 'experience'];

class EdhLifeError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function asString(value, maxLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

/** 颜色只接受 #rrggbb，避免把任意字符串写进库里再回显到样式上。 */
function asColor(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '#888888';
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch { return fallback; }
}

function toPlayer(row) {
  return {
    seat: row.seat,
    name: row.name,
    color: row.color,
    life: row.life,
    poison: row.poison,
    energy: row.energy,
    treasure: row.treasure,
    clue: row.clue,
    food: row.food,
    experience: row.experience,
    eliminated: row.eliminated,
    eliminatedReason: row.eliminatedReason,
  };
}

/** 历史列表用的精简摘要：不返回整包 stateJson，避免列表接口过重。 */
function toSummary(game) {
  return {
    id: game.id,
    title: game.title,
    playerCount: game.playerCount,
    startingLife: game.startingLife,
    round: game.round,
    status: game.status,
    winnerSeat: game.winnerSeat,
    startedAt: game.startedAt.toISOString(),
    endedAt: game.endedAt ? game.endedAt.toISOString() : null,
    durationSeconds: game.durationSeconds,
    updatedAt: game.updatedAt.toISOString(),
    players: game.players.map(toPlayer),
  };
}

function toDetail(game) {
  return { ...toSummary(game), state: parseJson(game.stateJson, null) };
}

/** 客户端可能提交任意结构，这里收敛成可安全落库的形状。 */
function sanitizePlayers(raw) {
  if (!Array.isArray(raw)) return [];
  const seats = new Set();
  const players = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const seat = clampInt(item.seat, 0, MAX_PLAYERS - 1, -1);
    if (seat < 0 || seats.has(seat)) continue;
    seats.add(seat);
    const player = {
      seat,
      name: asString(item.name, MAX_NAME_LENGTH, ''),
      color: asColor(item.color),
      // 生命可以是负数（中毒/指挥官伤害之外的溢出伤害在实体牌里不会真的扣到负，
      // 但记血器允许负值，方便玩家自己保留真实差额），下限仍做保护。
      life: clampInt(item.life, -99999, 99999, 0),
      eliminated: Boolean(item.eliminated),
      eliminatedReason: item.eliminatedReason ? asString(item.eliminatedReason, 40, '') : null,
    };
    for (const key of COUNTER_KEYS) player[key] = clampInt(item[key], -99999, 99999, 0);
    players.push(player);
  }
  return players.sort((a, b) => a.seat - b.seat);
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '{}';
  try {
    const text = JSON.stringify(raw);
    // 快照是整局状态，正常几十 KB；超过 1MB 说明客户端出了问题，直接拒绝而不是写库。
    if (text.length > 1024 * 1024) throw new EdhLifeError(413, '对局状态过大，无法保存。');
    return text;
  } catch (error) {
    if (error instanceof EdhLifeError) throw error;
    throw new EdhLifeError(400, '对局状态无法序列化。');
  }
}


/** 当前状态：页面加载时恢复这张桌子（一个账户只有这一条记录）。 */
async function getCurrentGame(username) {
  const game = await prisma.edhLifeGame.findFirst({
    where: { owner: { username }, status: 'running' },
    include: { players: { orderBy: { seat: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  return game ? toDetail(game) : null;
}


async function createGame(username, payload) {
  // 一个账户只允许一条「当前状态」记录：已经有记录时直接改那条。
  // 客户端第一次同步时本机 id 与数据库 id 不同，容易出现"PATCH 404 → 再 POST"，
  // 这里兜住它，避免一个账户堆出多条记录（也就等于没有存档系统了）。
  const existing = await prisma.edhLifeGame.findFirst({
    where: { owner: { username } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (existing) return updateGame(username, existing.id, payload);

  const players = sanitizePlayers(payload?.players);
  if (!players.length) throw new EdhLifeError(400, '至少需要一个座位。');
  if (players.length > MAX_PLAYERS) throw new EdhLifeError(400, `最多 ${MAX_PLAYERS} 个座位。`);

  const startedAt = payload?.startedAt ? new Date(payload.startedAt) : new Date();
  const created = await prisma.edhLifeGame.create({
    data: {
      owner: { connect: { username } },
      title: asString(payload?.title, MAX_TITLE_LENGTH, '') || defaultTitle(startedAt),
      playerCount: players.length,
      startingLife: clampInt(payload?.startingLife, 1, 999, 40),
      round: clampInt(payload?.round, 1, 9999, 1),
      status: payload?.status === 'finished' ? 'finished' : 'running',
      winnerSeat: payload?.winnerSeat === null || payload?.winnerSeat === undefined ? null : clampInt(payload.winnerSeat, 0, MAX_PLAYERS - 1, null),
      startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
      durationSeconds: clampInt(payload?.durationSeconds, 0, 60 * 60 * 24 * 30, 0),
      stateJson: sanitizeState(payload?.state),
      players: { create: players },
    },
    include: { players: { orderBy: { seat: 'asc' } } },
  });
  return toDetail(created);
}

function defaultTitle(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} 的对局`;
}

/**
 * 保存一局的状态。座位按 seat 做 upsert（避免整表删除重建导致 id 变化），
 * 已经不存在的座位会被清掉（例如中途从 4 人改成 2 人）。
 */
async function updateGame(username, id, payload) {
  const existing = await prisma.edhLifeGame.findFirst({ where: { id, owner: { username } }, select: { id: true } });
  if (!existing) return null;

  const players = sanitizePlayers(payload?.players);
  const data = {};
  if (payload?.title !== undefined) data.title = asString(payload.title, MAX_TITLE_LENGTH, '') || defaultTitle(new Date());
  if (payload?.startingLife !== undefined) data.startingLife = clampInt(payload.startingLife, 1, 999, 40);
  if (payload?.round !== undefined) data.round = clampInt(payload.round, 1, 9999, 1);
  if (payload?.durationSeconds !== undefined) data.durationSeconds = clampInt(payload.durationSeconds, 0, 60 * 60 * 24 * 30, 0);
  if (payload?.status !== undefined) data.status = payload.status === 'finished' ? 'finished' : 'running';
  if (payload?.winnerSeat !== undefined) {
    data.winnerSeat = payload.winnerSeat === null ? null : clampInt(payload.winnerSeat, 0, MAX_PLAYERS - 1, null);
  }
  if (payload?.status === 'finished') data.endedAt = payload?.endedAt ? new Date(payload.endedAt) : new Date();
  if (payload?.state !== undefined) data.stateJson = sanitizeState(payload.state);
  if (players.length) {
    data.playerCount = players.length;
    data.players = {
      upsert: players.map((player) => ({
        where: { gameId_seat: { gameId: id, seat: player.seat } },
        create: player,
        update: player,
      })),
      deleteMany: { seat: { notIn: players.map((player) => player.seat) } },
    };
  }

  const updated = await prisma.edhLifeGame.update({
    where: { id },
    data,
    include: { players: { orderBy: { seat: 'asc' } } },
  });
  return toDetail(updated);
}




module.exports = {
  EdhLifeError,
  MAX_PLAYERS,
  getCurrentGame,
  createGame,
  updateGame,
};
