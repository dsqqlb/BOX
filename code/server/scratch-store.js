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
const { SCRATCH_TICKETS_FILE, SCRATCH_UPGRADES_FILE } = require('./config');

const OPEN_STATUSES = ['sealed', 'scratched'];
const TABLE_SLOTS = 12;                 // 桌面容量基数（「商店会员」升级会往上加）
/**
 * 桌面上每张票的 z 上限。客户端拖动时按「抬一层」上报，到顶就由服务端按叠放顺序把整桌重新编号到 1..N，
 * 这样 z 不会无限增长（否则迟早会盖住提示条、聚焦大票这些上层界面）。
 */
const Z_LIMIT = 20;

/**
 * 桌面上的机器：位置（桌面百分比）+ 是否收进「能力」栏。
 * 位置与收起状态存在 ScratchProfile.machinesJson 里，跨设备一致；前端可以拖动或收起它们。
 */
const MACHINE_IDS = ['redeem', 'shred', 'auto'];
const DEFAULT_MACHINES = {
  redeem: { x: 86, y: 20, folded: false },
  shred: { x: 86, y: 76, folded: false },
  auto: { x: 14, y: 62, folded: false },
};
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

/* ── 升级树（读 resources/content/scratch/upgrades.json） ── */

let upgradesCache = null;

function loadUpgrades() {
  if (upgradesCache) return upgradesCache;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(SCRATCH_UPGRADES_FILE, 'utf8'));
  } catch {
    parsed = null;
  }
  const upgrades = Array.isArray(parsed?.upgrades) ? parsed.upgrades.filter((item) => item && typeof item.id === 'string') : [];
  upgradesCache = {
    version: Number(parsed?.version) || 1,
    note: parsed?.note || '',
    categories: Array.isArray(parsed?.categories) ? parsed.categories.filter((item) => item && typeof item.id === 'string') : [],
    upgrades,
    byId: new Map(upgrades.map((item) => [item.id, item])),
  };
  return upgradesCache;
}

/**
 * 把各升级等级换算成一组实际生效的数值。
 *
 * 这是**唯一**的效果计算入口：买票、开奖、兑奖、碎纸、商店折扣、桌面容量、票种解锁全都读它，
 * 客户端只是把结果拿去显示与使用（笔刷宽度、结算门槛、自动刮速度），不在前端重复算一遍。
 *
 * 设计成「开放的」：
 *   · 未识别的 effect.kind 不会报错，会原样累加进 effects.custom，客户端想用可以直接读；
 *   · 同一个 kind 的多个节点会累加，所以同一个效果可以有好几条升级线；
 *   · flag 用来给客户端功能当开关（例如 autoScratchAll 打开「自动巡桌」按钮）。
 */
