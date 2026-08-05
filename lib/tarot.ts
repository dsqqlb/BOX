import tarotCardsData from '@/data/tarot-cards.json';

// 塔罗牌花色（小阿卡纳）
export type TarotSuit = 'wands' | 'cups' | 'swords' | 'pentacles';

// 四大元素属性，用于视觉特效映射
export type TarotElement = 'fire' | 'water' | 'air' | 'earth';

export interface TarotCard {
  id: string;
  name: string;
  nameEn: string;
  arcana: 'major' | 'minor';
  number: number;
  suit: TarotSuit | null;
  element: TarotElement | null;
  image: string; // public/image/tarot/ 下的文件名
  keywords: string[];
  keywordsReversed: string[];
  upright: string;
  reversed: string;
}

// 抽到的一张牌：基础牌 + 正逆位状态 + 在牌阵中的位置信息
export interface DrawnCard {
  card: TarotCard;
  isReversed: boolean;
  positionIndex: number; // 在当前牌阵中的第几个位置（0-based）
}

// 牌阵中每个位置的定义
export interface SpreadPosition {
  label: string; // 位置名称，如"过去""现在""未来"
  meaning: string; // 该位置代表的含义说明
}

export interface Spread {
  id: string;
  name: string;
  description: string;
  positions: SpreadPosition[];
}

const CARDS: TarotCard[] = tarotCardsData as TarotCard[];

export function getAllCards(): TarotCard[] {
  return CARDS;
}

export function getCardById(id: string): TarotCard | undefined {
  return CARDS.find((c) => c.id === id);
}

export function getCardImageUrl(card: TarotCard): string {
  return `/image/tarot/${card.image}`;
}

// 牌背图片（SVG，代码内绘制，不依赖外部素材）
export const CARD_BACK_URL = '/image/tarot/card-back.svg';

// ---- 牌阵定义 ----
export const SPREADS: Spread[] = [
  {
    id: 'single',
    name: '单张牌阵',
    description: '最简洁直接的问卜方式，适合日常指引或快速解答一个具体问题。',
    positions: [{ label: '指引', meaning: '当下最需要关注的核心信息' }],
  },
  {
    id: 'three-card',
    name: '三张牌阵',
    description: '经典的时间流牌阵，梳理事情的发展脉络。',
    positions: [
      { label: '过去', meaning: '影响当下处境的过去因素' },
      { label: '现在', meaning: '当前所处的状态与核心课题' },
      { label: '未来', meaning: '事情可能发展的方向' },
    ],
  },
  {
    id: 'situation-action-outcome',
    name: '情况-行动-结果',
    description: '聚焦具体决策，适合"我该怎么做"类型的问题。',
    positions: [
      { label: '情况', meaning: '当前面临的真实处境' },
      { label: '行动', meaning: '建议采取的行动或态度' },
      { label: '结果', meaning: '这样做可能带来的结果' },
    ],
  },
  {
    id: 'celtic-cross',
    name: '凯尔特十字',
    description: '最经典的深度牌阵，全面剖析问题的方方面面，适合复杂或重大的议题。',
    positions: [
      { label: '现状', meaning: '问题的核心与当下处境' },
      { label: '挑战', meaning: '当前面临的直接阻碍或课题' },
      { label: '根源', meaning: '深层原因，事情的根基' },
      { label: '过去', meaning: '正在远离或已经过去的影响' },
      { label: '目标', meaning: '期望达成的最佳结果' },
      { label: '未来', meaning: '即将到来的发展趋势' },
      { label: '自我认知', meaning: '你如何看待自己在此事中的角色' },
      { label: '外部影响', meaning: '外界环境或他人对此事的影响' },
      { label: '期望与恐惧', meaning: '内心深处的期望或隐藏的担忧' },
      { label: '结果', meaning: '整个问题最终可能的走向' },
    ],
  },
];

export function getSpreadById(id: string): Spread | undefined {
  return SPREADS.find((s) => s.id === id);
}

// ---- 抽牌逻辑 ----

// Fisher-Yates 洗牌算法，返回新数组不修改原数组
export function shuffleCards(cards: TarotCard[]): TarotCard[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 从已洗好的牌堆中按牌阵所需数量抽取，每张牌独立随机正逆位（约50%概率逆位）
export function drawCards(shuffledDeck: TarotCard[], count: number): DrawnCard[] {
  const drawn: DrawnCard[] = [];
  for (let i = 0; i < count && i < shuffledDeck.length; i++) {
    drawn.push({
      card: shuffledDeck[i],
      isReversed: Math.random() < 0.5,
      positionIndex: i,
    });
  }
  return drawn;
}

// 花色对应的主题色，用于卡牌光效、边框等视觉呈现
export const SUIT_THEME: Record<TarotSuit, { color: string; glow: string; label: string; icon: string }> = {
  wands: { color: '#f97316', glow: 'rgba(249,115,22,0.55)', label: '权杖', icon: '🔥' },
  cups: { color: '#38bdf8', glow: 'rgba(56,189,248,0.55)', label: '圣杯', icon: '💧' },
  swords: { color: '#e2e8f0', glow: 'rgba(226,232,240,0.55)', label: '宝剑', icon: '💨' },
  pentacles: { color: '#4ade80', glow: 'rgba(74,222,128,0.55)', label: '星币', icon: '🌿' },
};

export const MAJOR_ARCANA_THEME = { color: '#fbbf24', glow: 'rgba(251,191,36,0.6)', label: '大阿卡纳', icon: '✨' };

export function getCardTheme(card: TarotCard) {
  if (card.arcana === 'major') return MAJOR_ARCANA_THEME;
  return SUIT_THEME[card.suit as TarotSuit];
}
