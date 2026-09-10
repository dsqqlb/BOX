'use strict';

/**
 * 德州扑克筹码账户：余额存 HoldemBalance（可变），每次变动写 HoldemLedger（追加式流水）。
 *
 * 筹码是纯娱乐虚拟币，与真实货币无关。设计要点：
 *   1. 余额只在「买入上桌」和「离桌/每手结束结算」两个时刻落库，牌局进行中的下注只在内存；
 *   2. 所有变动在 prisma.$transaction 里完成，并强制余额不为负；
 *   3. 余额低于最小买入时，账户可自助重置补充，重置同样留下流水。
 */

const { prisma } = require('./db');
const { HOLDEM_STARTING_CHIPS, HOLDEM_MIN_BUY_IN } = require('./config');

const LEDGER_KINDS = new Set(['grant', 'reset', 'buy-in', 'cash-out', 'settle']);
const LEDGER_PAGE_LIMIT = 50;

class HoldemStoreError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = 'HoldemStoreError'; this.statusCode = statusCode; }
}

async function resolveOwnerId(username) {
  if (typeof username !== 'string' || !username) throw new HoldemStoreError('当前登录账户无效。', 401);
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new HoldemStoreError('当前账户不存在。', 401);
  return user.id;
}

function accountDto(balance) {
  return {
    chips: balance.chips,
    handsPlayed: balance.handsPlayed,
    handsWon: balance.handsWon,
    startingChips: HOLDEM_STARTING_CHIPS,
    minBuyIn: HOLDEM_MIN_BUY_IN,
    canReset: balance.chips < HOLDEM_MIN_BUY_IN,
    updatedAt: balance.updatedAt.toISOString(),
  };
}

/** 首次进入工具时开户并赠送初始筹码；已有账户直接返回。 */
async function getAccount(username) {
  const ownerId = await resolveOwnerId(username);
  const existing = await prisma.holdemBalance.findUnique({ where: { ownerId } });
  if (existing) return accountDto(existing);
  const created = await prisma.$transaction(async (tx) => {
    const balance = await tx.holdemBalance.create({ data: { ownerId, chips: HOLDEM_STARTING_CHIPS } });
    await tx.holdemLedger.create({ data: { ownerId, delta: HOLDEM_STARTING_CHIPS, balance: balance.chips, kind: 'grant', note: '新账户初始筹码' } });
    return balance;
  });
  return accountDto(created);
}

/** 统一的余额变动入口：负数扣减时校验余额充足，成功后返回最新账户视图。 */
async function adjustChips(username, { delta, kind, roomId = null, note = null, handPlayed = false, handWon = false }) {
  const amount = Math.trunc(Number(delta));
  if (!Number.isFinite(amount)) throw new HoldemStoreError('筹码变动数额无效。');
  if (!LEDGER_KINDS.has(kind)) throw new HoldemStoreError('筹码变动类型无效。');
  const ownerId = await resolveOwnerId(username);
  await getAccount(username);
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.holdemBalance.findUnique({ where: { ownerId } });
    if (!current) throw new HoldemStoreError('筹码账户不存在。', 404);
    const next = current.chips + amount;
    if (next < 0) throw new HoldemStoreError(`筹码不足：当前 ${current.chips}，需要 ${Math.abs(amount)}。`, 409);
    const balance = await tx.holdemBalance.update({
      where: { ownerId },
      data: {
        chips: next,
        handsPlayed: current.handsPlayed + (handPlayed ? 1 : 0),
        handsWon: current.handsWon + (handWon ? 1 : 0),
      },
    });
    if (amount !== 0) {
      await tx.holdemLedger.create({ data: { ownerId, delta: amount, balance: next, kind, roomId: roomId || null, note: note || null } });
    }
    return balance;
  });
  return accountDto(updated);
}

/** 上桌买入：从账户余额扣除，筹码转为桌上筹码（桌面状态在内存房间里）。 */
async function reserveBuyIn(username, amount, roomId) {
  const buyIn = Math.trunc(Number(amount));
  if (!Number.isFinite(buyIn) || buyIn < HOLDEM_MIN_BUY_IN) throw new HoldemStoreError(`买入至少需要 ${HOLDEM_MIN_BUY_IN} 筹码。`);
  return adjustChips(username, { delta: -buyIn, kind: 'buy-in', roomId, note: '上桌买入' });
}

/** 离桌结算：把桌上剩余筹码退回账户余额。 */
async function cashOut(username, amount, roomId) {
  const remaining = Math.max(0, Math.trunc(Number(amount) || 0));
  return adjustChips(username, { delta: remaining, kind: 'cash-out', roomId, note: '离桌结算' });
}

/** 每手结束记账：只累计统计，不改变余额（余额随离桌结算一次性回账）。 */
async function recordHandResult(username, won, roomId) {
  return adjustChips(username, { delta: 0, kind: 'settle', roomId, note: won ? '赢得一手' : '结束一手', handPlayed: true, handWon: Boolean(won) });
}

/** 余额低于最小买入时可自助补充到初始筹码，避免账户彻底卡死。 */
async function resetChips(username) {
  const account = await getAccount(username);
  if (account.chips >= HOLDEM_MIN_BUY_IN) throw new HoldemStoreError(`余额仍有 ${account.chips} 筹码，暂不需要补充。`, 409);
  return adjustChips(username, { delta: HOLDEM_STARTING_CHIPS - account.chips, kind: 'reset', note: '模拟支付：余额不足筹码补给' });
}

async function listLedger(username) {
  const ownerId = await resolveOwnerId(username);
  const records = await prisma.holdemLedger.findMany({
    where: { ownerId, delta: { not: 0 } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LEDGER_PAGE_LIMIT,
  });
  return records.map((record) => ({
    id: record.id,
    delta: record.delta,
    balance: record.balance,
    kind: record.kind,
    roomId: record.roomId,
    note: record.note,
    createdAt: record.createdAt.toISOString(),
  }));
}

module.exports = { HoldemStoreError, getAccount, adjustChips, reserveBuyIn, cashOut, recordHandResult, resetChips, listLedger };