function computeEffects(levels) {
  const effects = {
    brushPercent: 0,
    thresholdBonus: 0,
    autoPointsPerSecond: 0,
    /** 自动刮奖机刮完一张要多少毫秒（0 = 立刻完成）。 */
    autoMachineMs: 0,
    prizeBonus: 0,
    critChance: 0,
    critMultiplier: 2,
    shredBonus: 0,
    exchange: 0,
    discount: 0,
    tableSlots: TABLE_SLOTS,
    luckBonus: 0,
    ticketLuck: {},
    unlockedTickets: [],
    flags: {},
    custom: {},
    levels: {},
    maxLevels: {},
  };
  const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  for (const upgrade of loadUpgrades().upgrades) {
    const maxLevel = Math.max(1, Math.trunc(Number(upgrade.maxLevel) || 1));
    // 树的起点（root）开局就算点亮，不参与购买。
    const level = upgrade.root
      ? maxLevel
      : Math.max(0, Math.min(maxLevel, Math.trunc(Number(levels?.[upgrade.id]) || 0)));
    effects.levels[upgrade.id] = level;
    effects.maxLevels[upgrade.id] = maxLevel;

    const effect = upgrade.effect || {};
    const kind = typeof effect.kind === 'string' ? effect.kind : '';
    if (!kind || kind === 'none') continue;
    const per = number(effect.perLevel);
    const gain = number(effect.base) + per * level;

    switch (kind) {
      case 'brush':
        effects.brushPercent += gain;
        break;
      case 'threshold':
        // perLevel 是负数：升一级门槛更低
        effects.thresholdBonus += per * level;
        break;
      case 'auto':
        effects.autoPointsPerSecond += gain;
        effects.autoMachineMs = Math.max(0, number(effect.machineBaseMs, 5200) - number(effect.machinePerLevelMs, 1100) * level);
        break;
      case 'prizeBonus':
        effects.prizeBonus += per * level;
        break;
      case 'crit':
        effects.critChance += per * level;
        effects.critMultiplier = Math.max(1, number(effect.multiplier, 2));
        break;
      case 'shredBonus':
        effects.shredBonus += per * level;
        break;
      case 'exchange':
        // 熔炼汇率：每 N 单位纸屑换 1 币（perLevel 是负数，等级越高越划算）；0 = 未解锁。
        effects.exchange = level > 0 ? Math.max(1, Math.round(number(effect.base) + per * level)) : 0;
        break;
      case 'ticketLuck': {
        const key = typeof effect.ticket === 'string' ? effect.ticket : '';
        if (key) effects.ticketLuck[key] = number(effects.ticketLuck[key]) + per * level;
        break;
      }
      case 'discount':
        effects.discount = Math.min(number(effect.maxDiscount, 0.5), effects.discount + per * level);
        effects.tableSlots += number(effect.tableSlotsPerLevel) * level;
        break;
      case 'luck':
        effects.luckBonus += per * level;
        break;
      case 'unlock':
        if (Array.isArray(effect.unlockByLevel)) {
          for (let index = 0; index < level; index += 1) {
            const list = effect.unlockByLevel[index];
            if (Array.isArray(list)) effects.unlockedTickets.push(...list.filter((key) => typeof key === 'string'));
          }
        }
        break;
      case 'flag':
        if (typeof effect.flag === 'string' && effect.flag) effects.flags[effect.flag] = level >= 1;
        break;
      default:
        // 未识别的种类照旧累加，方便以后加效果时不改服务端也不出错。
        effects.custom[kind] = number(effects.custom[kind]) + per * level;
        break;
    }
  }

  effects.brushPercent = Math.round(effects.brushPercent * 10) / 10;
  effects.thresholdBonus = Math.round(effects.thresholdBonus * 1000) / 1000;
  effects.discount = Math.round(effects.discount * 1000) / 1000;
  return effects;
}

/** 解析前置条件：'workshop' = 至少 1 级，'scraper@3' = 至少 3 级。 */
function parseRequirement(text) {
  const match = /^([A-Za-z0-9-]+)(?:@(\d+))?$/.exec(String(text || '').trim());
  if (!match) return null;
  return { id: match[1], level: Math.max(1, Math.trunc(Number(match[2]) || 1)) };
}

/** 前置是否点亮；没点亮的会返回一句人话，直接显示在技能树上。 */
function requirementStatus(upgrade, levels) {
  const list = Array.isArray(upgrade.requires) ? upgrade.requires : [];
  const unmet = [];
  for (const text of list) {
    const parsed = parseRequirement(text);
    if (!parsed) continue;
    const prerequisite = loadUpgrades().byId.get(parsed.id);
    // root 节点不落库，按「已点亮」算。
    const current = prerequisite?.root ? 1 : Math.trunc(Number(levels?.[parsed.id]) || 0);
    if (current < parsed.level) unmet.push(`${prerequisite?.name || parsed.id} ${parsed.level} 级`);
  }
  return { met: unmet.length === 0, unmet };
}

