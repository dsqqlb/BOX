'use strict';

/**
 * 刮刮乐：单人玩法的服务端读写。
 *
 * 货币设计（与需求确认一致）：
 *   1. 「金钱」= 德州扑克那份娱乐筹码，同一份余额存 HoldemBalance，真正的互通，不新建钱包表；
 *   2. 「纸屑」是第二货币，存 ScratchProfile.scraps（碎纸机产出，升级系统消耗它）；
 *   3. 钱的变动一律通过 holdemStore.applyChipsWithinTx 在同一个事务里完成，所以
 *      「扣钱买票」「兑奖进账」「升级扣款」不可能出现钱与票状态脱节；
 *   4. ScratchLedger 额外记一份刮刮乐自己的流水（含钱的镜像），让本工具能看到自己的收支历史。
 *
 * 票面结果在买票时就由 scratch-rules 用种子定死存库；未刮开的票，DTO 里既没有 seed 也没有答案。
 */

const crypto = require('crypto');
const fs = require('fs');
const { prisma } = require('./db');
const holdemStore = require('./holdem-store');
const rules = require('./scratch-rules');
const { SCRATCH_TICKETS_FILE } = require('./config');

const OPEN_STATUSES = ['sealed', 'scratched'];
const TABLE_SLOTS = 12;                 // 桌面容量（升级系统上线后按等级提高）
const LEDGER_PAGE_LIMIT = 50;
const SLOT_COLS = 4;                    // 新票默认落位的列数
const SLOT_ORIGIN = { x: 10, y: 68 };   // 第一张票的默认坐标（桌面百分比）
const SLOT_STEP = { x: 12, y: -11 };

class ScratchStoreError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = 'ScratchStoreError'; this.statusCode = statusCode; }
}

/* ── 票种目录（读 resources/content/scratch/tickets.json，进程内缓存一次） ── */

let catalogCache = null;

function loadCatalog() {
  if (catalogCache) return catalogCache;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(SCRATCH_TICKETS_FILE, 'utf8'));
  } catch {
    parsed = null;
  }
  const tickets = Array.isArray(parsed?.tickets) ? parsed.tickets.filter((ticket) => ticket && typeof ticket.key === 'string') : [];
  catalogCache = {
    version: Number(parsed?.version) || 1,
    note: parsed?.note || '',
    moneyNote: parsed?.moneyNote || '',
    tickets,
    byKey: new Map(tickets.map((ticket) => [ticket.key, ticket])),
  };
  return catalogCache;
}

/* ── 通用小工具 ── */

