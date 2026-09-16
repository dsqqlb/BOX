// DND先攻追踪器：状态效果（buff/debuff/濒死）共享定义
// 遥控器(app/tools/initiative-tracker/page.tsx)和主屏幕(app/tools/initiative-tracker/display/page.tsx)
// 都依赖这份类型和常量清单，保证两端渲染的图标/颜色/动效完全一致。

// 状态大类：增益 / 减益 / 特殊（目前特殊只有"濒死"，走豁免机制而非固定回合数）
export type StatusCategory = 'buff' | 'debuff' | 'special';

// 状态ID：覆盖DND 5e常见状态 + 濒死
export type StatusId =
  | 'bless' | 'shield' | 'rage' | 'haste' | 'concentration'
  | 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled'
  | 'incapacitated' | 'invisible' | 'paralyzed' | 'petrified' | 'exhaustion'
  | 'poisoned' | 'prone' | 'restrained' | 'stunned' | 'unconscious'
  | 'dying';

// 卡片级动效分组：机制相近的状态共用同一套视觉语言（如擒抱/束缚都是"被链条缠住"），
// 但整体覆盖足够多种类，保证增益/减益/特殊各自有明显区分度
export type CardEffectKey =
  | 'buffGlow'        // 增益类：色彩跟随状态色的柔和光晕呼吸（祝福/护盾/专注）
  | 'haste'           // 加速：横向速度光线拉丝
  | 'rage'            // 狂暴：猛烈的红色搏动
  | 'tremble'         // 恐慌：细密紧张的抖动
  | 'blind'           // 目盲：黑色遮罩扫过
  | 'charm'           // 魅惑：粉色心形光晕漂浮
  | 'deafen'          // 耳聋：静音声波环消散
  | 'chain'           // 擒抱/束缚：锁链晃动
  | 'faint'           // 失能/倒地/昏迷：灰暗虚弱脉动
  | 'invisible'       // 隐形：整卡透明度闪烁
  | 'paralyze'        // 麻痹：僵直蓝白闪光
  | 'petrify'         // 石化：石纹裂痕灰化
  | 'exhaustion'      // 力竭：暗红侵蚀感（强度随等级变化）
  | 'poison'          // 中毒：毒液滴落气泡
  | 'stun'            // 震慑：眩晕星环旋转
  | 'dying';           // 濒死：血色心跳脉动（最强视觉优先级）

export interface StatusDef {
  id: StatusId;
  name: string;
  nameEn: string;
  category: StatusCategory;
  color: string; // 十六进制，用于光晕/标签配色
  cardEffect: CardEffectKey;
  description: string;
  hasLevels?: boolean; // 力竭专用：1~6级
  maxLevel?: number;
}

