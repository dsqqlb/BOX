// 掷骰预设：保存在浏览器localStorage里，只存在这一台设备的遥控器上，不同步到房间/其他遥控器。
// 每个预设就是一段掷骰表达式文本（支持 lib/diceExpression.ts 的完整语法：NdS、+/-、括号、kh/kl取高取低），
// 比如"优势骰"存的是 "2d20kh1"，"检定+射击"可以存 "1d20+1d4"。最多保存10个，支持新建/改名/编辑/删除。

export interface DicePreset {
  id: string;
  name: string;
  expr: string;
}

// 旧版本的预设数据结构（几个几D几的分组，不支持kh/kl语法），仅用于读取旧数据做迁移
interface LegacyDiceGroup {
  sides: number;
  count: number;
}
interface LegacyDicePreset {
  id: string;
  name: string;
  groups: LegacyDiceGroup[];
}

const STORAGE_KEY = 'dnd-dice-presets';
export const MAX_PRESETS = 10;

// 内置的几个常用掷骰，首次使用（本地还没存过任何预设）时当默认值展示，
// 用户改动/删除后就会被真实存储的数据覆盖，不会每次都重新出现
const DEFAULT_PRESETS: DicePreset[] = [
  { id: 'preset_d20', name: '普通检定', expr: '1d20' },
  { id: 'preset_adv', name: '优势骰', expr: '2d20kh1' },
  { id: 'preset_atk', name: '近战攻击', expr: '1d20+1d6' },
];

// 把旧版"几个几D几分组"迁移成表达式文本，如 [{sides:20,count:2}] -> "2d20"
function legacyGroupsToExpr(groups: LegacyDiceGroup[]): string {
  return groups
    .filter((g) => g.count > 0)
    .map((g) => `${g.count}d${g.sides}`)
    .join('+');
}

export function loadDicePresets(): DicePreset[] {
  if (typeof window === 'undefined') return DEFAULT_PRESETS;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PRESETS;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS;
    // 兼容旧数据：存量预设是 {groups: [...]} 结构（没有expr字段），读取时原地转换成表达式文本，
    // 用户不会感知到这次迁移，下次保存时会自动写成新格式。
    return parsed.map((p: DicePreset | LegacyDicePreset) =>
      'expr' in p ? p : { id: p.id, name: p.name, expr: legacyGroupsToExpr(p.groups) }
    );
  } catch {
    return DEFAULT_PRESETS;
  }
}

export function saveDicePresets(presets: DicePreset[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
}

let idCounter = 0;
export function genPresetId(): string {
  idCounter += 1;
  return `preset_${Date.now()}_${idCounter}`;
}