function parseJsonObject(json, fallback) {
  if (!json) return { ...fallback };
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function parseJsonArray(json) {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function resolveOwnerId(username) {
  if (typeof username !== 'string' || !username) throw new ScratchStoreError('当前登录账户无效。', 401);
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new ScratchStoreError('当前账户不存在。', 401);
  return user.id;
}

async function ensureProfile(ownerId) {
  return prisma.scratchProfile.upsert({ where: { ownerId }, update: {}, create: { ownerId } });
}

function clampPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
}

/** 校验客户端传来的桌面坐标（百分比 0~100）。 */
function requirePercent(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new ScratchStoreError(`${field} 必须是 0~100 的数字。`);
  return number;
}

/** 新票的默认落点：从右下角往左上按格摆放，z 越大越靠前（阶段 2 的拖拽会覆盖它）。 */
function defaultPosition(openCount) {
  const index = Math.max(0, Math.trunc(openCount));
  const col = index % SLOT_COLS;
  const row = Math.floor(index / SLOT_COLS);
  return { x: clampPercent(SLOT_ORIGIN.x + col * SLOT_STEP.x, 10), y: clampPercent(SLOT_ORIGIN.y + row * SLOT_STEP.y, 68), z: index + 1 };
}

/* ── DTO ── */

function ticketDto(ticket) {
  const definition = loadCatalog().byKey.get(ticket.kind);
  let parsed = null;
  try { parsed = JSON.parse(ticket.resultJson); } catch { parsed = null; }

  // 印刷层（格子内容）**一直都在**：就像真票的印刷就压在涂层下面，刮开多少就露出多少，
  // 所以 print 从买票起就随票下发——这是「刮的爽感」的来源。
  // 结算（中没中、多少奖金）属于服务端确认，刮开达标（reveal）之后才下发 outcome；seed 永远不下发。
  const revealed = ticket.status !== 'sealed';
  const print = parsed
    ? { grid: parsed.grid, cells: parsed.cells, legend: parsed.legend ?? null, rules: parsed.rules }
    : null;
  const outcome = revealed && parsed
    ? {
      won: Boolean(parsed.won),
      prize: Math.trunc(Number(parsed.prize) || 0),
      headline: typeof parsed.headline === 'string' ? parsed.headline : '',
      detail: parsed.detail ?? null,
    }
    : null;

  return {
    id: ticket.id,
    kind: ticket.kind,
    name: definition?.name || ticket.kind,
    price: ticket.price,
    status: ticket.status,
    scratchRatio: ticket.scratchRatio,
    posX: ticket.posX,
    posY: ticket.posY,
    z: ticket.z,
    purchasedAt: ticket.purchasedAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    revealed,
    print,
    outcome,
  };
}

/* ── 读 ── */

/** 账户总览：金钱直接取筹码余额（与德州共用），纸屑取刮刮乐自己的档案。 */
async function getProfile(username) {
  const ownerId = await resolveOwnerId(username);
  const account = await holdemStore.getAccount(username);
  const profile = await ensureProfile(ownerId);
  const usedSlots = await prisma.scratchTicket.count({ where: { ownerId, status: { in: OPEN_STATUSES } } });
  return {
    money: account.chips,
    scraps: profile.scraps,
    levels: parseJsonObject(profile.levelsJson, {}),
    unlocked: parseJsonArray(profile.unlockedJson),
    stats: parseJsonObject(profile.statsJson, {}),
    tableSlots: TABLE_SLOTS,
    usedSlots,
    catalogVersion: loadCatalog().version,
  };
}

/** 商店目录：票种配置 + 期望回收率 + 是否已解锁（由服务端算，避免两端规则不一致）。 */
async function getCatalog(username) {
  const ownerId = await resolveOwnerId(username);
  const profile = await ensureProfile(ownerId);
  const levels = parseJsonObject(profile.levelsJson, {});
  const explicitUnlocks = parseJsonArray(profile.unlockedJson);
  const shopLevel = Math.trunc(Number(levels.shop) || 0);
  const catalog = loadCatalog();
  return {
    version: catalog.version,
    note: catalog.note,
    moneyNote: catalog.moneyNote,
    tickets: catalog.tickets.map((ticket) => ({
      ...ticket,
      problems: rules.validateTicket(ticket),
      expectedReturn: rules.expectedReturn(ticket),
      shredScraps: rules.shredScraps(ticket),
      unlocked: explicitUnlocks.includes(ticket.key) || shopLevel >= Math.trunc(Number(ticket.unlock?.level) || 0),
    })),
  };
}

async function listTickets(username) {
  const ownerId = await resolveOwnerId(username);
  const tickets = await prisma.scratchTicket.findMany({
    where: { ownerId, status: { in: OPEN_STATUSES } },
    orderBy: [{ z: 'asc' }, { purchasedAt: 'asc' }],
  });
  return { tickets: tickets.map(ticketDto) };
}

async function listLedger(username) {
  const ownerId = await resolveOwnerId(username);
  const records = await prisma.scratchLedger.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LEDGER_PAGE_LIMIT,
  });
  return {
    entries: records.map((record) => ({
      id: record.id,
      currency: record.currency,
      delta: record.delta,
      balance: record.balance,
      kind: record.kind,
      ticketId: record.ticketId,
      note: record.note,
      createdAt: record.createdAt.toISOString(),
    })),
  };
}

/* ── 写 ── */

