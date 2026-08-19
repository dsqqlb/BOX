// EDH 组卡台的类型定义。字段命名与 server/index.js 的 toSlimCard()/searchEdhCards() 保持一致。

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G';

export interface EdhCardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  image: EdhCardImage | null;
}

export interface EdhCardImage {
  small: string;
  normal: string;
  artCrop: string;
}

export interface EdhCard {
  oracleId: string;
  name: string;
  nameZh: string | null;
  manaCost: string;
  cmc: number;
  typeLine: string;
  typeLineZh: string | null;
  oracleText: string;
  oracleTextZh: string | null;
  colors: ManaColor[];
  colorIdentity: ManaColor[];
  keywords: string[];
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  rarity: string;
  set: string;
  setName: string;
  collectorNumber: string;
  layout: string;
  legalCommander: string;
  edhrecRank: number | null;
  isCommanderEligible: boolean;
  image: EdhCardImage | null;
  faces: EdhCardFace[] | null;
}

/** 显示用卡名/类型/文字：中文优先，没有中文版时用英文兜底。 */
export function displayName(card: EdhCard): string {
  return card.nameZh || card.name;
}

export function displayTypeLine(card: EdhCard): string {
  return card.typeLineZh || card.typeLine;
}

export function displayOracleText(card: EdhCard): string {
  return card.oracleTextZh || card.oracleText;
}

export interface EdhSearchFilters {
  q: string;
  colors: ManaColor[];
  colorMode: 'subset' | 'exact';
  types: string[];
  cmcMin: number | null;
  cmcMax: number | null;
  commanderOnly: boolean;
}

export interface EdhSearchResult {
  total: number;
  cards: EdhCard[];
}

export interface EdhCardsMeta {
  synced: boolean;
  generatedAt?: string;
  cardCount?: number;
  chineseCoverage?: number;
}

/** 牌组里的一条卡：只存 oracleId + 数量，渲染时用 /api/edh/cards/lookup 换回完整卡牌信息。 */
export interface EdhDeckCardEntry {
  oracleId: string;
  quantity: number;
}

export interface EdhDeck {
  id: string;
  owner: string;
  name: string;
  commanderOracleId: string | null;
  cards: EdhDeckCardEntry[];
  createdAt: string;
  updatedAt: string;
}

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];

export const MANA_COLOR_LABEL: Record<ManaColor, string> = {
  W: '白',
  U: '蓝',
  B: '黑',
  R: '红',
  G: '绿',
};
