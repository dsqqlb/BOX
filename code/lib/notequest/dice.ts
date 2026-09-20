/**
 * NoteQuest 掷骰工具。
 *
 * 引擎里所有掷骰都是**即时结算**的纯函数（RNG 可注入，方便测试与冒烟脚本），
 * 3D 骰子遮罩只是把这批结果按顺序回放给玩家看，不参与计算。
 */

export type Rng = () => number;

export interface DiceResult {
  notation: string;
  values: number[];
  modifier: number;
  total: number;
}

const NOTATION_RE = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

/** 解析 "2d6" / "d6" / "1d6+1" / "1d6-2"；解析不出来时按 1d6 处理。 */
export function parseNotation(notation: string): { count: number; sides: number; modifier: number } {
  const match = NOTATION_RE.exec(notation || '');
  if (!match) return { count: 1, sides: 6, modifier: 0 };
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3].replace(/\s+/g, '')) : 0;
  return {
    count: Number.isFinite(count) && count > 0 ? Math.min(count, 40) : 1,
    sides: Number.isFinite(sides) && sides > 1 ? Math.min(sides, 100) : 6,
    modifier: Number.isFinite(modifier) ? modifier : 0,
  };
}

export function rollDie(sides: number, rng: Rng = Math.random): number {
  return Math.floor(rng() * sides) + 1;
}

export function rollD6(rng: Rng = Math.random): number {
  return rollDie(6, rng);
}

export function rollDice(notation: string, rng: Rng = Math.random): DiceResult {
  const { count, sides, modifier } = parseNotation(notation);
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(rollDie(sides, rng));
  const total = values.reduce((sum, value) => sum + value, 0) + modifier;
  return { notation, values, modifier, total: Math.max(0, total) };
}

/** 2d6 取高：矮人找密道、半身人安静移动这类「掷2个骰子并取最高值」。 */
export function rollAdvantage(sides = 6, rng: Rng = Math.random): DiceResult {
  const a = rollDie(sides, rng);
  const b = rollDie(sides, rng);
  return {
    notation: `2d${sides}取高`,
    values: [a, b],
    modifier: 0,
    total: Math.max(a, b),
  };
}

/** 掷骰明细：给日志和 3D 面板上的「3 + 5 + 1 = 9」用。 */
export function diceDetail(values: number[], modifier: number): string {
  const parts = values.join(' + ');
  if (!modifier) return parts;
  return `${parts} ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}`;
}

/** 从表里按骰值取条目：条目可以写 roll，也可以写 rollMin/rollMax。 */
export function pickByRoll<T extends { roll?: number; rollMin?: number; rollMax?: number }>(list: T[], value: number): T | undefined {
  for (const entry of list) {
    if (entry.roll !== undefined && entry.roll === value) return entry;
    if (entry.rollMin !== undefined && entry.rollMax !== undefined && value >= entry.rollMin && value <= entry.rollMax) return entry;
  }
  return undefined;
}

export function randomPick<T>(list: T[], rng: Rng = Math.random): T | undefined {
  if (!list.length) return undefined;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** 掷一个随机咒语（种族/职业的「随机基本咒语」、魔法蓝宝石）。 */
export function rollSpellRoll(rng: Rng = Math.random): number {
  return rollD6(rng);
}