/** 买票：扣钱（筹码）、生成票面、落库、写流水，全部在一个事务里。 */
async function buyTicket(username, kind, placement = {}) {
  if (typeof kind !== 'string' || !kind) throw new ScratchStoreError('没有指定要买哪种刮刮乐。');
  const catalog = loadCatalog();
  const ticketConfig = catalog.byKey.get(kind);
  if (!ticketConfig) throw new ScratchStoreError('商店里没有这种刮刮乐。', 404);
  const problems = rules.validateTicket(ticketConfig);
  if (problems.length) throw new ScratchStoreError(`票种配置有问题：${problems.join('；')}`, 500);
  const price = Math.trunc(Number(ticketConfig.price));

  const ownerId = await resolveOwnerId(username);
  await holdemStore.getAccount(username);   // 首次进入补齐筹码账户（含开户赠送流水）
  await ensureProfile(ownerId);

  const openCount = await prisma.scratchTicket.count({ where: { ownerId, status: { in: OPEN_STATUSES } } });
  if (openCount >= TABLE_SLOTS) {
    throw new ScratchStoreError(`桌面上最多同时放 ${TABLE_SLOTS} 张票，先把刮完的票处理掉再买。`, 409);
  }

  const seed = crypto.randomBytes(18).toString('base64url');
  const result = rules.generateResult(ticketConfig, seed);
  const position = defaultPosition(openCount);
  const note = `购买刮刮乐：${ticketConfig.name}`;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const balance = await holdemStore.applyChipsWithinTx(tx, ownerId, { delta: -price, kind: 'scratch-buy', note });
      const ticket = await tx.scratchTicket.create({
        data: {
          ownerId,
          kind,
          price,
          seed,
          resultJson: JSON.stringify(result),
          posX: clampPercent(placement.posX, position.x),
          posY: clampPercent(placement.posY, position.y),
          z: position.z,
        },
      });
      await tx.scratchLedger.create({
        data: { ownerId, currency: 'money', delta: -price, balance: balance.chips, kind: 'scratch-buy', ticketId: ticket.id, note },
      });
      const profile = await tx.scratchProfile.findUnique({ where: { ownerId } });
      const stats = parseJsonObject(profile?.statsJson, {});
      await tx.scratchProfile.update({
        where: { ownerId },
        data: {
          statsJson: JSON.stringify({
            ...stats,
            purchased: Math.trunc(Number(stats.purchased) || 0) + 1,
            spent: Math.trunc(Number(stats.spent) || 0) + price,
          }),
        },
      });
      return { ticket, chips: balance.chips };
    });
    return { ticket: ticketDto(created.ticket), money: created.chips };
  } catch (error) {
    // 筹码不足等由 holdem-store 抛出的错误，统一转成本模块的错误类型给路由层。
    if (error instanceof holdemStore.HoldemStoreError) throw new ScratchStoreError(error.message, error.statusCode);
    throw error;
  }
}

/** 保存拖动后的桌面坐标（阶段 2 的拖拽调用；单人玩法，只能改自己桌上的票）。 */
async function updateTicketPosition(username, ticketId, patch = {}) {
  if (typeof ticketId !== 'string' || !ticketId) throw new ScratchStoreError('票不存在。', 404);
  const ownerId = await resolveOwnerId(username);
  const data = {};
  if (patch.posX !== undefined) data.posX = requirePercent(patch.posX, 'posX');
  if (patch.posY !== undefined) data.posY = requirePercent(patch.posY, 'posY');
  if (patch.z !== undefined) {
    const z = Math.trunc(Number(patch.z));
    if (!Number.isFinite(z) || z < 0 || z > 9999) throw new ScratchStoreError('z 必须是 0~9999 的整数。');
    data.z = z;
  }
  if (!Object.keys(data).length) throw new ScratchStoreError('没有要更新的字段。');

  const updated = await prisma.scratchTicket.updateMany({
    where: { id: ticketId, ownerId, status: { in: OPEN_STATUSES } },
    data,
  });
  if (!updated.count) throw new ScratchStoreError('这张票不在桌面上。', 404);
  const ticket = await prisma.scratchTicket.findUnique({ where: { id: ticketId } });
  return { ticket: ticketDto(ticket) };
}

