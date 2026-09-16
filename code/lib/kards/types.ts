export interface KardsCard {
  id: string;
  name: string;
  slug: string;
  faction: string;
  cost: number;
  path: string;
}

export interface KardsCatalog {
  generatedAt: string;
  total: number;
  factions: string[];
  costs: number[];
  cards: KardsCard[];
}

export interface KardsDeck {
  id: string;
  owner: string;
  name: string;
  faction: string | null;
  cards: string[];
  createdAt: string;
  updatedAt: string;
}

export type KardsZone = 'deck' | 'hand' | 'frontline' | 'support' | 'discard' | 'hq';

export interface KardsPlayerView {
  seat: number;
  username: string | null;
  connected: boolean;
}

export interface KardsRoomCard {
  id: string;
  owner: 0 | 1;
  zone: KardsZone;
  order: number;
  faceDown: boolean;
  rotated: boolean;
  damage: number;
  cardId: string | null;
  hidden: boolean;
}

export interface KardsRoomLogEntry {
  at: number;
  seat: number;
  text: string;
}

export interface KardsRoomState {
  roomId: string;
  seat: number;
  players: KardsPlayerView[];
  kredits: { current: number; max: number }[];
  turnSeat: number;
  cards: KardsRoomCard[];
  log: KardsRoomLogEntry[];
}

export const KARDS_ZONES: { zone: KardsZone; label: string; hint: string }[] = [
  { zone: 'hq', label: 'HQ 指挥部', hint: '总部卡' },
  { zone: 'frontline', label: '前线', hint: '单位在此进攻/防守' },
  { zone: 'support', label: '支援行', hint: '支援单位与命令' },
  { zone: 'deck', label: '牌库', hint: '抽牌从这里' },
  { zone: 'discard', label: '墓地', hint: '阵亡与弃置' },
];
