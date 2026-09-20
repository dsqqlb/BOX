/**
 * 刮刮乐类型（与 code/server/scratch-store.js、scratch-rules.js 的 DTO 一一对应）。
 *
 * 约定：
 *   · money = 德州扑克那份娱乐筹码，同一个数字，不是另一套余额；
 *   · scraps = 纸屑，第二货币；
 *   · 票面结果只在这张票刮开之后才会下发（revealed = true 时 result 才有值）。
 */

export interface ScratchTicketGrid {
  rows: number;
  cols: number;
}

/**
 * 票面形状：**一律是矩形**，区别只在长宽比和摆到桌上的宽度。
 * kind 只是给 CSS / 日志用的标签（wide / tall / square…），不参与绘制。
 */
export interface TicketShape {
  kind: string;
  /** 宽高比 = 宽 ÷ 高：>1 是横票，=1 是方票，<1 是竖票。 */
  aspect: number;
  /** 摆在桌面上时的宽度（桌面宽度的百分比）。 */
  tableWidth: number;
}

/** 票面上「刮开前就公开」的信息（例如好运符号当张公布的中奖符号）。 */
export interface ScratchLegend {
  label: string;
  symbol: string;
  note: string;
}

/**
 * 印刷层：格子内容 + 票面公布的符号 + 玩法。
 * 真票的印刷就压在涂层下面，所以它在买票时就随票下发，刮到哪露到哪（这就是刮的爽感来源）。
 */
export interface ScratchPrint {
  grid: ScratchTicketGrid;
  cells: ScratchCell[];
  legend: ScratchLegend | null;
  rules: string;
}

/** 结算：中没中、多少奖金。刮开达标后由服务端确认才下发。 */
export interface ScratchOutcome {
  won: boolean;
  prize: number;
  headline: string;
  detail: Record<string, unknown> | null;
}

export interface TicketTheme {
  accent: string;
  paper: string;
  ink: string;
  foil: string;
  edge: string;
}

export interface ScratchPrizeEntry {
  when: string;
  wins?: number;
  hits?: number;
  value: number;
  weight: number;
}

export interface ScratchPrizeConfig {
  values?: number[];
  weights?: number[];
  table?: ScratchPrizeEntry[];
}

export interface ScratchTicketDefinition {
  key: string;
  name: string;
  tagline: string;
  rules: string;
  rulesText: string;
  price: number;
  grid: ScratchTicketGrid;
  scratch: { threshold: number; brush: number };
  winChance: number;
  prize: ScratchPrizeConfig;
  symbols?: string[];
  numberRange?: [number, number];
  shredScraps: number;
  shape: TicketShape;
  theme: TicketTheme;
  unlock: { level: number; note?: string };
}

/** 升级后的实际数值：服务端算好下发，客户端只显示与使用（不重复实现规则）。 */
export interface ScratchEffects {
  /** 刮开层笔刷直径（占游戏区宽度的百分比）。 */
  brushPercent: number;
  /** 结算门槛加成（负数 = 更早结算，来自「精准刮刀」）。 */
  thresholdBonus: number;
  /** 自动刮机器每秒擦掉的点数（0 = 未启用）。 */
  autoPointsPerSecond: number;
  /** 自动刮奖机刮完一张要多少毫秒（0 = 立刻完成）。 */
  autoMachineMs: number;
  /** 兑奖加成（0.15 = +15%）。 */
  prizeBonus: number;
  /** 暴击概率（0.1 = 10%）。 */
  critChance: number;
  /** 暴击倍数（命中时乘多少）。 */
  critMultiplier: number;
  /** 每张票的碎纸加成。 */
  shredBonus: number;
  /** 纸屑熔炼汇率：每 N 单位纸屑换 1 币（0 = 未解锁）。 */
  exchange: number;
  /** 买票折扣（0.1 = -10%）。 */
  discount: number;
  /** 中奖率加成（绝对值，0.06 = +6 个百分点）。 */
  luckBonus: number;
  /** 指定票种的中奖率加成（例如只对「头奖轮」生效）。 */
  ticketLuck: Record<string, number>;
  /** 桌面容量。 */
  tableSlots: number;
  /** 已解锁的票种 key。 */
  unlockedTickets: string[];
  /** 升级树里的布尔开关（例如 autoScratchAll 打开「自动巡桌」）。 */
  flags: Record<string, boolean>;
  /** 未识别效果种类的兜底累加，方便先在 JSON 里试新数值。 */
  custom: Record<string, number>;
  levels: Record<string, number>;
  maxLevels: Record<string, number>;
}

export interface ScratchUpgradeCategory {
  id: string;
  name: string;
  icon?: string;
  color: string;
}

/** 桌面机器：位置（桌面百分比）+ 是否收进「能力」栏。 */
export interface ScratchMachineState {
  x: number;
  y: number;
  folded: boolean;
}

export type ScratchMachineId = 'redeem' | 'shred' | 'auto';

export type ScratchMachines = Record<string, ScratchMachineState>;

export interface ScratchMachinePayload {
  machines: ScratchMachines;
}

export interface ScratchResetPayload {
  money: number;
  scraps: number;
  /** 退还给你的金钱 / 纸屑。 */
  refundMoney: number;
  refundScraps: number;
  /** 清空了多少级。 */
  clearedLevels: number;
  machines: ScratchMachines;
}