/**
 * 刮开揭晓：客户端把刮开进度报上来，达到票种阈值后把状态改为 scratched 并返回答案。
 *
 * 防篡改的边界（写清楚，免得以后误以为这是防作弊）：
 *   · 答案在买票时就由服务端按种子定死，客户端拿到它也改不了输赢——这是硬保证；
 *   · 阈值只是「手感门槛」，服务端不校验手指真的划过（单人娱乐，跳过刮的动作没有收益）；
 *   · 幂等：已经刮开的票再调一次只会把答案原样返回，不会重复计数。
 */
async function revealTicket(username, ticketId, scratchRatio) {
  if (typeof ticketId !== 'string' || !ticketId) throw new ScratchStoreError('票不存在。', 404);
  const ratio = Number(scratchRatio);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new ScratchStoreError('刮开进度必须是 0~1 的数字。');

  const ownerId = await resolveOwnerId(username);
  const ticket = await prisma.scratchTicket.findFirst({ where: { id: ticketId, ownerId } });
  if (!ticket) throw new ScratchStoreError('找不到这张票。', 404);
  if (ticket.status !== 'sealed') return { ticket: ticketDto(ticket), alreadyRevealed: true };

  const definition = loadCatalog().byKey.get(ticket.kind);
  if (!definition) throw new ScratchStoreError('这张票的票种已经不在配置里了。', 500);
  const threshold = Math.min(1, Math.max(0.05, Number(definition.scratch?.threshold) || 0.6));
  if (ratio < threshold) {
    throw new ScratchStoreError(`还差一点：刮开进度需要到 ${Math.round(threshold * 100)}%。`, 409);
  }

  let result = null;
  try { result = JSON.parse(ticket.resultJson); } catch { result = null; }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.scratchTicket.update({
      where: { id: ticket.id },
      data: { status: 'scratched', scratchRatio: ratio },
    });
    const profile = await tx.scratchProfile.findUnique({ where: { ownerId } });
    const stats = parseJsonObject(profile?.statsJson, {});
    await tx.scratchProfile.update({
      where: { ownerId },
      data: {
        statsJson: JSON.stringify({
          ...stats,
          revealed: Math.trunc(Number(stats.revealed) || 0) + 1,
          // 中奖统计记在「刮开」这一刻；钱要到兑奖机才真的进账户（阶段 4）。
          wins: Math.trunc(Number(stats.wins) || 0) + (result?.won ? 1 : 0),
          bestPrize: Math.max(Math.trunc(Number(stats.bestPrize) || 0), result?.won ? Math.trunc(Number(result.prize) || 0) : 0),
        }),
      },
    });
    return next;
  });

  return { ticket: ticketDto(updated), alreadyRevealed: false };
}

/**
 * 兑奖：只接受「已刮开且中奖」的票。
 * 奖金走同一份筹码余额（applyChipsWithinTx），与买票共用一条写入路径，所以钱和票状态不会脱节。
 */