/** 升级面板里的一行说明：现在什么效果、升一级之后变成什么。 */
function describeEffect(upgrade, level, effects) {
  const effect = upgrade.effect || {};
  const pct = (value) => `${Math.round(Number(value) * 100)}%`;
  const per = Number(effect.perLevel) || 0;
  switch (effect.kind) {
    case 'brush': {
      const base = Number(effect.base) || 30;
      return { now: `笔刷 ${Math.round(base + per * level)}%`, next: `笔刷 ${Math.round(base + per * (level + 1))}%` };
    }
    case 'auto': {
      const baseMs = Number(effect.machineBaseMs ?? 5200);
      const perMs = Number(effect.machinePerLevelMs ?? 1100);
      const seconds = (value) => Math.max(0, baseMs - perMs * value) / 1000;
      const text = (value) => (seconds(value) <= 0 ? '桌面机器立刻刮完' : `桌面机器约 ${seconds(value).toFixed(1)} 秒刮完一张`);
      return {
        now: level === 0 ? '未启用' : `${text(level)}（手动约 ${per * level} 点/秒）`,
        next: `${text(level + 1)}（手动约 ${per * (level + 1)} 点/秒）`,
      };
    }
    case 'prizeBonus':
      return { now: `中奖加成 +${pct(per * level)}`, next: `中奖加成 +${pct(per * (level + 1))}` };
    case 'crit': {
      const multiplier = Math.max(1, Number(effect.multiplier) || 2);
      return {
        now: `暴击 ${pct(per * level)}（命中 ×${multiplier}）`,
        next: `暴击 ${pct(per * (level + 1))}（命中 ×${multiplier}）`,
      };
    }
    case 'exchange': {
      const rate = (value) => Math.max(1, Math.round(Number(effect.base) + per * value));
      return level === 0
        ? { now: '未解锁', next: `每 ${rate(1)} 纸屑换 1 币` }
        : { now: `每 ${rate(level)} 纸屑换 1 币`, next: `每 ${rate(level + 1)} 纸屑换 1 币` };
    }
    case 'ticketLuck': {
      const name = loadCatalog().byId?.get?.(effect.ticket)?.name || effect.ticket || '该票种';
      return {
        now: `${name} 中奖率 +${pct(per * level)}`,
        next: `${name} 中奖率 +${pct(per * (level + 1))}`,
      };
    }
    case 'shredBonus':
      return { now: `每张纸屑 ${1 + per * level}`, next: `每张纸屑 ${1 + per * (level + 1)}` };
    case 'discount': {
      const slots = Number(effect.tableSlotsPerLevel) || 0;
      return {
        now: `买票 -${pct(per * level)} · 桌面 ${TABLE_SLOTS + slots * level} 张`,
        next: `买票 -${pct(per * (level + 1))} · 桌面 ${TABLE_SLOTS + slots * (level + 1)} 张`,
      };
    }
    case 'luck':
      return { now: `中奖率 +${pct(per * level)}`, next: `中奖率 +${pct(per * (level + 1))}` };
    case 'threshold': {
      const drop = (value) => Math.round(Math.abs(per) * value * 100);
      return level === 0
        ? { now: '结算门槛不变', next: `结算门槛 -${drop(1)}%` }
        : { now: `结算门槛 -${drop(level)}%`, next: `结算门槛 -${drop(level + 1)}%` };
    }
    case 'flag':
      return level >= 1 ? { now: '已启用', next: '已启用' } : { now: '未启用', next: '启用（1 级即可）' };
    case 'none':
      return { now: upgrade.desc || '树的起点', next: '树的起点' };
    case 'unlock': {
      const unlocked = level > 0 ? (effects.unlockedTickets.join('、') || '暂无') : '未解锁';
      const nextList = Array.isArray(effect.unlockByLevel?.[level]) ? effect.unlockByLevel[level].join('、') : '—';
      return { now: `已解锁：${unlocked}`, next: `再解锁：${nextList}` };
    }
    default:
      // 未识别的效果也给出可读文案，方便先在 JSON 里试数值。
      return { now: `等级 ${level}`, next: `等级 ${level + 1}` };
  }
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

/** 读出机器布局（缺字段就用默认值补齐，所以加新机器不用改数据结构）。 */
function parseMachines(json) {
  const stored = parseJsonObject(json, {});
  const machines = {};
  for (const id of MACHINE_IDS) {
    const fallback = DEFAULT_MACHINES[id];
    const item = stored[id] && typeof stored[id] === 'object' ? stored[id] : {};
    machines[id] = {
      x: clampPercent(item.x, fallback.x),
      y: clampPercent(item.y, fallback.y),
      folded: item.folded === true,
    };
  }
  return machines;
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
    // null = 还没摆正（客户端按票 id 给一个「刚扔出来」的随机角）；0 = 已经摆正。
    rotation: Number.isFinite(ticket.rotation) ? ticket.rotation : null,
    purchasedAt: ticket.purchasedAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    revealed,
    print,
    outcome,
  };
}

/* ── 读 ── */

/** 账户总览：金钱直接取筹码余额（与德州共用），纸屑取刮刮乐自己的档案；effects 是升级后的实际数值。 */
async function getProfile(username) {
  const ownerId = await resolveOwnerId(username);
  const account = await holdemStore.getAccount(username);
  const profile = await ensureProfile(ownerId);
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  const usedSlots = await prisma.scratchTicket.count({ where: { ownerId, status: { in: OPEN_STATUSES } } });
  return {
    money: account.chips,
    scraps: profile.scraps,
    levels: effects.levels,
    unlocked: effects.unlockedTickets,
    unlockedExtra: parseJsonArray(profile.unlockedJson),
    stats: parseJsonObject(profile.statsJson, {}),
    tableSlots: effects.tableSlots,
    usedSlots,
    catalogVersion: loadCatalog().version,
    effects,
    machines: parseMachines(profile.machinesJson),
  };
}

