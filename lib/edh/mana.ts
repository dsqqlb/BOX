// 法力费用字符串解析："{2}{U}{U}" -> ["2","U","U"]；"{X}{R}" -> ["X","R"]。

const MANA_SYMBOL_PATTERN = /\{([^}]+)\}/g;

export function parseManaCost(manaCost: string): string[] {
  if (!manaCost) return [];
  return [...manaCost.matchAll(MANA_SYMBOL_PATTERN)].map((match) => match[1]);
}

const COLOR_STYLES: Record<string, { bg: string; fg: string }> = {
  W: { bg: '#f8f4e3', fg: '#3a3626' },
  U: { bg: '#0e68ab', fg: '#e6f3ff' },
  B: { bg: '#1a1a1a', fg: '#d8d3c9' },
  R: { bg: '#d3202a', fg: '#ffe9e2' },
  G: { bg: '#00733e', fg: '#e6f7ec' },
  C: { bg: '#94a3b8', fg: '#0f172a' },
};

/** 单个法力符号的展示样式：数字/X 用中性灰底，混色符号（如 W/U）取第一个颜色。 */
export function manaSymbolStyle(symbol: string): { bg: string; fg: string; label: string } {
  const cleaned = symbol.replace('/P', '').split('/')[0];
  if (COLOR_STYLES[cleaned]) return { ...COLOR_STYLES[cleaned], label: cleaned };
  return { bg: '#e2e8f0', fg: '#1e293b', label: symbol };
}

/** 从类型行提取用于分组展示的主类别：生物/瞬间/法术/结界/神器/鹏洛客/地/战场/其他。 */
export function primaryCardType(typeLine: string): string {
  const line = typeLine.toLowerCase();
  if (line.includes('land')) return 'land';
  if (line.includes('creature')) return 'creature';
  if (line.includes('planeswalker')) return 'planeswalker';
  if (line.includes('battle')) return 'battle';
  if (line.includes('instant')) return 'instant';
  if (line.includes('sorcery')) return 'sorcery';
  if (line.includes('artifact')) return 'artifact';
  if (line.includes('enchantment')) return 'enchantment';
  return 'other';
}

export const TYPE_LABEL_ZH: Record<string, string> = {
  creature: '生物',
  instant: '瞬间',
  sorcery: '法术',
  artifact: '神器',
  enchantment: '结界',
  planeswalker: '鹏洛客',
  battle: '战场',
  land: '地',
  other: '其他',
};

export const TYPE_ORDER = ['creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle', 'land', 'other'];