async function redeemTicket(username, ticketId) {
  if (typeof ticketId !== 'string' || !ticketId) throw new ScratchStoreError('票不存在。', 404);
  const ownerId = await resolveOwnerId(username);
  const ticket = await prisma.scratchTicket.findFirst({ where: { id: ticketId, ownerId } });
  if (!ticket) throw new ScratchStoreError('找不到这张票。', 404);
  if (ticket.status === 'redeemed') return { ticket: ticketDto(ticket), alreadySettled: true, prize: 0, money: null };
  if (ticket.status === 'shredded') throw new ScratchStoreError('这张票已经碎掉了。', 409);
  if (ticket.status !== 'scratched') throw new ScratchStoreError('先把票刮开，再来兑奖机。', 409);

  let parsed = null;
  try { parsed = JSON.parse(ticket.resultJson); } catch { parsed = null; }
  const prize = Math.trunc(Number(parsed?.prize) || 0);
  if (!parsed?.won || prize <= 0) throw new ScratchStoreError('这张票没中奖，拖进碎纸机还能换纸屑。', 409);

  await holdemStore.getAccount(username);   // 确保筹码账户存在（首次开户也在这里补齐）
  const definition = loadCatalog().byKey.get(ticket.kind);
  const note = `兑奖：${definition?.name || ticket.kind} 中 ${prize} 币`;

  try {
    const settled = await prisma.$transaction(async (tx) => {
      const balance = await holdemStore.applyChipsWithinTx(tx, ownerId, { delta: prize, kind: 'scratch-prize', note });
      await tx.scratchLedger.create({
        data: { ownerId, currency: 'money', delta: prize, balance: balance.chips, kind: 'scratch-prize', ticketId: ticket.id, note },
      });
      const updated = await tx.scratchTicket.update({ where: { id: ticket.id }, data: { status: 'redeemed' } });
      const profile = await tx.scratchProfile.findUnique({ where: { ownerId } });
      const stats = parseJsonObject(profile?.statsJson, {});
      await tx.scratchProfile.update({
        where: { ownerId },
        data: {
          statsJson: JSON.stringify({
            ...stats,
            redeemed: Math.trunc(Number(stats.redeemed) || 0) + 1,
            prizeTotal: Math.trunc(Number(stats.prizeTotal) || 0) + prize,
          }),
        },
      });
      return { updated, chips: balance.chips };
    });
    return { ticket: ticketDto(settled.updated), money: settled.chips, prize, alreadySettled: false };
  } catch (error) {
    if (error instanceof holdemStore.HoldemStoreError) throw new ScratchStoreError(error.message, error.statusCode);
    throw error;
  }
}

/**
 * 碎纸：未结算的票都能碎（未刮开的也允许，客户端会先让玩家确认）。
 * 产出 = 票种 shredScraps（基础 1，与票价无关）+ 「碎纸机」升级加成。
 */
async function shredTicket(username, ticketId) {
  if (typeof ticketId !== 'string' || !ticketId) throw new ScratchStoreError('票不存在。', 404);
  const ownerId = await resolveOwnerId(username);
  const ticket = await prisma.scratchTicket.findFirst({ where: { id: ticketId, ownerId } });
  if (!ticket) throw new ScratchStoreError('找不到这张票。', 404);
  if (ticket.status === 'shredded') return { ticket: ticketDto(ticket), gained: 0, scraps: null, alreadySettled: true };
  if (ticket.status === 'redeemed') throw new ScratchStoreError('这张票已经兑过奖了，不能再碎。', 409);

  const definition = loadCatalog().byKey.get(ticket.kind);
  const profile = await ensureProfile(ownerId);
  const levels = parseJsonObject(profile.levelsJson, {});
  const bonus = Math.max(0, Math.trunc(Number(levels.shredder) || 0));
  const gained = rules.shredScraps(definition) + bonus;
  const note = `碎纸：${definition?.name || ticket.kind}${bonus > 0 ? `（碎纸机 +${bonus}）` : ''}`;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.scratchTicket.update({ where: { id: ticket.id }, data: { status: 'shredded' } });
    const current = await tx.scratchProfile.findUnique({ where: { ownerId } });
    const nextScraps = (current?.scraps || 0) + gained;
    const stats = parseJsonObject(current?.statsJson, {});
    await tx.scratchProfile.update({
      where: { ownerId },
      data: {
        scraps: nextScraps,
        statsJson: JSON.stringify({
          ...stats,
          shredded: Math.trunc(Number(stats.shredded) || 0) + 1,
          scrapsTotal: Math.trunc(Number(stats.scrapsTotal) || 0) + gained,
        }),
      },
    });
    await tx.scratchLedger.create({
      data: { ownerId, currency: 'scraps', delta: gained, balance: nextScraps, kind: 'scratch-shred', ticketId: ticket.id, note },
    });
    return next;
  });

  const refreshed = await prisma.scratchProfile.findUnique({ where: { ownerId } });
  return { ticket: ticketDto(updated), gained, scraps: refreshed?.scraps ?? 0, alreadySettled: false };
}

module.exports = {
  ScratchStoreError,
  TABLE_SLOTS,
  OPEN_STATUSES,
  loadCatalog,
  getProfile,
  getCatalog,
  listTickets,
  listLedger,
  buyTicket,
  updateTicketPosition,
  revealTicket,
  redeemTicket,
  shredTicket,
};