/** 商店目录：票种配置 + 期望回收率 + 是否解锁 + 本账户的实际售价与中奖率（含商店折扣、幸运护符）。 */
async function getCatalog(username) {
  const ownerId = await resolveOwnerId(username);
  const profile = await ensureProfile(ownerId);
  const explicitUnlocks = parseJsonArray(profile.unlockedJson);
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  const vaultLevel = effects.levels.vault || 0;
  const catalog = loadCatalog();
  return {
    version: catalog.version,
    note: catalog.note,
    moneyNote: catalog.moneyNote,
    effects,
    tickets: catalog.tickets.map((ticket) => {
      const priceBase = Math.max(1, Math.trunc(Number(ticket.price) || 1));
      const unlockLevel = Math.trunc(Number(ticket.unlock?.level) || 0);
      return {
        ...ticket,
        problems: rules.validateTicket(ticket),
        expectedReturn: rules.expectedReturn(ticket),
        shredScraps: rules.shredScraps(ticket) + effects.shredBonus,
        unlocked: unlockLevel <= vaultLevel || explicitUnlocks.includes(ticket.key) || effects.unlockedTickets.includes(ticket.key),
        priceBase,
        // 实际售价（含商店会员折扣）与实际中奖率（含幸运护符）、实际结算门槛（含精准刮刀），
        // 买票与结算时服务端按同一套规则执行。
        price: Math.max(1, Math.round(priceBase * (1 - effects.discount))),
        winChance: Math.min(1, (Number(ticket.winChance) || 0) + effects.luckBonus + (Number((effects.ticketLuck || {})[ticket.key]) || 0)),
        threshold: Math.min(1, Math.max(0.15, (Number(ticket.scratch?.threshold) || 0.6) + effects.thresholdBonus)),
      };
    }),
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

  const ownerId = await resolveOwnerId(username);
  await holdemStore.getAccount(username);   // 首次进入补齐筹码账户（含开户赠送流水）
  const profile = await ensureProfile(ownerId);
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  // 解锁限制必须在服务端把关：不能让客户端直接指定 kind 买走还没解锁的票种。
  const explicitUnlocks = parseJsonArray(profile.unlockedJson);
  const unlockLevel = Math.trunc(Number(ticketConfig.unlock?.level) || 0);
  const unlocked = unlockLevel <= (effects.levels.vault || 0)
    || explicitUnlocks.includes(kind)
    || effects.unlockedTickets.includes(kind);
  if (!unlocked) {
    throw new ScratchStoreError(`「${ticketConfig.name}」还没解锁：先升级「票种保险柜」。`, 409);
  }
  // 实付价（商店会员折扣）与中奖率（幸运护符加成）都由服务端算，客户端只是显示同一套数值。
  const basePrice = Math.max(1, Math.trunc(Number(ticketConfig.price)));
  const price = Math.max(1, Math.round(basePrice * (1 - effects.discount)));

  const openCount = await prisma.scratchTicket.count({ where: { ownerId, status: { in: OPEN_STATUSES } } });
  if (openCount >= effects.tableSlots) {
    throw new ScratchStoreError(`桌面上最多同时放 ${effects.tableSlots} 张票，先把刮完的票处理掉再买。`, 409);
  }

  const seed = crypto.randomBytes(18).toString('base64url');
  // 中奖率的三个来源叠加：票种基础 + 幸运护符（全票种）+ 票种专精（例如头奖信仰只对「头奖轮」）。
  const ticketLuck = Number((effects.ticketLuck || {})[kind]) || 0;
  const result = rules.generateResult(ticketConfig, seed, {
    winChance: (Number(ticketConfig.winChance) || 0) + effects.luckBonus + ticketLuck,
  });
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
      const currentProfile = await tx.scratchProfile.findUnique({ where: { ownerId } });
      const stats = parseJsonObject(currentProfile?.statsJson, {});
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

/** 保存拖动后的桌面坐标（拖拽调用；单人玩法，只能改自己桌上的票）。 */
async function updateTicketPosition(username, ticketId, patch = {}) {
  if (typeof ticketId !== 'string' || !ticketId) throw new ScratchStoreError('票不存在。', 404);
  const ownerId = await resolveOwnerId(username);
  const data = {};
  if (patch.posX !== undefined) data.posX = requirePercent(patch.posX, 'posX');
  if (patch.posY !== undefined) data.posY = requirePercent(patch.posY, 'posY');
  // 摆放角度：拖过或点开过的票会被客户端摆正（rotation = 0），这样刷新后也还是正的。
  if (patch.rotation !== undefined) {
    const rotation = Number(patch.rotation);
    if (!Number.isFinite(rotation) || rotation < -180 || rotation > 180) {
      throw new ScratchStoreError('rotation 必须是 -180~180 的数字。');
    }
    data.rotation = Math.round(rotation * 10) / 10;
  }
  let requestedZ = null;
  if (patch.z !== undefined) {
    const z = Math.trunc(Number(patch.z));
    if (!Number.isFinite(z) || z < 0 || z > 9999) throw new ScratchStoreError('z 必须是 0~9999 的整数。');
    requestedZ = z;
    data.z = Math.min(z, Z_LIMIT);
  }
  if (!Object.keys(data).length) throw new ScratchStoreError('没有要更新的字段。');

  const updated = await prisma.scratchTicket.updateMany({
    where: { id: ticketId, ownerId, status: { in: OPEN_STATUSES } },
    data,
  });
  if (!updated.count) throw new ScratchStoreError('这张票不在桌面上。', 404);

  // 拖一次抬一层，z 迟早会涨到上限；到顶就按当前叠放顺序把整桌重新编号到 1..N，
  // 免得 z 无限增长最后压住提示条、聚焦大票这些界面（这也是「缩略图盖在大票上」的根因）。
  if (requestedZ !== null && requestedZ >= Z_LIMIT) {
    await prisma.$transaction(async (tx) => {
      const open = await tx.scratchTicket.findMany({
        where: { ownerId, status: { in: OPEN_STATUSES } },
        orderBy: [{ z: 'asc' }, { purchasedAt: 'asc' }],
      });
      const ordered = [...open.filter((item) => item.id !== ticketId), ...open.filter((item) => item.id === ticketId)];
      for (const [index, item] of ordered.entries()) {
        if (item.z !== index + 1) {
          await tx.scratchTicket.update({ where: { id: item.id }, data: { z: index + 1 } });
        }
      }
    });
  }

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
  // 「精准刮刀」升级会降低结算门槛（effects.thresholdBonus 是负数），但不低于 15%，避免免刮结算。
  const profile = await ensureProfile(ownerId);
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  const threshold = Math.min(1, Math.max(0.15, (Number(definition.scratch?.threshold) || 0.6) + effects.thresholdBonus));
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
  const basePrize = Math.trunc(Number(parsed?.prize) || 0);
  if (!parsed?.won || basePrize <= 0) throw new ScratchStoreError('这张票没中奖，拖进碎纸机还能换纸屑。', 409);

  await holdemStore.getAccount(username);   // 确保筹码账户存在（首次开户也在这里补齐）
  const profile = await ensureProfile(ownerId);
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  // 「兑奖机」升级：按比例加价，四舍五入但至少 1 币。
  const boosted = Math.max(1, Math.round(basePrize * (1 + effects.prizeBonus)));
  // 「暴击」：按概率把这次兑奖翻倍（结果会写进流水备注，方便回看）。
  const crit = effects.critChance > 0 && Math.random() < effects.critChance;
  const prize = crit ? Math.max(1, Math.round(boosted * effects.critMultiplier)) : boosted;
  const definition = loadCatalog().byKey.get(ticket.kind);
  const bonusText = effects.prizeBonus > 0 ? `（兑奖机 +${Math.round(effects.prizeBonus * 100)}%）` : '';
  const critText = crit ? `（暴击 ×${effects.critMultiplier}）` : '';
  const note = `兑奖：${definition?.name || ticket.kind} 中 ${prize} 币${bonusText}${critText}`;

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
    return { ticket: ticketDto(settled.updated), money: settled.chips, prize, basePrize, crit, alreadySettled: false };
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
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  const bonus = Math.max(0, Math.trunc(effects.shredBonus));
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

/**
 * 技能树数据：每个节点的等级、前置是否点亮、下一级价格、是否买得起、效果文案，以及分类与方位。
 * 价格与效果都由服务端算，客户端只负责画（避免两端规则漂移）。
 */
async function getUpgrades(username) {
  const ownerId = await resolveOwnerId(username);
  const account = await holdemStore.getAccount(username);
  const profile = await ensureProfile(ownerId);
  const rawLevels = parseJsonObject(profile.levelsJson, {});
  const effects = computeEffects(rawLevels);
  const tree = loadUpgrades();
  const maxColumn = tree.upgrades.reduce((max, item) => Math.max(max, Math.trunc(Number(item.column) || 0)), 0);
  const maxRow = tree.upgrades.reduce((max, item) => Math.max(max, Math.trunc(Number(item.row) || 0)), 0);
  const refund = computeRefund(rawLevels);

  return {
    money: account.chips,
    scraps: profile.scraps,
    version: tree.version,
    note: tree.note,
    categories: tree.categories,
    effects,
    maxColumn,
    maxRow,
    // 重置前的确认框要显示「会退回多少」，这里先算好交给前端
    refundPreview: { money: refund.refundMoney, scraps: refund.refundScraps, levels: refund.clearedLevels },
    upgrades: tree.upgrades.map((upgrade) => {
      const maxLevel = effects.maxLevels[upgrade.id] || 1;
      const level = effects.levels[upgrade.id] || 0;
      const root = Boolean(upgrade.root);
      const requirement = requirementStatus(upgrade, rawLevels);
      const costs = Array.isArray(upgrade.cost) ? upgrade.cost : [];
      const cost = !root && level < maxLevel ? costs[level] || null : null;
      const money = Math.max(0, Math.trunc(Number(cost?.money) || 0));
      const scraps = Math.max(0, Math.trunc(Number(cost?.scraps) || 0));
      const affordable = Boolean(cost) && account.chips >= money && profile.scraps >= scraps;
      const text = describeEffect(upgrade, level, effects);
      return {
        id: upgrade.id,
        name: upgrade.name || upgrade.id,
        icon: upgrade.icon || '⭐',
        desc: upgrade.desc || '',
        category: upgrade.category || 'core',
        // 布局：横向长条 —— 第几列 + 这一列第几行（客户端据此绝对定位，宽度按列数算）
        column: Math.max(0, Math.trunc(Number(upgrade.column) || 0)),
        row: Math.max(0, Math.trunc(Number(upgrade.row) || 0)),
        shelf: Boolean(upgrade.shelf),
        root,
        maxLevel,
        level,
        maxed: level >= maxLevel,
        requires: Array.isArray(upgrade.requires) ? upgrade.requires : [],
        requiresMet: requirement.met,
        requiresText: requirement.unmet.length ? `需要先点亮：${requirement.unmet.join('、')}` : '',
        cost: cost ? { money, scraps } : null,
        affordable,
        buyable: !root && requirement.met && level < maxLevel && affordable,
        nowText: text.now,
        nextText: root ? '树的起点' : (level >= maxLevel ? '已满级' : text.next),
      };
    }),
  };
}

/** 升级：金钱走筹码账户（与买票同一条写入路径），纸屑从刮刮乐档案里扣，两者在同一事务里完成。 */
async function buyUpgrade(username, upgradeId) {
  if (typeof upgradeId !== 'string' || !upgradeId) throw new ScratchStoreError('没有指定要升级什么。');
  const upgrade = loadUpgrades().byId.get(upgradeId);
  if (!upgrade) throw new ScratchStoreError('没有这项升级。', 404);
  if (upgrade.root) throw new ScratchStoreError(`「${upgrade.name || upgrade.id}」是树的起点，开局就点亮了。`, 409);

  const ownerId = await resolveOwnerId(username);
  await holdemStore.getAccount(username);
  const profile = await ensureProfile(ownerId);
  const rawLevels = parseJsonObject(profile.levelsJson, {});
  const effects = computeEffects(rawLevels);
  const level = effects.levels[upgrade.id] || 0;
  const maxLevel = effects.maxLevels[upgrade.id] || 1;
  if (level >= maxLevel) throw new ScratchStoreError(`${upgrade.name || upgrade.id} 已经满级了。`, 409);

  // 前置没点亮就买不了：这条是「循序渐进」的硬保证（客户端画灰了也要防住直接调接口）。
  const requirement = requirementStatus(upgrade, rawLevels);
  if (!requirement.met) throw new ScratchStoreError(`还没解锁：先点亮 ${requirement.unmet.join('、')}。`, 409);

  const cost = Array.isArray(upgrade.cost) ? upgrade.cost[level] || null : null;
  if (!cost) throw new ScratchStoreError('这一级的升级价格还没配置。', 500);
  const money = Math.max(0, Math.trunc(Number(cost.money) || 0));
  const scraps = Math.max(0, Math.trunc(Number(cost.scraps) || 0));
  if (scraps > profile.scraps) {
    throw new ScratchStoreError(`纸屑不够：需要 ${scraps}，现在只有 ${profile.scraps}。`, 409);
  }

  const note = `升级：${upgrade.name || upgrade.id} → ${level + 1} 级`;
  try {
    await prisma.$transaction(async (tx) => {
      const balance = await holdemStore.applyChipsWithinTx(tx, ownerId, { delta: -money, kind: 'scratch-upgrade', note });
      const current = await tx.scratchProfile.findUnique({ where: { ownerId } });
      const nextLevels = { ...parseJsonObject(current?.levelsJson, {}), [upgrade.id]: level + 1 };
      const nextScraps = (current?.scraps || 0) - scraps;
      const stats = parseJsonObject(current?.statsJson, {});
      await tx.scratchProfile.update({
        where: { ownerId },
        data: {
          levelsJson: JSON.stringify(nextLevels),
          scraps: nextScraps,
          statsJson: JSON.stringify({ ...stats, upgrades: Math.trunc(Number(stats.upgrades) || 0) + 1 }),
        },
      });
      if (money > 0) {
        await tx.scratchLedger.create({
          data: { ownerId, currency: 'money', delta: -money, balance: balance.chips, kind: 'scratch-upgrade', note },
        });
      }
      if (scraps > 0) {
        await tx.scratchLedger.create({
          data: { ownerId, currency: 'scraps', delta: -scraps, balance: nextScraps, kind: 'scratch-upgrade', note },
        });
      }
    });
  } catch (error) {
    if (error instanceof holdemStore.HoldemStoreError) throw new ScratchStoreError(error.message, error.statusCode);
    throw error;
  }

  return getUpgrades(username);
}

/**
 * 纸屑熔炼：按当前汇率把纸屑换成钱（「纸屑熔炼炉」升级解锁，effects.exchange = 每 N 纸屑换 1 币）。
 * 两个货币在同一个事务里改：纸屑从 ScratchProfile 扣，钱走 applyChipsWithinTx。
 */
async function smeltScraps(username, requested) {
  const ownerId = await resolveOwnerId(username);
  await holdemStore.getAccount(username);
  const profile = await ensureProfile(ownerId);
  const effects = computeEffects(parseJsonObject(profile.levelsJson, {}));
  const rate = Math.max(0, Math.trunc(effects.exchange));
  if (!rate) throw new ScratchStoreError('还没解锁「纸屑熔炼炉」：先在技能树里点亮它。', 409);

  const available = Math.max(0, profile.scraps);
  const amount = requested === undefined || requested === null || requested === ''
    ? available
    : Math.trunc(Number(requested));
  if (!Number.isFinite(amount) || amount <= 0) throw new ScratchStoreError('要熔炼至少 1 单位纸屑。', 400);
  if (amount > available) throw new ScratchStoreError(`纸屑不够：现在只有 ${available}。`, 409);

  const gain = Math.floor(amount / rate);
  if (gain <= 0) throw new ScratchStoreError(`至少要 ${rate} 单位纸屑才能熔出 1 币。`, 409);
  const spent = gain * rate;
  const note = `熔炼：${spent} 纸屑 → ${gain} 币（每 ${rate} 换 1）`;

  const settled = await prisma.$transaction(async (tx) => {
    const balance = await holdemStore.applyChipsWithinTx(tx, ownerId, { delta: gain, kind: 'scratch-smelt', note });
    const current = await tx.scratchProfile.findUnique({ where: { ownerId } });
    const nextScraps = (current?.scraps || 0) - spent;
    const stats = parseJsonObject(current?.statsJson, {});
    await tx.scratchProfile.update({
      where: { ownerId },
      data: {
        scraps: nextScraps,
        statsJson: JSON.stringify({
          ...stats,
          smelted: Math.trunc(Number(stats.smelted) || 0) + spent,
          smeltMoney: Math.trunc(Number(stats.smeltMoney) || 0) + gain,
        }),
      },
    });
    await tx.scratchLedger.create({
      data: { ownerId, currency: 'scraps', delta: -spent, balance: nextScraps, kind: 'scratch-smelt', note },
    });
    return { balance, nextScraps };
  });

  return { money: settled.balance.chips, scraps: settled.nextScraps, spent, gain, rate };
}

/**
 * 保存桌面上某台机器的位置或收起状态（只改自己的；收起 = 放进「能力」栏）。
 */
async function updateMachine(username, machineId, patch = {}) {
  if (!MACHINE_IDS.includes(machineId)) throw new ScratchStoreError('没有这台机器。', 404);
  const ownerId = await resolveOwnerId(username);
  const profile = await ensureProfile(ownerId);
  const machines = parseMachines(profile.machinesJson);
  const current = machines[machineId];
  machines[machineId] = {
    x: patch.x === undefined ? current.x : requirePercent(patch.x, 'x'),
    y: patch.y === undefined ? current.y : requirePercent(patch.y, 'y'),
    folded: patch.folded === undefined ? current.folded : patch.folded === true,
  };
  await prisma.scratchProfile.update({ where: { ownerId }, data: { machinesJson: JSON.stringify(machines) } });
  return { machines };
}

/**
 * 按配置的价格表算出「如果现在重置，能退回多少」：金钱、纸屑、总级数。
 * getUpgrades（给前端显示确认框）与 resetUpgrades（真正退款）共用这一份逻辑。
 */
function computeRefund(levels) {
  const table = loadUpgrades().upgrades;
  let money = 0;
  let scraps = 0;
  let clearedLevels = 0;
  for (const upgrade of table) {
    const level = Math.max(0, Math.trunc(Number(levels[upgrade.id]) || 0));
    if (!level) continue;
    const costs = Array.isArray(upgrade.cost) ? upgrade.cost : [];
    for (let index = 0; index < level; index += 1) {
      const cost = costs[index];
      if (!cost) break;
      money += Math.max(0, Math.trunc(Number(cost.money) || 0));
      scraps += Math.max(0, Math.trunc(Number(cost.scraps) || 0));
      clearedLevels += 1;
    }
  }
  return { refundMoney: money, refundScraps: scraps, clearedLevels };
}

/**
 * 重置技能树：清空所有等级，并把已经花掉的金钱与纸屑按配置价格**全额退还**（等于洗点）。
 * 退款额直接由 upgrades.json 的 cost 表逐级复算，所以不会算错也不会漏。
 */
async function resetUpgrades(username) {
  const ownerId = await resolveOwnerId(username);
  await holdemStore.getAccount(username);
  const profile = await ensureProfile(ownerId);
  const levels = parseJsonObject(profile.levelsJson, {});

  const refund = computeRefund(levels);
  const { refundMoney, refundScraps, clearedLevels } = refund;
  if (!clearedLevels) throw new ScratchStoreError('技能树还是空的，没有需要重置的内容。', 409);

  const note = `重置技能树：退还 ${refundMoney} 币 + ${refundScraps} 纸屑（共清空 ${clearedLevels} 级）`;
  const settled = await prisma.$transaction(async (tx) => {
    const balance = await holdemStore.applyChipsWithinTx(tx, ownerId, { delta: refundMoney, kind: 'scratch-reset', note });
    const current = await tx.scratchProfile.findUnique({ where: { ownerId } });
    const nextScraps = (current?.scraps || 0) + refundScraps;
    const stats = parseJsonObject(current?.statsJson, {});
    await tx.scratchProfile.update({
      where: { ownerId },
      data: {
        levelsJson: '{}',
        scraps: nextScraps,
        statsJson: JSON.stringify({ ...stats, resets: Math.trunc(Number(stats.resets) || 0) + 1 }),
      },
    });
    if (refundMoney > 0) {
      await tx.scratchLedger.create({ data: { ownerId, currency: 'money', delta: refundMoney, balance: balance.chips, kind: 'scratch-reset', note } });
    }
    if (refundScraps > 0) {
      await tx.scratchLedger.create({ data: { ownerId, currency: 'scraps', delta: refundScraps, balance: nextScraps, kind: 'scratch-reset', note } });
    }
    return { balance, nextScraps };
  });

  return {
    money: settled.balance.chips,
    scraps: settled.nextScraps,
    refundMoney,
    refundScraps,
    clearedLevels,
    machines: parseMachines(profile.machinesJson),
  };
}

module.exports = {
  ScratchStoreError,
  TABLE_SLOTS,
  Z_LIMIT,
  OPEN_STATUSES,
  MACHINE_IDS,
  DEFAULT_MACHINES,
  loadCatalog,
  loadUpgrades,
  computeEffects,
  getProfile,
  getCatalog,
  listTickets,
  listLedger,
  getUpgrades,
  buyUpgrade,
  buyTicket,
  updateTicketPosition,
  revealTicket,
  redeemTicket,
  shredTicket,
  smeltScraps,
  updateMachine,
  resetUpgrades,
};