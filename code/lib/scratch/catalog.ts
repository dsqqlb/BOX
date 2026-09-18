import ticketConfig from '@content/scratch/tickets.json';
import { ScratchCatalogTicket, ScratchTicketDefinition, TicketShape } from './types';

/**
 * 票种配置读取（客户端侧）。
 *
 * 与资源文件是同一个来源：resources/content/scratch/tickets.json。
 * 展示用的价格、玩法说明、票面主题、格子布局都从这里取；
 * 「期望回收率 / 是否解锁 / 配置问题」由服务端算好放在 /api/scratch/catalog 里，不在这里重复实现。
 */

interface TicketConfigFile {
  version: number;
  note: string;
  moneyNote: string;
  tickets: ScratchTicketDefinition[];
}

const config = ticketConfig as TicketConfigFile;

export const TICKET_DEFINITIONS: ScratchTicketDefinition[] = config.tickets;
export const CATALOG_NOTE = config.note;
export const MONEY_NOTE = config.moneyNote;

export function getTicketDefinition(key: string): ScratchTicketDefinition | undefined {
  return config.tickets.find((ticket) => ticket.key === key);
}

/** 「金钱」的统一写法：它就是德州扑克那份娱乐筹码，所以只写数字 + 币。 */
export function formatMoney(value: number): string {
  return `${Math.round(value)} 币`;
}

export function formatDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export const LEDGER_KIND_LABELS: Record<string, string> = {
  'scratch-buy': '买票',
  'scratch-prize': '兑奖',
  'scratch-upgrade': '升级',
  'grant': '开户赠送',
};

export function ticketAccent(ticket: ScratchCatalogTicket | ScratchTicketDefinition): string {
  return ticket.theme?.accent || '#f5c451';
}

/** 票形兜底：配置里漏了 shape 也不会画不出来。票永远是矩形，只有长宽比不同。 */
const FALLBACK_SHAPE: TicketShape = { kind: 'wide', aspect: 1.8, tableWidth: 12 };

/** 取某票种的形状（桌面上的票只有 kind，形状从本地这份 JSON 查，与票面绘制共用同一套规则）。 */
export function getTicketShape(key: string): TicketShape {
  return getTicketDefinition(key)?.shape ?? FALLBACK_SHAPE;
}

export { FALLBACK_SHAPE };