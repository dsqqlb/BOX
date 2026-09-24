/**
 * 卡面显示工具：颜色名、牌型名、卡面标签、头像配色。
 *
 * 所有文案都从 /api/uno/catalog（也就是 resources/content/uno/base.json）里取，
 * 这样以后加拓展包时前端不需要改代码，只需要服务端返回新的 kinds/colors。
 */

import type { UnoCatalog, UnoCardView, UnoKind } from './types';

export const UNO_KIND_FALLBACK: Record<string, string> = {
  number: '数字牌',
  skip: '禁止牌',
  reverse: '反转牌',
  draw2: '罚摸两张',
  wild: '变色牌',
  wild4: '变色罚摸四张',
};

export function colorOf(catalog: UnoCatalog | null, colorId: string | null) {
  if (!colorId) return null;
  if (catalog?.wildColor && catalog.wildColor.id === colorId) return catalog.wildColor;
  return catalog?.colors.find((color) => color.id === colorId) || null;
}

export function colorHex(catalog: UnoCatalog | null, colorId: string | null): string {
  return colorOf(catalog, colorId)?.hex || (colorId === 'wild' ? '#1f2430' : '#334155');
}

export function colorName(catalog: UnoCatalog | null, colorId: string | null): string {
  return colorOf(catalog, colorId)?.name || (colorId || '未知');
}

export function kindOf(catalog: UnoCatalog | null, kindId: string): UnoKind | undefined {
  return catalog?.kinds.find((kind) => kind.id === kindId);
}

export function kindName(catalog: UnoCatalog | null, kindId: string): string {
  return kindOf(catalog, kindId)?.name || UNO_KIND_FALLBACK[kindId] || kindId;
}

/** 卡面上的大字符：数字牌是数字，功能牌是 art.glyph。 */
export function cardGlyph(catalog: UnoCatalog | null, card: UnoCardView): string {
  if (card.kind === 'number') return String(card.value ?? '');
  return kindOf(catalog, card.kind)?.art?.glyph || kindName(catalog, card.kind).slice(0, 1);
}

/** 完整牌面文字：如「红 7」「红 禁止牌」「变色罚摸四张」。 */
export function cardLabel(catalog: UnoCatalog | null, card: UnoCardView): string {
  if (card.kind === 'number') return `${colorName(catalog, card.color)} ${card.value}`;
  if (card.color === 'wild') return kindName(catalog, card.kind);
  return `${colorName(catalog, card.color)} ${kindName(catalog, card.kind)}`;
}

const AVATAR_COLORS = ['#e63329', '#f5b21a', '#2f9e44', '#1c6fd6', '#8b5cf6', '#0ea5e9', '#f97316', '#14b8a6'];

/** 头像底色由账户名哈希决定，同一个名字永远是同一个颜色。 */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) || 0)) % 1000003;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initialOf(name: string | null): string {
  return (name || '?').slice(0, 1).toUpperCase();
}

/** 思考时间档位的中文标签（0 = 不限时）。 */
export function thinkLabel(seconds: number): string {
  return seconds > 0 ? `${seconds} 秒` : '不限时';
}

export function botLevelLabel(level: string | null): string {
  if (level === 'easy') return '新手';
  if (level === 'hard') return '高手';
  return '普通';
}

export function phaseLabel(phase: string): string {
  if (phase === 'playing') return '对局中';
  if (phase === 'roundOver') return '本局结束';
  return '等待加入';
}

/** 把已开启的房规拼成一句话（大厅列表里用），全关时返回「全默认」。 */
export function describeRules(catalog: UnoCatalog | null, rules: Record<string, boolean | number | string>): string {
  const names = (catalog?.houseRules || [])
    .filter((rule) => rule.type === 'boolean' && rules[rule.id])
    .map((rule) => rule.name);
  return names.length ? names.join('、') : '全默认房规';
}