export const STATUS_LIBRARY: Record<StatusId, StatusDef> = {
  // ------- 增益 Buff -------
  bless: {
    id: 'bless', name: '祝福', nameEn: 'Bless', category: 'buff',
    color: '#fbbf24', cardEffect: 'buffGlow',
    description: '攻击检定和豁免检定 +1d4',
  },
  shield: {
    id: 'shield', name: '护盾', nameEn: 'Shield', category: 'buff',
    color: '#38bdf8', cardEffect: 'buffGlow',
    description: 'AC +5，直到下一回合开始',
  },
  rage: {
    id: 'rage', name: '狂暴', nameEn: 'Rage', category: 'buff',
    color: '#ef4444', cardEffect: 'rage',
    description: '近战伤害加成，受伤减半，无法施法',
  },
  haste: {
    id: 'haste', name: '加速', nameEn: 'Haste', category: 'buff',
    color: '#22d3ee', cardEffect: 'haste',
    description: '速度翻倍，AC+2，额外动作',
  },
  concentration: {
    id: 'concentration', name: '专注', nameEn: 'Concentration', category: 'buff',
    color: '#a855f7', cardEffect: 'buffGlow',
    description: '正在专注维持某个法术，受伤时需要豁免',
  },

  // ------- 减益 Debuff -------
  blinded: {
    id: 'blinded', name: '目盲', nameEn: 'Blinded', category: 'debuff',
    color: '#64748b', cardEffect: 'blind',
    description: '无法看见，攻击检定劣势，对方攻击具优势',
  },
  charmed: {
    id: 'charmed', name: '魅惑', nameEn: 'Charmed', category: 'debuff',
    color: '#ec4899', cardEffect: 'charm',
    description: '无法攻击施法者，施法者社交检定具优势',
  },
  deafened: {
    id: 'deafened', name: '耳聋', nameEn: 'Deafened', category: 'debuff',
    color: '#94a3b8', cardEffect: 'deafen',
    description: '无法听见，听觉相关检定自动失败',
  },
  frightened: {
    id: 'frightened', name: '恐慌', nameEn: 'Frightened', category: 'debuff',
    color: '#a78bfa', cardEffect: 'tremble',
    description: '无法自愿接近恐惧源，恐惧源可见时检定劣势',
  },
  grappled: {
    id: 'grappled', name: '擒抱', nameEn: 'Grappled', category: 'debuff',
    color: '#f59e0b', cardEffect: 'chain',
    description: '速度归零，被擒抱者移动会一同移动',
  },
  incapacitated: {
    id: 'incapacitated', name: '失能', nameEn: 'Incapacitated', category: 'debuff',
    color: '#78716c', cardEffect: 'faint',
    description: '无法采取行动或反应',
  },
  invisible: {
    id: 'invisible', name: '隐形', nameEn: 'Invisible', category: 'debuff',
    color: '#c4b5fd', cardEffect: 'invisible',
    description: '无法被视觉发现，攻击具优势，被攻击具劣势',
  },
  paralyzed: {
    id: 'paralyzed', name: '麻痹', nameEn: 'Paralyzed', category: 'debuff',
    color: '#60a5fa', cardEffect: 'paralyze',
    description: '失能，无法移动/说话，近战命中自动重击',
  },
  petrified: {
    id: 'petrified', name: '石化', nameEn: 'Petrified', category: 'debuff',
    color: '#a8a29e', cardEffect: 'petrify',
    description: '变为石质，失能，抗性所有伤害',
  },
  exhaustion: {
    id: 'exhaustion', name: '力竭', nameEn: 'Exhaustion', category: 'debuff',
    color: '#dc2626', cardEffect: 'exhaustion',
    description: '1~6级，每级叠加惩罚，6级直接死亡',
    hasLevels: true, maxLevel: 6,
  },
  poisoned: {
    id: 'poisoned', name: '中毒', nameEn: 'Poisoned', category: 'debuff',
    color: '#4ade80', cardEffect: 'poison',
    description: '攻击检定和属性检定具劣势',
  },
  prone: {
    id: 'prone', name: '倒地', nameEn: 'Prone', category: 'debuff',
    color: '#a3a3a3', cardEffect: 'faint',
    description: '只能爬行移动，近战攻击具优势，远程攻击具劣势',
  },
  restrained: {
    id: 'restrained', name: '束缚', nameEn: 'Restrained', category: 'debuff',
    color: '#b45309', cardEffect: 'chain',
    description: '速度归零，攻击检定劣势，被攻击具优势',
  },
  stunned: {
    id: 'stunned', name: '震慑', nameEn: 'Stunned', category: 'debuff',
    color: '#facc15', cardEffect: 'stun',
    description: '失能，无法移动，说话含糊不清',
  },
  unconscious: {
    id: 'unconscious', name: '昏迷', nameEn: 'Unconscious', category: 'debuff',
    color: '#57534e', cardEffect: 'faint',
    description: '失能，倒地，近战命中自动重击',
  },

  // ------- 特殊 Special -------
  dying: {
    id: 'dying', name: '濒死', nameEn: 'Dying', category: 'special',
    color: '#dc2626', cardEffect: 'dying',
    description: '每回合进行死亡豁免：3次成功稳定脱离，3次失败彻底死亡',
  },
};

// 弹窗里的展示顺序：增益 -> 减益 -> 特殊
export const STATUS_ORDER: StatusId[] = [
  'bless', 'shield', 'rage', 'haste', 'concentration',
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled',
  'incapacitated', 'invisible', 'paralyzed', 'petrified', 'exhaustion',
  'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
  'dying',
];

// 单个角色身上的一条状态实例（可能同时挂多条不同状态）
export interface CharacterStatusInstance {
  id: string;              // 实例唯一ID
  statusId: StatusId;      // 对应 STATUS_LIBRARY 的key
  duration: number | null; // 剩余回合数，null=无限，不随回合自动减少
  level?: number;           // 仅力竭使用：1~6
  successes?: number;       // 仅濒死使用：死亡豁免成功次数
  failures?: number;        // 仅濒死使用：死亡豁免失败次数
}