export interface ScratchUpgrade {
  id: string;
  name: string;
  icon: string;
  desc: string;
  category: string;
  /** 技能树布局：第几列（0 = 起点那列，之后每个分支一列）。 */
  column: number;
  /** 技能树布局：这一列里的第几行。 */
  row: number;
  /** 会在桌面顶部「能力」栏里出现。 */
  shelf: boolean;
  /** 树的起点（开局就点亮，不参与购买）。 */
  root: boolean;
  maxLevel: number;
  level: number;
  maxed: boolean;
  /** 前置条件原文（`id` 或 `id@3`）。 */
  requires: string[];
  requiresMet: boolean;
  /** 前置没点亮时的提示文案。 */
  requiresText: string;
  /** 下一级价格（满级 / 起点时为 null）。 */
  cost: { money: number; scraps: number } | null;
  affordable: boolean;
  /** 前置已点亮 + 未满级 + 资源够：可以按住解锁。 */
  buyable: boolean;
  nowText: string;
  nextText: string;
}

export interface ScratchUpgradesPayload {
  money: number;
  scraps: number;
  version: number;
  note: string;
  categories: ScratchUpgradeCategory[];
  effects: ScratchEffects;
  /** 树最多有几列 / 几行，用来算横向画布宽度与纵向行高。 */
  maxColumn: number;
  maxRow: number;
  /** 现在重置会退回多少（前端拿它显示确认框里的数字）。 */
  refundPreview: { money: number; scraps: number; levels: number };
  upgrades: ScratchUpgrade[];
}

export interface ScratchSmeltPayload {
  money: number;
  scraps: number;
  /** 这次熔掉的纸屑。 */
  spent: number;
  /** 换到的钱。 */
  gain: number;
  /** 当前汇率：每 rate 单位纸屑换 1 币。 */
  rate: number;
}

export interface ScratchCatalogTicket extends ScratchTicketDefinition {
  /** 票种配置问题（服务端校验结果，空数组 = 正常）。 */
  problems: string[];
  /** 长期回收率（中奖概率 × 平均奖金 ÷ 票价）。 */
  expectedReturn: number;
  unlocked: boolean;
  /** 票面标价（未打折）。 */
  priceBase: number;
  /** 实际中奖概率（已含「幸运护符」加成）。 */
  winChance: number;
  /** 实际结算门槛（已含「精准刮刀」升级）。 */
  threshold: number;
}

export interface ScratchCatalog {
  version: number;
  note: string;
  moneyNote: string;
  effects: ScratchEffects;
  tickets: ScratchCatalogTicket[];
}

export type ScratchCellTag = 'prize' | 'blank';

export interface ScratchCell {
  id: number;
  label: string;
  tag: ScratchCellTag;
  value?: number;
  role?: 'you' | 'dealer';
  pair?: number;
  symbol?: string;
}

export type ScratchTicketStatus = 'sealed' | 'scratched' | 'redeemed' | 'shredded';

export interface ScratchTicket {
  id: string;
  kind: string;
  name: string;
  price: number;
  status: ScratchTicketStatus;
  scratchRatio: number;
  posX: number;
  posY: number;
  z: number;
  /** 摆放角度（度）：null = 还没摆正（客户端按票 id 给一个「刚被扔出来」的随机角），0 = 已经摆正。 */
  rotation: number | null;
  purchasedAt: string;
  updatedAt: string;
  revealed: boolean;
  /** 印刷层：买票起就有，被涂层盖住，刮到哪露到哪。 */
  print: ScratchPrint | null;
  /** 结算：刮开达标后才有值。 */
  outcome: ScratchOutcome | null;
}

export interface ScratchRevealPayload {
  ticket: ScratchTicket;
  alreadyRevealed: boolean;
}

export interface ScratchRedeemPayload {
  ticket: ScratchTicket;
  /** 兑奖后的余额（alreadySettled 时为 null）。 */
  money: number | null;
  /** 实际到账的奖金（含兑奖机加成与暴击）。 */
  prize: number;
  /** 票面原本的奖金（未加成）。 */
  basePrize: number;
  /** 这次兑奖是否触发暴击。 */
  crit: boolean;
  alreadySettled: boolean;
}

export interface ScratchShredPayload {
  ticket: ScratchTicket;
  /** 这一张碎出了多少纸屑。 */
  gained: number;
  /** 碎完之后的纸屑总数（alreadySettled 时为 null）。 */
  scraps: number | null;
  alreadySettled: boolean;
}

export interface ScratchProfile {
  money: number;
  scraps: number;
  levels: Record<string, number>;
  unlocked: string[];
  unlockedExtra: string[];
  stats: Record<string, number>;
  tableSlots: number;
  usedSlots: number;
  catalogVersion: number;
  effects: ScratchEffects;
  /** 桌面机器（兑奖机 / 碎纸机 / 自动刮奖机）的位置与收起状态。 */
  machines: ScratchMachines;
}

export interface ScratchLedgerEntry {
  id: string;
  currency: 'money' | 'scraps';
  delta: number;
  balance: number;
  kind: string;
  ticketId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ScratchTicketsPayload {
  tickets: ScratchTicket[];
}

export interface ScratchLedgerPayload {
  entries: ScratchLedgerEntry[];
}

export interface ScratchBuyPayload {
  ticket: ScratchTicket;
  money: number;
}