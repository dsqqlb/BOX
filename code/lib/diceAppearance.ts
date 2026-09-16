// 3D骰子外观预设：每个预设固定给D4/D6/D8/D10/D12/D20各自绑定一张纹理图，
// 同一预设内、同一形状永远用同一张图（不同形状之间可以不同），不再涉及颜色方案(colorset)——
// 纹理图本身已经盖住骰子表面，颜色底色对最终视觉没有意义，所以整个"颜色底色"概念被去掉了。
//
// 预设分两类：
// - 内置预设（BUILTIN_APPEARANCE_PRESETS）：写在代码里，不能删除/改名，但可以复制出一份自定义预设再改。
// - 自定义预设：用户在遥控器"骰子设置"页新建/编辑/命名/删除，存localStorage，跟内置预设并列展示在同一个列表里。

// 骰子形状：跟 dice-box-threejs 的 DICE_GEOM/DicePreset.shape 保持一致的key。
// D100在库里物理上复用D10模型(shape='d10')，所以D100固定跟随D10的纹理，不单独出现。
export type DiceShape = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';

export const DICE_SHAPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

export const DICE_SHAPE_LABELS: Record<DiceShape, string> = {
  d4: 'D4', d6: 'D6', d8: 'D8', d10: 'D10（含D100）', d12: 'D12', d20: 'D20',
};

// 每种可选纹理：展示名 + dice-box-threejs 里 const/texturelist.js 的 key + 缩略图路径（贴图本身，
// 与 DiceRoller.tsx 里传给 assetPath 的目录保持一致，供下拉菜单里的小方块预览使用）
export interface DiceTextureOption {
  key: string; // texturelist.js 的 key，''表示无纹理（纯白，几乎不会用到，仅做兜底）
  name: string;
  thumbnail: string; // 预览图片路径，''表示没有可预览的图（对应key为''的情况）
}

const TEX_BASE = '/dice-assets/textures/';

export const DICE_TEXTURE_OPTIONS: DiceTextureOption[] = [
  { key: '', name: '纯白（无纹理）', thumbnail: '' },
  { key: 'marble', name: '大理石', thumbnail: TEX_BASE + 'marble.webp' },
  { key: 'fire', name: '火焰', thumbnail: TEX_BASE + 'fire.webp' },
  { key: 'ice', name: '冰霜', thumbnail: TEX_BASE + 'ice.webp' },
  { key: 'water', name: '水波', thumbnail: TEX_BASE + 'water.webp' },
  { key: 'cloudy', name: '云雾', thumbnail: TEX_BASE + 'cloudy.webp' },
  { key: 'metal', name: '金属', thumbnail: TEX_BASE + 'metal.webp' },
  { key: 'wood', name: '木纹', thumbnail: TEX_BASE + 'wood.webp' },
  { key: 'stars', name: '星空', thumbnail: TEX_BASE + 'stars.webp' },
  { key: 'skulls', name: '骷髅', thumbnail: TEX_BASE + 'skulls.webp' },
  { key: 'glitter', name: '闪粉', thumbnail: TEX_BASE + 'glitter.webp' },
  { key: 'speckles', name: '斑点', thumbnail: TEX_BASE + 'speckles.webp' },
  { key: 'stainedglass', name: '彩色玻璃', thumbnail: TEX_BASE + 'stainedglass.webp' },
  { key: 'astral', name: '星辰', thumbnail: TEX_BASE + 'astral.webp' },
  { key: 'bronze01', name: '青铜', thumbnail: TEX_BASE + 'bronze01.webp' },
  { key: 'leopard', name: '豹纹', thumbnail: TEX_BASE + 'leopard.webp' },
  { key: 'tiger', name: '虎纹', thumbnail: TEX_BASE + 'tiger.webp' },
  { key: 'dragon', name: '龙鳞', thumbnail: TEX_BASE + 'dragon.webp' },
  { key: 'paper', name: '纸张', thumbnail: TEX_BASE + 'paper.webp' },
];

export function getTextureOption(key: string): DiceTextureOption {
  return DICE_TEXTURE_OPTIONS.find((t) => t.key === key) || DICE_TEXTURE_OPTIONS[0];
}

// 按形状指定的纹理：key不存在或为''表示无纹理（纯白兜底）
export type ShapeTextureMap = Partial<Record<DiceShape, string>>;

export interface DiceAppearancePreset {
  id: string;
  name: string;
  shapeTextures: ShapeTextureMap; // 每种形状固定绑定的纹理，同一预设内同一形状只有一张图
  builtin?: boolean; // true=内置预设，不可删除/改名（但可以在"另存为自定义"时复制出一份改）
}

// ============ 内置预设：每个都给6种形状配好确定的纹理，保证"同形状统一纹理"真正生效 ============
export const BUILTIN_APPEARANCE_PRESETS: DiceAppearancePreset[] = [
  {
    id: 'builtin_classic',
    name: '经典白',
    builtin: true,
    shapeTextures: { d4: '', d6: '', d8: '', d10: '', d12: '', d20: '' },
  },
  {
    id: 'builtin_nightshade',
    name: '暗夜黑',
    builtin: true,
    shapeTextures: { d4: 'speckles', d6: 'speckles', d8: 'speckles', d10: 'speckles', d12: 'speckles', d20: 'stainedglass' },
  },
  {
    id: 'builtin_inferno',
    name: '烈焰红',
    builtin: true,
    shapeTextures: { d4: 'fire', d6: 'fire', d8: 'fire', d10: 'fire', d12: 'fire', d20: 'dragon' },
  },
  {
    id: 'builtin_frost',
    name: '冰霜蓝',
    builtin: true,
    shapeTextures: { d4: 'ice', d6: 'ice', d8: 'ice', d10: 'ice', d12: 'ice', d20: 'water' },
  },
  {
    id: 'builtin_venom',
    name: '剧毒紫',
    builtin: true,
    shapeTextures: { d4: 'cloudy', d6: 'cloudy', d8: 'cloudy', d10: 'cloudy', d12: 'cloudy', d20: 'skulls' },
  },
  {
    id: 'builtin_astral',
    name: '星辰紫金',
    builtin: true,
    shapeTextures: { d4: 'astral', d6: 'astral', d8: 'astral', d10: 'astral', d12: 'astral', d20: 'stars' },
  },
];

export const DEFAULT_APPEARANCE_PRESET_ID = 'builtin_classic';

// ============ 自定义预设：存localStorage，最多10个，跟内置预设并列展示 ============

const CUSTOM_PRESETS_KEY = 'dnd-dice-appearance-presets';
export const MAX_CUSTOM_APPEARANCE_PRESETS = 10;

export function loadCustomAppearancePresets(): DiceAppearancePreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomAppearancePresets(presets: DiceAppearancePreset[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets.slice(0, MAX_CUSTOM_APPEARANCE_PRESETS)));
}

let idCounter = 0;
export function genAppearancePresetId(): string {
  idCounter += 1;
  return `dice_appearance_${Date.now()}_${idCounter}`;
}

// 全部可选预设 = 内置 + 自定义，UI里统一从这个列表里选
export function getAllAppearancePresets(customPresets: DiceAppearancePreset[]): DiceAppearancePreset[] {
  return [...BUILTIN_APPEARANCE_PRESETS, ...customPresets];
}

export function getAppearancePreset(id: string, customPresets: DiceAppearancePreset[]): DiceAppearancePreset {
  return getAllAppearancePresets(customPresets).find((p) => p.id === id) || BUILTIN_APPEARANCE_PRESETS[0];
}
