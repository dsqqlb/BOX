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

export interface ScratchCatalogTicket extends ScratchTicketDefinition {
  /** 票种配置问题（服务端校验结果，空数组 = 正常）。 */
  problems: string[];
  /** 长期回收率（中奖概率 × 平均奖金 ÷ 票价）。 */
  expectedReturn: number;
  unlocked: boolean;
}

export interface ScratchCatalog {
  version: number;
  note: string;
  moneyNote: string;
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
  prize: number;
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
  stats: Record<string, number>;
  tableSlots: number;
  usedSlots: number;
  catalogVersion: number;
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