let idCounter = 0;
function genStatusId(): string {
  idCounter += 1;
  return `st_${Date.now()}_${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

// 添加一条新状态。非力竭/濒死的普通状态如果已存在同名状态，视为"刷新持续时间"而不是叠加多条。
export function addStatus(
  statuses: CharacterStatusInstance[],
  statusId: StatusId,
  duration: number | null,
): CharacterStatusInstance[] {
  const def = STATUS_LIBRARY[statusId];
  if (statusId === 'dying') {
    // 濒死不允许重复叠加：已经在濒死就不再新增一条
    if (statuses.some((s) => s.statusId === 'dying')) return statuses;
    return [...statuses, { id: genStatusId(), statusId, duration: null, successes: 0, failures: 0 }];
  }
  if (def.hasLevels) {
    // 力竭：已存在则不通过这个函数处理等级（走 setExhaustionLevel），这里只处理"从0级开始"
    if (statuses.some((s) => s.statusId === statusId)) return statuses;
    return [...statuses, { id: genStatusId(), statusId, duration: null, level: 1 }];
  }
  const idx = statuses.findIndex((s) => s.statusId === statusId);
  if (idx !== -1) {
    const next = [...statuses];
    next[idx] = { ...next[idx], duration };
    return next;
  }
  return [...statuses, { id: genStatusId(), statusId, duration }];
}

// 移除指定实例
export function removeStatusInstance(
  statuses: CharacterStatusInstance[],
  instanceId: string,
): CharacterStatusInstance[] {
  return statuses.filter((s) => s.id !== instanceId);
}

// 力竭等级调整：level<=0时移除该状态；level>=6视为死亡，交由调用方处理角色移除
export function setExhaustionLevel(
  statuses: CharacterStatusInstance[],
  level: number,
): { statuses: CharacterStatusInstance[]; died: boolean } {
  if (level >= 6) {
    return { statuses, died: true };
  }
  const idx = statuses.findIndex((s) => s.statusId === 'exhaustion');
  if (level <= 0) {
    if (idx === -1) return { statuses, died: false };
    return { statuses: statuses.filter((_, i) => i !== idx), died: false };
  }
  if (idx === -1) {
    return { statuses: [...statuses, { id: genStatusId(), statusId: 'exhaustion', duration: null, level }], died: false };
  }
  const next = [...statuses];
  next[idx] = { ...next[idx], level };
  return { statuses: next, died: false };
}

// 记录一次死亡豁免结果：3次成功则稳定（移除濒死状态），3次失败则彻底死亡（交由调用方移除角色）
export function recordDeathSave(
  statuses: CharacterStatusInstance[],
  success: boolean,
): { statuses: CharacterStatusInstance[]; stabilized: boolean; died: boolean } {
  const idx = statuses.findIndex((s) => s.statusId === 'dying');
  if (idx === -1) return { statuses, stabilized: false, died: false };

  const inst = { ...statuses[idx] };
  if (success) {
    inst.successes = (inst.successes || 0) + 1;
  } else {
    inst.failures = (inst.failures || 0) + 1;
  }

  if ((inst.failures || 0) >= 3) {
    return { statuses, stabilized: false, died: true };
  }
  if ((inst.successes || 0) >= 3) {
    return { statuses: statuses.filter((_, i) => i !== idx), stabilized: true, died: false };
  }

  const next = [...statuses];
  next[idx] = inst;
  return { statuses: next, stabilized: false, died: false };
}

// 回合开始时的状态结算：所有"有限回合数"的状态-1，减到0则移除；无限状态不受影响。
// 濒死/力竭不受回合数影响（它们各自有独立的豁免/等级机制），这里跳过它们。
export function tickStatusesForTurnStart(statuses: CharacterStatusInstance[]): CharacterStatusInstance[] {
  return statuses
    .map((s) => {
      if (s.duration === null || s.duration === undefined) return s;
      return { ...s, duration: s.duration - 1 };
    })
    .filter((s) => s.duration === null || s.duration === undefined || s.duration > 0);
}

// 卡片整体动效优先级：当需要"只挑一个"时使用（目前仅用于兜底场景），
// 徽章图标本身（每条状态一个小角标）始终全部展示，不受此优先级影响。
const CARD_EFFECT_PRIORITY: CardEffectKey[] = [
  'dying', 'petrify', 'paralyze', 'stun', 'exhaustion', 'faint',
  'poison', 'tremble', 'chain', 'blind', 'charm', 'invisible', 'deafen', 'rage', 'haste', 'buffGlow',
];

export interface ActiveCardEffect { effect: CardEffectKey; color: string; level?: number }

export function getPrimaryCardEffect(statuses: CharacterStatusInstance[]): ActiveCardEffect | null {
  const all = getAllCardEffects(statuses);
  if (all.length === 0) return null;
  for (const key of CARD_EFFECT_PRIORITY) {
    const found = all.find((a) => a.effect === key);
    if (found) return found;
  }
  return all[0];
}

// 返回角色身上所有"去重后"的卡片环绕动效（每种cardEffect只出现一次，即使有多条状态映射到同一种效果），
// 用于同时叠加渲染多个状态的环绕特效（每个buff/debuff都有自己专属的动效围绕卡片）。
export function getAllCardEffects(statuses: CharacterStatusInstance[]): ActiveCardEffect[] {
  if (!statuses || statuses.length === 0) return [];
  const seen = new Set<CardEffectKey>();
  const result: ActiveCardEffect[] = [];
  for (const s of statuses) {
    const def = STATUS_LIBRARY[s.statusId];
    if (seen.has(def.cardEffect)) continue;
    seen.add(def.cardEffect);
    result.push({ effect: def.cardEffect, color: def.color, level: s.level });
  }
  return result;
}
