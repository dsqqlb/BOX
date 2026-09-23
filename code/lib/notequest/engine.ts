/**
 * NoteQuest 引擎：一局游戏的状态机。
 *
 * 设计要点（也是「便于扩展」的关键）：
 *   1. 纯函数：applyAction(state, action, rng) 立刻把一切算完，返回**新的**状态；
 *      RNG 可注入，所以规则能在 Node 里跑冒烟测试，不用开浏览器。
 *   2. 掷骰即时结算 + UI 回放：动作返回的 rolls 只是「刚才发生了什么」，
 *      3D 骰子遮罩按顺序播放它们，玩家点一下继续。状态不依赖动画。
 *   3. 数据驱动：所有表格、怪物、词缀都来自 resources/content/notequest/*.json；
 *      只有「新机制」才需要在 engine.ts 里加一个 kind / trigger / effect 分支。
 */

import {
  CORE, RULES, affixById, armorsFor, doorEntryFor, getDungeonType, lootEntryFor,
  secretPassagesFor, segmentsFor, spellById, weaponsFor,
} from './data';
import {
  diceDetail, pickByRoll, randomPick, rollD6, rollDice, rollAdvantage,
  type DiceResult, type Rng,
} from './dice';
import { DIR_ORDER, OPPOSITE, assignDoorDirs, footprintOf, placeBehindDoor, placeForNewDepth, relayoutNodes } from './map';
import type {
  CombatState, DoorDir, DoorState, DungeonNode, DungeonType, GrantDef, Hero, Item, LogEntry, Monster,
  RollRecord, RunState, SpawnDef, WeaponSpec,
} from './types';

export const MAX_LOG = 400;

/* ── 动作 ── */

export type GameAction =
  | { type: 'open-door'; nodeId: string; doorId: string }
  | { type: 'lockpick'; nodeId: string; doorId: string }
  | { type: 'smash'; nodeId: string; doorId: string }
  | { type: 'use-key'; nodeId: string; doorId: string }
  | { type: 'enter-node'; nodeId: string; sneak?: boolean }
  | { type: 'descend'; nodeId: string }
  | { type: 'search-secret-passage'; nodeId: string }
  | { type: 'open-chest'; nodeId: string }
  | { type: 'attack'; targetUid: string }
  | { type: 'cast-spell'; spellIndex: number; targetUid?: string }
  | { type: 'use-item'; itemUid: string; targetUid?: string }
  | { type: 'allocate-damage'; target: 'hp' | 'armor'; armorUid?: string }
  | { type: 'devour'; nodeId?: string }
  /** 搬走前一位冒险者遗体上的东西：不给 itemUid 就是「能拿的都拿」 */
  | { type: 'loot-grave'; nodeId?: string; itemUid?: string }
  | { type: 'to-town' }
  | { type: 'town-rest' }
  | { type: 'town-repair'; itemUid: string }
  | { type: 'town-buy-torch'; count?: number }
  | { type: 'town-sell'; itemUid: string; count?: number }
  | { type: 'town-reward-treasure'; count?: number }
  | { type: 'equip-armor'; itemUid: string }
  | { type: 'equip-weapon'; itemUid: string }
  | { type: 'return-dungeon' }
  | { type: 'rename'; title: string }
  | { type: 'abandon' };

export interface ActionOutcome {
  state: RunState;
  rolls: RollRecord[];
  /** 给 UI 的即时提示（规则不允许、资源不足等），不进日志 */
  notice?: string;
}

export interface CreateOptions {
  name?: string;
  raceId?: string;
  classId?: string;
  dungeonTypeId?: string;
  rng?: Rng;
  /** 人物池里的角色快照：给了就不掷种族/职业，直接用这份状态开局 */
  hero?: Hero;
  /** 人物池里的角色 id（存档记下来，配合战绩回写） */
  characterId?: string;
  /** 复用永久地牢：这张地图（含遗体与掉落）就是这一局的舞台 */
  dungeon?: { id: string; typeId: string; name: string; nodes: DungeonNode[] };
  /** 自定义建角时指定的开局咒语（不填就按种族/职业能力掷） */
  spellIds?: string[];
  /** 自定义建角时的开局火把与金币（不填就用规则默认值） */
  torches?: number;
  coins?: number;
}

/* ── 通用工具 ── */

let uidCounter = 0;

export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pushLog(state: RunState, kind: string, text: string): void {
  const entry: LogEntry = { id: uid('log'), at: Date.now(), kind, text };
  state.log.push(entry);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function pushRoll(rolls: RollRecord[], label: string, result: DiceResult): RollRecord {
  const record: RollRecord = {
    id: uid('roll'),
    notation: result.notation,
    label,
    total: result.total,
    detail: diceDetail(result.values, result.modifier),
    // 原始点数：3D 骰子遮罩用它强制摆面，保证「看到的骰子 = 引擎算出的结果」
    values: result.values.slice(),
  };
  rolls.push(record);
  return record;
}

/** 数值下限保护：伤害、火把、金币都不允许变成负数。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rollTotal(rolls: RollRecord[]): number {
  return rolls.reduce((sum, roll) => sum + roll.total, 0);
}

/* ── 角色能力钩子 ── */

export interface HeroHooks {
  advantageOn: string[];
  doubleSell: boolean;
  coinPerKill: boolean;
  undeadBonus: number;
  freeLockpick: boolean;
  torchOnDoorSmash: number | null;
  leaveWhenOutOfTorches: boolean;
  repairArmorWithTorch: boolean;
  healFullOnDevour: boolean;
  hornDamage: string | null;
}

/** 从种族/职业数据里算出这局生效的能力（改数据里的 kind 会立刻生效）。 */
export function heroHooks(hero: Hero): HeroHooks {
  const hooks: HeroHooks = {
    advantageOn: [], doubleSell: false, coinPerKill: false, undeadBonus: 0, freeLockpick: false,
    torchOnDoorSmash: null, leaveWhenOutOfTorches: false, repairArmorWithTorch: false,
    healFullOnDevour: false, hornDamage: null,
  };
  const race = CORE.races.find((item) => item.id === hero.raceId);
  const klass = CORE.classes.find((item) => item.id === hero.classId);
  for (const ability of [race?.ability, klass?.ability]) {
    if (!ability) continue;
    switch (ability.kind) {
      case 'rollAdvantageOn':
        if (ability.on) hooks.advantageOn.push(ability.on);
        break;
      case 'doubleSellPrice': hooks.doubleSell = true; break;
      case 'coinPerKill': hooks.coinPerKill = true; break;
      case 'damageBonusVsAffix': hooks.undeadBonus += ability.amount ?? 2; break;
      case 'openDoorFree': hooks.freeLockpick = true; break;
      case 'torchOnDoorSmash': hooks.torchOnDoorSmash = ability.roll ?? 6; break;
      case 'leaveWhenOutOfTorches': hooks.leaveWhenOutOfTorches = true; break;
      case 'repairArmorWithTorch': hooks.repairArmorWithTorch = true; break;
      case 'healFullOnDevour': hooks.healFullOnDevour = true; break;
      case 'freeAttack': hooks.hornDamage = ability.damage ?? '1d6'; break;
      default: break;
    }
  }
  return hooks;
}

export function hasAdvantage(hero: Hero, situation: string): boolean {
  return heroHooks(hero).advantageOn.includes(situation);
}

/** 双手武器需要两只空手：地牢里一只手要举火把，所以必须有替代光源，且不能断臂。 */
export function canUseTwoHanded(hero: Hero): boolean {
  return !hero.lostArm && hero.hasLight;
}

export function weaponUsable(hero: Hero, weapon: WeaponSpec): boolean {
  return !weapon.twoHanded || canUseTwoHanded(hero);
}

/** 装备（武器 + 护甲）带来的伤害加成。 */
export function heroDamageBonus(hero: Hero): number {
  const weaponBonus = hero.weapon.damageBonus ?? 0;
  const armorBonus = hero.armors.reduce((sum, armor) => sum + (armor.damageBonus ?? 0), 0);
  return weaponBonus + armorBonus;
}

export function armorHpTotal(hero: Hero): number {
  return hero.armors.reduce((sum, armor) => sum + Math.max(0, armor.hp ?? 0), 0);
}

/** 背包上限：10 件物品（财宝与钥匙不占格，见 core.json 的 rules.maxItems）。 */
export function bagCount(hero: Hero): number {
  return hero.items.filter((item) => item.kind !== 'treasure' && item.kind !== 'key').length;
}

export function canCarry(hero: Hero, extra = 1): boolean {
  return bagCount(hero) + extra <= RULES.maxItems;
}

/* ── 怪物构造 ── */

export function makeMonsters(spawn: SpawnDef, count: number, isBoss: boolean): Monster[] {
  const list: Monster[] = [];
  for (let index = 0; index < Math.max(1, count); index += 1) {
    list.push({
      uid: uid('mon'),
      name: spawn.name,
      en: spawn.en,
      hp: spawn.hp,
      maxHp: spawn.hp,
      damage: spawn.damage,
      affixes: spawn.affixes ? [...spawn.affixes] : [],
      bonusDamage: 0,
      killsOnHit: false,
      paralyzesOnHit: false,
      stunned: false,
      isBoss,
    });
  }
  return list;
}

export function monstersFromEntry(
  entry: { name?: string; en?: string; hp?: number; damage?: number; count?: number; countDice?: string; affixes?: string[] },
  fallbackName: string,
  rng: Rng,
  isBoss: boolean,
): Monster[] {
  const count = entry.countDice ? rollDice(entry.countDice, rng).total : Math.max(1, entry.count ?? 1);
  return makeMonsters({
    name: entry.name || fallbackName,
    en: entry.en,
    hp: Math.max(1, entry.hp ?? 1),
    damage: Math.max(0, entry.damage ?? 0),
    affixes: entry.affixes,
  }, count, isBoss);
}

export function aliveMonsters(node: DungeonNode): Monster[] {
  return node.monsters.filter((monster) => monster.hp > 0);
}

/* ── 物品工厂 ── */

const SLOT_NAMES: Record<string, string> = {
  ring: '指环',
  arm: '臂甲',
  boots: '靴子',
  shoulder: '肩甲',
  helmet: '头盔',
  chest: '胸甲',
};

export function slotName(slot: string): string {
  return SLOT_NAMES[slot] ?? slot;
}

function armorFromTable(entry: { slot: string; name: string; hp: number }, extraHp = 0, magic = false, text = ''): Item {
  const hp = Math.max(0, entry.hp + extraHp);
  return {
    uid: uid('item'),
    name: entry.name,
    kind: 'armor',
    text: text || `${slotName(entry.slot)}；${hp} HP`,
    value: RULES.itemSellPrice,
    magic,
    slot: entry.slot as Item['slot'],
    hp,
    maxHp: hp,
    use: 'none',
  };
}

function weaponItem(base: WeaponSpec, extra: { magic?: boolean; damageBonus?: number; note?: string } = {}): Item {
  return {
    uid: uid('item'),
    name: base.name,
    kind: 'weapon',
    text: extra.note || `${base.damage} 伤害${base.twoHanded ? '；双手' : ''}`,
    value: RULES.itemSellPrice,
    magic: Boolean(extra.magic),
    damage: base.damage,
    twoHanded: base.twoHanded,
    damageBonus: extra.damageBonus ?? 0,
    use: 'none',
  };
}

/** 掷武器表得一件武器（牢狱那种 rollMin/rollMax 的条目也认）。 */
export function rollWeaponItem(type: DungeonType, rng: Rng): { item: Item; roll: number } {
  const roll = rollD6(rng);
  const entry = pickByRoll(weaponsFor(type), roll) ?? weaponsFor(type)[0];
  return { item: weaponItem({ name: entry.name, damage: entry.damage, twoHanded: entry.twoHanded }), roll };
}

/** 掷护甲表得一件护甲。 */
export function rollArmorItem(type: DungeonType, rng: Rng, extraHp = 0, magic = false, text = ''): { item: Item; roll: number } {
  const roll = rollD6(rng);
  const entry = pickByRoll(armorsFor(type), roll) ?? armorsFor(type)[0];
  return { item: armorFromTable(entry, extraHp, magic, text), roll };
}

/**
 * 奖励表 → 物品。财宝栏第 5/6 格会继续掷奇物/魔法物品栏（原书就是这么写的）；
 * 牢狱的财宝第 4 格会继续掷武器表。
 */
export function rewardToItems(
  type: DungeonType,
  entry: { kind?: string; name?: string; text: string; value?: number; valueDice?: string; valueMultiplier?: number; hpBonus?: number; damageBonus?: number },
  rng: Rng,
  rolls: RollRecord[],
): Item[] {
  const kind = entry.kind ?? 'oddity';
  if (kind === 'roll-oddity' || kind === 'roll-magic') {
    const roll = rollD6(rng);
    pushRoll(rolls, kind === 'roll-oddity' ? '奇物 1d6' : '魔法物品 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    const picked = pickByRoll(kind === 'roll-oddity' ? type.rewards.oddity : type.rewards.magic, roll);
    return picked ? rewardToItems(type, picked, rng, rolls) : [];
  }
  if (kind === 'roll-weapon') {
    const { item, roll } = rollWeaponItem(type, rng);
    pushRoll(rolls, '武器 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    return [item];
  }
  if (kind === 'sellable') {
    let value = entry.value ?? RULES.itemSellPrice;
    let text = entry.text;
    if (entry.valueDice) {
      const rolled = rollDice(entry.valueDice, rng);
      pushRoll(rolls, `价值 ${entry.valueDice}`, rolled);
      value = rolled.total * (entry.valueMultiplier ?? 1);
      text = `${entry.text}（本次价值 ${value} 金币）`;
    }
    return [{ uid: uid('item'), name: entry.name ?? '财宝', kind: 'treasure', text, value, magic: false, use: 'none' }];
  }
  if (kind === 'potion-heal' || kind === 'potion-spells') {
    return [{
      uid: uid('item'), name: entry.name ?? '药水', kind: 'potion', text: entry.text,
      value: RULES.itemSellPrice, magic: true, use: kind === 'potion-heal' ? 'heal' : 'spells',
    }];
  }
  if (kind === 'scroll') {
    return [{
      uid: uid('item'), name: entry.name ?? '魔法卷轴', kind: 'scroll', text: entry.text,
      value: RULES.itemSellPrice, magic: true, use: 'scroll',
    }];
  }
  if (kind === 'armor') {
    const { item, roll } = rollArmorItem(type, rng, entry.hpBonus ?? 0, true, entry.text);
    pushRoll(rolls, '护甲 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    item.name = (entry.name ?? item.name).replace('【护甲】', item.name);
    return [item];
  }
  if (kind === 'weapon') {
    const { item, roll } = rollWeaponItem(type, rng);
    pushRoll(rolls, '武器基底 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    item.name = (entry.name ?? item.name).replace('【武器】', item.name);
    item.magic = true;
    item.text = entry.text;
    item.damageBonus = (item.damageBonus ?? 0) + (entry.damageBonus ?? 0);
    return [item];
  }
  return [{
    uid: uid('item'), name: entry.name ?? '奇物', kind: 'oddity', text: entry.text,
    value: RULES.itemSellPrice, magic: false, use: 'none',
  }];
}

/** 一件财宝 → 掷奖励表（1d6 财宝栏，可能连锁到奇物/魔法物品栏）。 */
export function treasureToItems(type: DungeonType, rng: Rng, rolls: RollRecord[]): Item[] {
  const roll = rollD6(rng);
  pushRoll(rolls, '奖励 1d6（财宝）', { notation: '1d6', values: [roll], modifier: 0, total: roll });
  const entry = pickByRoll(type.rewards.treasure, roll);
  if (!entry) return [];
  return rewardToItems(type, entry, rng, rolls);
}

/* ── 死亡与结局 ── */

/**
 * 死亡结算：角色与身上的东西留在原地，变成**永久的遗体**。
 * 后来进入这座地牢的角色可以搬走遗体上的物品与金币（原书没有这条，属于本作的家规）。
 */
function depositHeroGrave(state: RunState, cause: string): void {
  if (state.town.inTown) return;
  const hero = state.hero;
  const node = state.dungeon.nodes.find((item) => item.id === state.dungeon.currentId) ?? state.dungeon.nodes[0];
  if (!node) return;
  const items = clone(hero.items);
  node.heroGrave = {
    name: hero.name,
    raceName: hero.raceName,
    className: hero.className,
    cause,
    diedAt: Date.now(),
    items,
    armors: clone(hero.armors),
    weapon: clone(hero.weapon),
    coins: hero.coins,
    treasure: hero.treasure,
    keys: hero.keys,
    looted: false,
  };
  const carried = items.length + hero.armors.length;
  hero.items = [];
  hero.armors = [];
  hero.coins = 0;
  hero.treasure = 0;
  hero.keys = 0;
  pushLog(state, 'death', `遗体留在「${state.dungeon.name}」第 ${node.depth} 层：${carried} 件装备与 ${node.heroGrave.coins} 金币还留在原地，别的冒险者可以来取。`);
}

function finishRun(state: RunState, kind: 'death' | 'cleared', text: string, logText: string): void {
  state.status = kind === 'cleared' ? 'cleared' : 'dead';
  state.combat = null;
  state.outcome = { kind, text, at: Date.now() };
  if (kind === 'death') depositHeroGrave(state, text);
  pushLog(state, kind === 'cleared' ? 'loot' : 'death', logText);
}

function checkDeath(state: RunState, cause: string): boolean {
  if (state.hero.hp > 0) return false;
  const hero = state.hero;
  finishRun(state, 'death', cause, `☠️ ${hero.name} 死了：${cause}（第 ${state.dungeon.depth} 层，${state.dungeon.name}）`);
  return true;
}

/* ── 起始片段 ── */

function makeDoor(id: string): DoorState {
  return { id, status: 'closed', to: null };
}

export function makeEntranceNode(type: DungeonType, depth = 1): DungeonNode {
  const doorCount = Math.max(1, (type as DungeonType & { startDoors?: number }).startDoors ?? 1);
  const size = { w: 2, h: 2 };
  const node: DungeonNode = {
    id: uid('node'),
    kind: 'entrance',
    depth,
    doors: Array.from({ length: doorCount }, (_, index) => makeDoor(`door-${index + 1}`)),
    monsters: [],
    trapsActive: false,
    cleared: true,
    visited: true,
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
  };
  // 门一生成就定好它在哪面墙上（一面墙最多一个），地图据此把门画在墙上
  assignDoorDirs(node);
  return node;
}

/* ── 创建一局（掷种族、职业、咒语、地牢名） ── */

function abilitySpells(ability: { kind: string; spell?: string; count?: number } | undefined, rng: Rng, rolls: RollRecord[]): { spellId: string; name: string; effect: string; spent: boolean }[] {
  if (!ability) return [];
  const list: { spellId: string; name: string; effect: string; spent: boolean }[] = [];
  if (ability.kind === 'grantSpells' && ability.spell) {
    const spell = spellById(ability.spell);
    for (let index = 0; index < (ability.count ?? 1); index += 1) {
      if (spell) list.push({ spellId: spell.id, name: spell.name, effect: spell.effect, spent: false });
    }
    return list;
  }
  if (ability.kind === 'grantRandomSpells') {
    for (let index = 0; index < (ability.count ?? 1); index += 1) {
      const roll = rollD6(rng);
      pushRoll(rolls, '咒语 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
      const spell = pickByRoll(CORE.spells, roll);
      if (spell) list.push({ spellId: spell.id, name: spell.name, effect: spell.effect, spent: false });
    }
  }
  return list;
}

/**
 * 组装一个角色（「新建人物」界面与「新的一局」共用）：
 *   - 没给 raceId / classId 就掷 2d6 决定（掷骰模式）；
 *   - 没给 spellIds 就按种族/职业能力决定（可能再掷几次骰子）；
 *   - 全给齐就是「自定义」建角，一次骰子都不掷。
 */
export function buildHero(options: CreateOptions = {}): { hero: Hero; rolls: RollRecord[] } {
  const rng = options.rng ?? Math.random;
  const rolls: RollRecord[] = [];

  const raceRoll = options.raceId ? null : pushRoll(rolls, '种族 2d6', rollDice('2d6', rng));
  const classRoll = options.classId ? null : pushRoll(rolls, '职业 2d6', rollDice('2d6', rng));
  const race = (options.raceId ? CORE.races.find((item) => item.id === options.raceId) : pickByRoll(CORE.races, raceRoll?.total ?? 0)) ?? CORE.races[0];
  const klass = (options.classId ? CORE.classes.find((item) => item.id === options.classId) : pickByRoll(CORE.classes, classRoll?.total ?? 0)) ?? CORE.classes[0];

  const baseHp = Math.max(1, race.hp + klass.hpBonus);
  const chosen = (options.spellIds ?? [])
    .map((id) => spellById(id))
    .filter((spell): spell is NonNullable<typeof spell> => Boolean(spell))
    .map((spell) => ({ spellId: spell.id, name: spell.name, effect: spell.effect, spent: false }));
  const hero: Hero = {
    name: options.name?.trim() || `${race.name}${klass.name}`,
    raceId: race.id,
    raceName: race.name,
    classId: klass.id,
    className: klass.name,
    hp: baseHp,
    maxHp: baseHp,
    baseHp,
    abilityNotes: [race.ability.text, klass.ability.text],
    weapon: { ...klass.weapon },
    spareWeapons: [],
    armors: [],
    spells: chosen.length ? chosen : [...abilitySpells(race.ability, rng, rolls), ...abilitySpells(klass.ability, rng, rolls)],
    torches: clamp(options.torches ?? RULES.startingTorches, 0, RULES.maxTorches),
    coins: Math.max(0, options.coins ?? RULES.startingCoins),
    treasure: 0,
    keys: 0,
    items: [],
    lostArm: false,
    hasLight: false,
    stunned: 0,
    devoured: false,
    trapShield: 0,
  };
  return { hero, rolls };
}

export function createRun(options: CreateOptions = {}): ActionOutcome {
  const rng = options.rng ?? Math.random;
  const rolls: RollRecord[] = [];

  // 1. 角色：人物池带进来的快照直接用；否则现场掷骰或按指定的种族/职业组装
  let hero: Hero;
  if (options.hero) {
    hero = clone(options.hero);
  } else {
    const draft = buildHero(options);
    hero = draft.hero;
    rolls.push(...draft.rolls);
  }
  const race = CORE.races.find((item) => item.id === hero.raceId) ?? CORE.races[0];
  const klass = CORE.classes.find((item) => item.id === hero.classId) ?? CORE.classes[0];
  const baseHp = hero.baseHp;
  const fromPool = Boolean(options.hero);

  // 2. 地牢：账号里已有这座永久地牢就用它的地图（含遗体与掉落），否则掷 3d6 拼名建一座新的
  let type: DungeonType;
  let dungeonName: string;
  let nodes: DungeonNode[];
  let currentId: string;
  let depth: number;
  if (options.dungeon && options.dungeon.nodes.length) {
    type = getDungeonType(options.dungeon.typeId);
    dungeonName = options.dungeon.name;
    nodes = clone(options.dungeon.nodes);
    const entrance = nodes.find((node) => node.kind === 'entrance') ?? nodes[0];
    currentId = entrance.id;
    depth = entrance.depth ?? 1;
  } else {
    const prefixRoll = pushRoll(rolls, '地牢名·第一部分 1d6', rollDice('1d6', rng));
    const middleRoll = pushRoll(rolls, '地牢名·第二部分 1d6', rollDice('1d6', rng));
    const suffixRoll = pushRoll(rolls, '地牢名·第三部分 1d6', rollDice('1d6', rng));
    const prefix = pickByRoll(CORE.dungeonName.prefix, prefixRoll.total)?.text ?? '';
    const middle = pickByRoll(CORE.dungeonName.middle, middleRoll.total)?.text ?? '';
    const suffixEntry = pickByRoll(CORE.dungeonName.suffix, suffixRoll.total) ?? CORE.dungeonName.suffix[0];
    const forcedType = options.dungeonTypeId ? getDungeonType(options.dungeonTypeId) : null;
    type = forcedType ?? getDungeonType(suffixEntry.typeId);
    const suffix = forcedType
      ? (CORE.dungeonName.suffix.find((item) => item.typeId === forcedType.id)?.text ?? suffixEntry.text)
      : suffixEntry.text;
    dungeonName = `${prefix}${middle}${suffix}`;
    const entrance = makeEntranceNode(type, 1);
    nodes = [entrance];
    currentId = entrance.id;
    depth = 1;
  }

  const state: RunState = {
    version: 2,
    id: uid('run'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
    title: `${hero.name} · ${dungeonName}`,
    characterId: options.characterId,
    dungeonId: options.dungeon?.id,
    dungeon: {
      typeId: type.id,
      name: dungeonName,
      intro: type.intro,
      depth,
      entered: false,
      nodes,
      currentId,
      entries: 0,
    },
    hero,
    combat: null,
    town: { inTown: true, needsMonsterReroll: false },
    log: [],
    stats: { kills: 0, treasures: 0, coinsFound: 0, deepestDepth: depth, turns: 0, trapsTriggered: 0, chestsOpened: 0 },
    outcome: null,
  };

  pushLog(state, 'info', `你在酒馆听说了「${dungeonName}」的传闻。`);
  pushLog(state, 'info', `角色：${hero.name}（${race.name}·${klass.name}，${baseHp} HP，武器：${hero.weapon.name} ${hero.weapon.damage}）`);
  if (hero.spells.length) pushLog(state, 'info', `${fromPool ? '学会的咒语' : '起始咒语'}：${hero.spells.map((spell) => spell.name).join('、')}（各 1 次，回城镇休息可恢复）`);
  pushLog(state, 'info', fromPool
    ? `你带着「${hero.name}」出发：${hero.torches} 个火把、${hero.coins} 金币${options.dungeon ? `，回到「${dungeonName}」那张已经画过的地图上。` : '。'}`
    : `带上 ${hero.torches} 个火把和 ${hero.coins} 金币，你在城镇里准备出发。`);
  pushLog(state, 'town', '先在城镇准备：点「出发」进入地牢（火把上限 10 个，一个 1 金币）。');
  return { state, rolls };
}

/* ── 地牢：定位、进入与片段生成 ── */

const FROM_LABEL: Record<string, string> = { stairs: '楼梯', corridor: '走廊', room: '房间' };

export function currentNode(state: RunState): DungeonNode {
  return state.dungeon.nodes.find((node) => node.id === state.dungeon.currentId) ?? state.dungeon.nodes[0];
}

export function nodeById(state: RunState, id: string): DungeonNode | undefined {
  return state.dungeon.nodes.find((node) => node.id === id);
}

export function dungeonType(state: RunState): DungeonType {
  return getDungeonType(state.dungeon.typeId);
}

export function hasLivingMonsters(node: DungeonNode): boolean {
  return aliveMonsters(node).length > 0;
}

/** 当前片段是否会挡住行动：有活怪且没有被安静移动绕过。 */
export function nodeBlocksActions(node: DungeonNode): boolean {
  return hasLivingMonsters(node) && !node.sneaked;
}

function segmentColumn(node: DungeonNode): 'stairs' | 'corridor' | 'room' {
  if (node.kind === 'stairs' || node.kind === 'entrance') return 'stairs';
  if (node.kind === 'corridor') return 'corridor';
  return 'room';
}

/** 门后生成一个新片段（不自动移动过去，让玩家自己决定要不要进）。 */
function spawnBehindDoor(state: RunState, from: DungeonNode, door: DoorState, rng: Rng, rolls: RollRecord[]): DungeonNode | null {
  const type = dungeonType(state);
  const table = segmentsFor(type);
  const column = segmentColumn(from);
  const roll = rollD6(rng);
  pushRoll(rolls, `地牢片段 1d6（从${FROM_LABEL[column]}开门）`, { notation: '1d6', values: [roll], modifier: 0, total: roll });
  const entry = pickByRoll(table[column], roll);
  if (!entry) return null;
  pushLog(state, 'table', entry.text);

  // 门朝向：一个片段上的第 n 扇门优先开向右→下→左→上，实际能不能贴上由 map.ts 判断；
  // 已经占用那些墙的门（不管开没开）都让位：一面墙最多一个门
  const usedDirs = from.doors
    .filter((item) => item.id !== door.id && item.dir)
    .map((item) => item.dir) as DoorDir[];
  const doorIndex = Math.max(0, from.doors.findIndex((item) => item.id === door.id));
  const preferDir = door.dir ?? DIR_ORDER[doorIndex % DIR_ORDER.length];
  const size = footprintOf({ kind: entry.kind, size: entry.size });
  // 先只用「还没被别的门占住的墙」找位置（一面墙最多一个门）；实在不行才退让，并把没连通的门挪开
  const spot = placeBehindDoor(from, size, state.dungeon.nodes, preferDir, usedDirs, true)
    ?? placeBehindDoor(from, size, state.dungeon.nodes, preferDir, usedDirs)
    ?? { x: from.x, y: from.y, dir: preferDir, detached: true };
  const node: DungeonNode = {
    id: uid('node'),
    kind: entry.kind,
    size: entry.size,
    depth: state.dungeon.depth,
    doors: Array.from({ length: Math.max(0, entry.doors ?? 0) }, () => makeDoor(uid('door'))),
    monsters: [],
    trapsActive: false,
    cleared: entry.kind !== 'room',
    visited: false,
    x: spot.x,
    y: spot.y,
    w: size.w,
    h: size.h,
  };
  // 新房间在共享的那面墙上也有一扇自己的门（和父房间的门重叠），所以两边都能画门、都能走回去
  node.doors.unshift({ id: uid('door'), status: 'open', to: from.id, dir: OPPOSITE[spot.dir] });
  assignDoorDirs(node);
  state.dungeon.nodes.push(node);
  door.to = node.id;
  door.status = 'open';
  door.dir = spot.dir;
  // 万一这面墙本来有别的门：把「还没连通」的那些挪到空墙上去，保证一面墙最多一个门
  assignDoorDirs(from);
  return node;
}

/** 进入（或重新进入）一段地牢：房间内容、怪物表、安静移动、返回重掷都在这里。
 *  mode：walk = 安静开门走进去（玩家先手）；sneak = 花 1 个火把安静移动；force = 破坏房门/被惊动（怪物先手）。 */
function enterNode(state: RunState, node: DungeonNode, rng: Rng, rolls: RollRecord[], mode: 'walk' | 'sneak' | 'force'): void {
  const type = dungeonType(state);
  const hero = state.hero;
  const firstVisit = !node.visited;
  node.visited = true;
  state.dungeon.currentId = node.id;
  state.stats.turns += 1;

  if (node.kind === 'room' && firstVisit) {
    const roll = rollDice('2d6', rng);
    pushRoll(rolls, '房间内容 2d6', roll);
    const entry = pickByRoll(type.roomContent, roll.total);
    node.contentRoll = roll.total;
    node.contentText = entry?.text ?? '空房间。';
    pushLog(state, 'table', `房间内容：${node.contentText}`);
    if (entry?.hasSecretPassage) {
      node.hasSecretPassage = true;
      pushLog(state, 'info', '这个房间可能藏着密道（可以消耗 1 个火把寻找）。');
    }
    if (entry?.chest) node.chest = { opened: false, big: entry.bigChest };
    if (entry?.grants?.length) node.pendingGrants = clone(entry.grants);
    // 房间里的即时奖励（金币/财宝/魔法物品）当场结算，不需要再多点一次
    applyGrants(state, node, rng, rolls);
  }

  // 怪物表：首次进入的房间要掷；从城镇返回后重进空房间也要再掷一次
  const needsRoll = node.kind === 'room' && (firstVisit || (state.town.needsMonsterReroll && !hasLivingMonsters(node)));
  if (needsRoll) {
    const roll = rollDice('2d6', rng);
    pushRoll(rolls, '怪物 2d6', roll);
    const entry = pickByRoll(type.monsters, roll.total);
    if (entry && !entry.none) {
      node.monsters = monstersFromEntry(entry, '怪物', rng, false);
      node.cleared = false;
      node.sneaked = false;
      pushLog(state, 'combat', `房间里出现了 ${node.monsters.length} 个${node.monsters[0].name}！`);
    } else {
      node.monsters = [];
      node.cleared = true;
      pushLog(state, 'info', entry?.text ?? '这个房间里没有怪物。');
    }
  }

  // 从城镇返回后，已有怪物的房间要恢复满 HP（原书规则）
  if (state.town.needsMonsterReroll) {
    for (const monster of node.monsters) monster.hp = monster.maxHp;
  }

  if (hasLivingMonsters(node)) {
    if (mode === 'walk') {
      // 没破坏门、没触发陷阱：你发动先手攻击
      startCombat(state, node, 'player');
      return;
    }
    if (mode === 'force') {
      pushLog(state, 'combat', '房门是被破坏/硬闯进来的：怪物先手攻击。');
      startCombat(state, node, 'monsters');
      return;
    }
    // 安静移动：每个怪物掷 1d6，掷出 1 就被发现（半身人这类能力改成 2d6 取高）
    const advantage = hasAdvantage(hero, 'sneak');
    let spotted = false;
    for (const monster of node.monsters) {
      const result = advantage ? rollAdvantage(6, rng) : rollDice('1d6', rng);
      pushRoll(rolls, `${monster.name} 察觉判定`, result);
      if (result.total === 1) {
        spotted = true;
        pushLog(state, 'combat', `${monster.name} 发现了你！`);
        break;
      }
    }
    if (spotted) {
      startCombat(state, node, 'monsters');
      return;
    }
    node.sneaked = true;
    pushLog(state, 'info', '怪物没有察觉你：你可以穿过这个房间、拾取宝物并继续开门。');
  }

  if (node.kind === 'stairs' || node.kind === 'entrance') {
    pushLog(state, 'info', node.kind === 'stairs' ? '你走进一段向下的楼梯。' : '你回到地牢入口。');
  }
}

/* ── 陷阱、黑暗、房间奖励 ── */

function applyTrap(state: RunState, node: DungeonNode, rng: Rng, rolls: RollRecord[]): void {
  const type = dungeonType(state);
  const hero = state.hero;
  if (hero.trapShield > 0) {
    hero.trapShield -= 1;
    node.trapsActive = false;
    pushLog(state, 'info', '幸运药水的效果生效：这个陷阱被无视了。');
    return;
  }
  const roll = rollD6(rng);
  pushRoll(rolls, '陷阱表 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
  const entry = pickByRoll(type.traps, roll);
  node.trapsActive = false;
  node.trapsRoll = roll;
  state.stats.trapsTriggered += 1;
  if (!entry) return;
  pushLog(state, 'warn', `陷阱：${entry.text}`);

  if (entry.kind === 'blade') {
    const outcomeRoll = rollD6(rng);
    pushRoll(rolls, '摆刃 1d6', { notation: '1d6', values: [outcomeRoll], modifier: 0, total: outcomeRoll });
    const outcome = entry.outcomes?.find((item) => item.value === outcomeRoll);
    if (outcome?.effect === 'death') {
      hero.hp = 0;
      checkDeath(state, `${type.name}的摆刃陷阱`);
      return;
    }
    if (outcome?.effect === 'lose-arm') {
      hero.lostArm = true;
      pushLog(state, 'warn', '你的一条手臂被切断了：双手武器再也用不了。');
      return;
    }
    pushLog(state, 'info', '摆刃擦着你的身边落下，你毫发无伤。');
    return;
  }
  if (entry.kind === 'damage') {
    hero.hp -= Math.max(0, entry.damage ?? 0);
    pushLog(state, 'combat', `你受到 ${entry.damage ?? 0} 点伤害（HP ${Math.max(0, hero.hp)}）。`);
    checkDeath(state, `${type.name}的陷阱`);
    return;
  }
  if (entry.kind === 'torch') {
    hero.torches = Math.max(0, hero.torches - Math.max(0, entry.torchCost ?? 1));
    pushLog(state, 'info', `火把剩下 ${hero.torches} 个。`);
    resolveDarkness(state);
    return;
  }
  if (entry.kind === 'monsters' && entry.spawn) {
    node.monsters = monstersFromEntry(entry.spawn, '怪物', rng, false);
    node.cleared = false;
    node.sneaked = false;
    pushLog(state, 'combat', `${node.monsters.length} 个${node.monsters[0].name}出现并攻击你！`);
    startCombat(state, node, 'monsters');
  }
}

/** 火把耗尽：黑暗吞噬角色（矿工可以主动离开，见 leaveWhenOutOfTorches）。 */
function resolveDarkness(state: RunState): void {
  const hero = state.hero;
  if (hero.hasLight || hero.torches > 0) return;
  if (heroHooks(hero).leaveWhenOutOfTorches) {
    pushLog(state, 'warn', '火把用光了：矿工的本能让你摸黑离开了地牢。');
    hero.torches = 1;
    state.town.inTown = true;
    state.town.needsMonsterReroll = true;
    return;
  }
  hero.hp = 0;
  checkDeath(state, '在黑暗中耗尽火把');
}

/** 把物品放进背包（背包 10 格上限；财宝与钥匙不占格）。 */
export function addItem(state: RunState, item: Item): boolean {
  const hero = state.hero;
  if (item.kind === 'treasure' || item.kind === 'key') {
    hero.items.push(item);
    return true;
  }
  if (!canCarry(hero)) {
    pushLog(state, 'warn', `${item.name} 没地方放了：背包最多 ${RULES.maxItems} 件物品。`);
    return false;
  }
  hero.items.push(item);
  return true;
}

/** 房间内容表里的即时奖励（金币、财宝、魔法物品、卷轴）。 */
function applyGrants(state: RunState, node: DungeonNode, rng: Rng, rolls: RollRecord[]): void {
  const hero = state.hero;
  const grants = node.pendingGrants ?? [];
  if (!grants.length) return;
  node.pendingGrants = [];
  for (const grant of grants) {
    if (grant.kind === 'coin') {
      const result = grant.dice
        ? (() => {
          const rolled = rollDice(grant.dice as string, rng);
          pushRoll(rolls, `金币 ${grant.dice}`, rolled);
          return rolled.total;
        })()
        : (grant.amount ?? 1);
      const coins = result * (grant.perUnit ?? 1);
      hero.coins += coins;
      state.stats.coinsFound += coins;
      pushLog(state, 'loot', `获得 ${coins} 金币（共 ${hero.coins}）。`);
      continue;
    }
    if (grant.kind === 'treasure') {
      const count = grant.dice
        ? (() => {
          const rolled = rollDice(grant.dice as string, rng);
          pushRoll(rolls, `财宝 ${grant.dice}`, rolled);
          return rolled.total;
        })()
        : (grant.amount ?? 1);
      hero.treasure += count;
      state.stats.treasures += count;
      pushLog(state, 'loot', `获得 ${count} 个财宝（回城镇可以掷奖励表换成物品）。`);
      continue;
    }
    if (grant.kind === 'magic-item') {
      const count = grant.dice
        ? (() => {
          const rolled = rollDice(grant.dice as string, rng);
          pushRoll(rolls, `魔法物品 ${grant.dice}`, rolled);
          return rolled.total;
        })()
        : (grant.amount ?? 1);
      const items = rollMagicItems(state, count, rng, rolls);
      pushLog(state, 'loot', `获得 ${items.length} 件魔法物品：${items.map((item) => item.name).join('、')}。`);
      continue;
    }
    if (grant.kind === 'scroll') {
      const count = grant.amount ?? 1;
      const items = rollMagicItems(state, count, rng, rolls, 'scroll');
      pushLog(state, 'loot', `获得 ${items.map((item) => item.name).join('、')}。`);
    }
  }
}

/** 军械库那种「获得 2d6 个魔法物品」：直接掷魔法物品栏。 */
function rollMagicItems(state: RunState, count: number, rng: Rng, rolls: RollRecord[], forceKind?: string): Item[] {
  const type = dungeonType(state);
  const created: Item[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = rollD6(rng);
    pushRoll(rolls, '魔法物品 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    const entry = pickByRoll(type.rewards.magic, roll);
    if (!entry) continue;
    const items = rewardToItems(type, forceKind ? { ...entry, kind: forceKind } : entry, rng, rolls);
    for (const item of items) {
      addItem(state, item);
      created.push(item);
    }
  }
  return created;
}

/* ── 地牢动作 ── */

function requireReady(state: RunState, node: DungeonNode): string | undefined {
  if (state.status !== 'active') return '这一局已经结束了。';
  if (state.town.inTown) return '先回到地牢里再说。';
  if (state.combat) return '战斗还没结束。';
  if (nodeBlocksActions(node)) return '这个片段里还有怪物：先击败它们，或者消耗 1 个火把安静移动绕过。';
  return undefined;
}

function spendTorches(state: RunState, count: number, label: string): void {
  const hero = state.hero;
  hero.torches = Math.max(0, hero.torches - count);
  if (count > 0) pushLog(state, 'info', `${label}（火把剩 ${hero.torches} 个）。`);
  resolveDarkness(state);
}

function openDoor(state: RunState, node: DungeonNode, doorId: string, rng: Rng, rolls: RollRecord[]): string | undefined {
  const door = node.doors.find((item) => item.id === doorId);
  if (!door) return '这扇门不存在。';
  if (door.status === 'open' || door.status === 'broken') return '这扇门已经打开了。';
  if (door.status === 'locked') return '门是锁着的：开锁、破坏房门，或者用一把钥匙。';
  const roll = rollD6(rng);
  pushRoll(rolls, '开门 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
  const entry = doorEntryFor(roll);
  door.lastRoll = roll;
  pushLog(state, 'table', `开门：${entry.text}`);
  if (entry.kind === 'trap') {
    applyTrap(state, node, rng, rolls);
    return undefined;
  }
  if (entry.kind === 'locked') {
    door.status = 'locked';
    return undefined;
  }
  spawnBehindDoor(state, node, door, rng, rolls);
  return undefined;
}

function resolveLockedDoor(state: RunState, node: DungeonNode, doorId: string, action: 'lockpick' | 'smash' | 'use-key', rng: Rng, rolls: RollRecord[]): string | undefined {
  const door = node.doors.find((item) => item.id === doorId);
  if (!door) return '这扇门不存在。';
  if (door.status === 'open' || door.status === 'broken') return '这扇门已经打开了。';
  const hooks = heroHooks(state.hero);

  if (action === 'use-key') {
    if (state.hero.keys <= 0) return '你没有钥匙。';
    state.hero.keys -= 1;
    pushLog(state, 'info', '钥匙转动，门开了。');
    spawnBehindDoor(state, node, door, rng, rolls);
    return undefined;
  }
  if (action === 'lockpick') {
    if (door.status !== 'locked') return '这扇门没有锁，直接推开就行。';
    const cost = hooks.freeLockpick ? 0 : RULES.torchPerAction;
    if (cost > 0 && state.hero.torches <= 0) return '开锁需要 1 个火把。';
    spendTorches(state, cost, hooks.freeLockpick ? '锁匠的手艺：开锁不消耗火把' : '你花时间撬开了锁');
    if (state.status !== 'active') return undefined;
    spawnBehindDoor(state, node, door, rng, rolls);
    return undefined;
  }

  // 破坏房门：不用火把，但门再也关不上，而且惊动了怪物
  pushLog(state, 'warn', '你砸开了房门：门再也关不上了，声音也惊动了附近的怪物。');
  door.forced = true;
  spawnBehindDoor(state, node, door, rng, rolls);
  door.status = 'broken';
  if (hooks.torchOnDoorSmash) {
    const roll = rollD6(rng);
    pushRoll(rolls, `破坏房门 1d6（${hooks.torchOnDoorSmash} 可得火把）`, { notation: '1d6', values: [roll], modifier: 0, total: roll });
    if (roll === hooks.torchOnDoorSmash) {
      state.hero.torches = Math.min(RULES.maxTorches, state.hero.torches + 1);
      pushLog(state, 'loot', '伐木工的手艺：从门框上拆下一根可燃的木条（+1 火把）。');
    }
  }
  // 被惊动的怪物先手
  if (hasLivingMonsters(node)) {
    node.sneaked = false;
    startCombat(state, node, 'monsters', rng, rolls);
  }
  return undefined;
}

/** 进入相邻片段：走法由「那扇门是不是被砸开的」决定。 */
function enterNeighbor(state: RunState, targetId: string, rng: Rng, rolls: RollRecord[], requestedMode?: 'walk' | 'sneak'): string | undefined {
  const node = state.dungeon.nodes.find((item) => item.id === targetId);
  if (!node) return '这个片段不存在。';
  const link = state.dungeon.nodes.find((item) => item.doors.some((door) => door.to === targetId));
  const door = link?.doors.find((item) => item.to === targetId);
  if (!link && node.id !== state.dungeon.currentId) return '没有通到这个片段的路。';
  const mode = requestedMode ?? (door?.forced ? 'force' : 'walk');
  if (requestedMode === 'sneak' && state.hero.torches <= 0) return '安静移动需要 1 个火把。';
  if (requestedMode === 'sneak') spendTorches(state, RULES.torchPerAction, '你屏住呼吸，安静地移动');
  if (state.status !== 'active') return undefined;
  enterNode(state, node, rng, rolls, mode);
  return undefined;
}

function searchSecretPassage(state: RunState, node: DungeonNode, rng: Rng, rolls: RollRecord[]): string | undefined {
  if (!node.hasSecretPassage) return '这个片段里没有密道的迹象。';
  if (node.secretPassageSearched) return '这个片段已经找过了。';
  if (state.hero.torches <= 0) return '寻找密道需要 1 个火把。';
  spendTorches(state, RULES.torchPerAction, '你仔细检查墙壁与地板，寻找密道');
  if (state.status !== 'active') return undefined;
  node.secretPassageSearched = true;
  const type = dungeonType(state);
  const result = hasAdvantage(state.hero, 'search-secret-passage') ? rollAdvantage(6, rng) : rollDice('1d6', rng);
  pushRoll(rolls, '密道 1d6', result);
  const entry = pickByRoll(secretPassagesFor(type), result.total);
  if (!entry) return undefined;
  pushLog(state, 'table', entry.text);
  if (entry.kind === 'trap') {
    applyTrap(state, node, rng, rolls);
    return undefined;
  }
  if (entry.kind === 'chest') {
    node.chest = { opened: false };
    return undefined;
  }
  if (entry.kind === 'stairs') travelDeeper(state, rng, rolls, true);
  return undefined;
}

function openChest(state: RunState, node: DungeonNode, rng: Rng, rolls: RollRecord[]): string | undefined {
  if (!node.chest) return '这里没有宝箱。';
  if (node.chest.opened) return '这个宝箱已经打开过了。';
  node.chest.opened = true;
  state.stats.chestsOpened += 1;
  const result = rollDice('2d6', rng);
  pushRoll(rolls, '宝箱 2d6', result);
  const high = Math.max(...result.values);
  const low = Math.min(...result.values);
  if (high === 1 && low === 1) {
    pushLog(state, 'warn', '宝箱是空的，而且你触发了一个陷阱！');
    applyTrap(state, node, rng, rolls);
    return undefined;
  }
  const multiplier = node.chest.big ? 2 : 1;
  const coins = high * multiplier;
  const treasures = low * multiplier;
  state.hero.coins += coins;
  state.stats.coinsFound += coins;
  state.hero.treasure += treasures;
  state.stats.treasures += treasures;
  pushLog(state, 'loot', `宝箱里有 ${coins} 金币和 ${treasures} 个财宝${multiplier > 1 ? '（大宝箱：内容翻倍）' : ''}。`);
  return undefined;
}

/** 制造一个新片段（楼梯 / 最终房间），坐标交给 map.ts 排版。 */
function makeNode(kind: string, depth: number, doors: number): DungeonNode {
  const size = footprintOf({ kind });
  const node: DungeonNode = {
    id: uid('node'),
    kind,
    depth,
    doors: Array.from({ length: doors }, () => makeDoor(uid('door'))),
    monsters: [],
    trapsActive: false,
    cleared: kind !== 'boss',
    visited: true,
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
  };
  assignDoorDirs(node);
  return node;
}

/** 下楼：第 3 层就是最终房间（Boss 房）。 */
function travelDeeper(state: RunState, rng: Rng, rolls: RollRecord[], fromSecretPassage = false): void {
  const nextDepth = state.dungeon.depth + 1;
  state.dungeon.depth = nextDepth;
  state.stats.deepestDepth = Math.max(state.stats.deepestDepth, nextDepth);
  const type = dungeonType(state);
  const stairs = makeNode('stairs', nextDepth, 1);
  Object.assign(stairs, placeForNewDepth(state.dungeon.nodes, { w: stairs.w ?? 2, h: stairs.h ?? 2 }));
  state.dungeon.nodes.push(stairs);
  state.dungeon.currentId = stairs.id;
  pushLog(state, 'info', fromSecretPassage ? '密门后是一段向下的楼梯。' : `你走下楼梯，来到第 ${nextDepth} 层。`);

  if (nextDepth >= RULES.finalRoomDepth) {
    const roll = rollD6(rng);
    pushRoll(rolls, '地牢 Boss 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    const entry = pickByRoll(type.boss, roll);
    if (!entry) return;
    const bossNode = makeNode('boss', nextDepth, 0);
    // 最终房间也紧贴着楼梯生成：两边各一扇门，画在同一格上
    const bossSize = { w: bossNode.w ?? 4, h: bossNode.h ?? 4 };
    const spot = placeBehindDoor(stairs, bossSize, state.dungeon.nodes, stairs.doors[0]?.dir ?? 'e')
      ?? { x: stairs.x, y: (stairs.y ?? 0) + (stairs.h ?? 2) + 1, dir: stairs.doors[0]?.dir ?? 'e', detached: true };
    Object.assign(bossNode, { x: spot.x, y: spot.y, w: bossSize.w, h: bossSize.h });
    const stairDoor = stairs.doors[0] ?? makeDoor(uid('door'));
    stairs.doors = [stairDoor];
    stairDoor.to = bossNode.id;
    stairDoor.status = 'open';
    stairDoor.dir = spot.dir;
    bossNode.doors = [{ id: uid('door'), status: 'open', to: stairs.id, dir: OPPOSITE[spot.dir] }];
    assignDoorDirs(bossNode);
    bossNode.monsters = monstersFromEntry(entry, entry.name, rng, true);
    bossNode.cleared = false;
    state.dungeon.nodes.push(bossNode);
    state.dungeon.currentId = bossNode.id;
    pushLog(state, 'warn', `最终房间：${entry.intro ?? ''}${entry.name}${entry.en ? ` ${entry.en}` : ''}${entry.flavor ?? ''}`);
    startCombat(state, bossNode, 'player', rng, rolls);
  }
}

/* ── 玩家战斗动作 ── */

function playerAttack(state: RunState, targetUid: string, rng: Rng, rolls: RollRecord[]): string | undefined {
  const combat = state.combat;
  const node = combat ? nodeById(state, combat.nodeId) : undefined;
  if (!combat || !node) return '现在不在战斗中。';
  if (combat.awaitingDamageTarget) return '先决定这笔伤害由 HP 还是护甲承受。';
  const alive = aliveMonsters(node);
  const target = alive.find((monster) => monster.uid === targetUid) ?? alive[0];
  if (!target) return '没有可以攻击的目标。';
  const hero = state.hero;
  if (!weaponUsable(hero, hero.weapon)) return '双手武器需要两只手：先施放光亮术（或找到油灯）。';

  const result = rollDice(hero.weapon.damage, rng);
  pushRoll(rolls, `攻击 ${target.name}（${hero.weapon.name} ${hero.weapon.damage}）`, result);
  const attackRoll = result.values[0] ?? 1;
  let damage = result.total + heroDamageBonus(hero) + (combat.raging ? 2 : 0);
  if (target.affixes.includes('undead')) damage += heroHooks(hero).undeadBonus;

  if (target.affixes.includes('intangible') && attackRoll % 2 === 0) {
    damage = 0;
    pushLog(state, 'combat', `${target.name} 是无形之身：偶数攻击骰伤不到它。`);
  }
  const stoneskinId = target.affixes.find((id) => affixById(id)?.trigger === 'ignoreDamageAtOrBelow');
  const threshold = stoneskinId ? affixById(stoneskinId)?.value ?? 3 : 0;
  if (threshold > 0 && damage > 0 && damage <= threshold) {
    damage = 0;
    pushLog(state, 'combat', `${target.name} 的石肤挡下了这一击（不超过 ${threshold} 点伤害）。`);
  }
  if (target.affixes.some((id) => affixById(id)?.trigger === 'doubleDamageOnRoll6') && attackRoll === 6) {
    damage *= 2;
    pushLog(state, 'combat', '弱点被打中：伤害翻倍！');
  }
  if (hero.weapon.name.includes('致命斩首') && attackRoll === 6) {
    damage = Math.max(damage, target.hp);
    pushLog(state, 'combat', '致命斩首：这一击直接带走它。');
  }

  if (damage > 0) {
    target.hp -= damage;
    pushLog(state, 'combat', `你造成 ${damage} 点伤害，${target.name} 剩 ${Math.max(0, target.hp)} HP。`);
    if (hero.weapon.name.includes('吸血鬼')) {
      hero.hp = Math.min(hero.maxHp, hero.hp + 1);
      pushLog(state, 'loot', '吸血鬼之武器吸取了 1 点生命。');
    }
    resolveKill(state, node, target, rng, rolls);
  } else {
    pushLog(state, 'combat', '这一击没有造成伤害。');
  }

  if (attackRoll === 1) applyAttackRollOne(state, node, target, rng, rolls);
  if (state.status !== 'active') return undefined;
  if (!hasLivingMonsters(node)) {
    endCombat(state, node);
    return undefined;
  }
  monsterTurn(state, rng, rolls);
  return undefined;
}

function castSpell(state: RunState, spellIndex: number, targetUid: string | undefined, rng: Rng, rolls: RollRecord[]): string | undefined {
  const hero = state.hero;
  const slot = hero.spells[spellIndex];
  if (!slot) return '没有这个咒语。';
  if (slot.spent) return '这个咒语已经用掉了：回城镇休息可以恢复。';
  const spell = spellById(slot.spellId);
  if (!spell) return '咒语数据缺失。';
  const node = state.combat ? nodeById(state, state.combat.nodeId) : currentNode(state);
  if (!node) return '找不到你所在的片段。';
  const alive = aliveMonsters(node);
  const target = alive.find((monster) => monster.uid === targetUid) ?? alive[0];
  if ((spell.kind === 'damage' || spell.kind === 'damageStun') && !target) return '这里没有可以攻击的怪物。';
  if (spell.kind === 'damageRoom' && !alive.length) return '这里没有可以攻击的怪物。';

  slot.spent = true;
  pushLog(state, 'combat', `你施放 ${spell.name}：${spell.effect}`);

  switch (spell.kind) {
    case 'heal': {
      hero.hp = Math.min(hero.maxHp, hero.hp + (spell.amount ?? 5));
      pushLog(state, 'loot', `HP 恢复到 ${hero.hp}。`);
      break;
    }
    case 'light': {
      hero.hasLight = true;
      pushLog(state, 'info', '一团不占手的光芒浮在你身边：现在可以用双手武器了。');
      break;
    }
    case 'teleport': {
      const safe = state.dungeon.nodes.filter((item) => item.id !== node.id && item.kind === 'room' && !hasLivingMonsters(item));
      const destination = safe[safe.length - 1] ?? state.dungeon.nodes[0];
      if (state.combat) state.combat = null;
      state.dungeon.currentId = destination.id;
      pushLog(state, 'info', safe.length ? '你被传送到另一个空房间。' : '附近没有别的空房间，你被传回了地牢入口。');
      return undefined;
    }
    case 'damage':
    case 'damageStun': {
      if (!target) break;
      const amount = spell.amount ?? 0;
      target.hp -= amount;
      if (spell.kind === 'damageStun') target.stunned = true;
      pushLog(state, 'combat', `${target.name} 受到 ${amount} 点伤害（剩 ${Math.max(0, target.hp)} HP）${spell.kind === 'damageStun' ? '，并且下一回合无法攻击' : ''}。`);
      resolveKill(state, node, target, rng, rolls);
      break;
    }
    case 'damageRoom': {
      const amount = spell.amount ?? 0;
      for (const monster of alive) {
        monster.hp -= amount;
        pushLog(state, 'combat', `${monster.name} 受到 ${amount} 点伤害（剩 ${Math.max(0, monster.hp)} HP）。`);
        resolveKill(state, node, monster, rng, rolls);
      }
      break;
    }
    default: break;
  }

  if (state.status !== 'active') return undefined;
  if (state.combat) {
    if (!hasLivingMonsters(node)) endCombat(state, node);
    else monsterTurn(state, rng, rolls);
  }
  return undefined;
}

function useItem(state: RunState, itemUid: string, rng: Rng, rolls: RollRecord[]): string | undefined {
  const hero = state.hero;
  const item = hero.items.find((entry) => entry.uid === itemUid);
  if (!item) return '背包里没有这件物品。';
  if (item.kind === 'armor' || item.kind === 'weapon') return '装备请点「装备」，不能当道具使用。';
  const use = item.use ?? 'none';
  if (use === 'none') return `${item.name} 只能留着或卖掉。`;
  const node = state.combat ? nodeById(state, state.combat.nodeId) : currentNode(state);
  const consume = () => { hero.items = hero.items.filter((entry) => entry.uid !== item.uid); };

  /** 卷轴/蓝宝石这类「随机基本咒语」：掷 1d6 立刻生效。 */
  const castRandomSpell = (label: string, consumeAfter: boolean) => {
    const roll = rollD6(rng);
    pushRoll(rolls, `${label} 1d6`, { notation: '1d6', values: [roll], modifier: 0, total: roll });
    const spell = pickByRoll(CORE.spells, roll);
    if (consumeAfter) consume();
    if (!spell) return;
    pushLog(state, 'table', `${label}：${spell.name}（${spell.effect}）`);
    const alive = node ? aliveMonsters(node) : [];
    if (spell.kind === 'heal') {
      hero.hp = Math.min(hero.maxHp, hero.hp + (spell.amount ?? 5));
      pushLog(state, 'loot', `HP 恢复到 ${hero.hp}。`);
    } else if (spell.kind === 'light') {
      hero.hasLight = true;
      pushLog(state, 'info', '光芒浮在你身边：现在可以用双手武器。');
    } else if (spell.kind === 'teleport' && node) {
      const safe = state.dungeon.nodes.filter((entry) => entry.id !== node.id && entry.kind === 'room' && !hasLivingMonsters(entry));
      state.combat = null;
      state.dungeon.currentId = (safe[safe.length - 1] ?? state.dungeon.nodes[0]).id;
      pushLog(state, 'info', '你被传送走了。');
    } else if (node && alive.length) {
      const amount = spell.amount ?? 0;
      const targets = spell.kind === 'damageRoom' ? alive : [alive[0]];
      for (const monster of targets) {
        monster.hp -= amount;
        if (spell.kind === 'damageStun') monster.stunned = true;
        pushLog(state, 'combat', `${monster.name} 受到 ${amount} 点伤害（剩 ${Math.max(0, monster.hp)} HP）。`);
        resolveKill(state, node, monster, rng, rolls);
      }
    }
  };

  switch (use) {
    case 'heal':
      hero.hp = hero.maxHp;
      pushLog(state, 'loot', `${item.name}：HP 回满（${hero.hp}）。`);
      consume();
      break;
    case 'spells':
      hero.spells = hero.spells.map((spell) => ({ ...spell, spent: false }));
      pushLog(state, 'loot', `${item.name}：所有已消耗的咒语都恢复了。`);
      consume();
      break;
    case 'light':
      hero.hasLight = true;
      item.light = true;
      pushLog(state, 'info', `${item.name} 点亮了：光源不占手，现在可以用双手武器。`);
      break;
    case 'luck':
      hero.trapShield += 1;
      pushLog(state, 'info', `${item.name}：下一个触发的陷阱会被无视。`);
      consume();
      break;
    case 'rage':
      if (state.combat) state.combat.raging = true;
      pushLog(state, 'combat', `${item.name}：本场战斗伤害 +2。`);
      consume();
      break;
    case 'arm':
      hero.lostArm = false;
      pushLog(state, 'loot', `${item.name}：失去的手臂长回来了。`);
      consume();
      break;
    case 'torch':
      hero.torches = Math.min(RULES.maxTorches, hero.torches + 2);
      pushLog(state, 'loot', `${item.name}：相当于两个火把（火把 ${hero.torches} 个）。`);
      consume();
      break;
    case 'learn-spell': {
      const roll = rollD6(rng);
      pushRoll(rolls, '学习咒语 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
      const spell = pickByRoll(CORE.spells, roll);
      if (spell) {
        hero.spells.push({ spellId: spell.id, name: spell.name, effect: spell.effect, spent: false });
        pushLog(state, 'loot', `你学会了 ${spell.name}：${spell.effect}`);
      }
      consume();
      break;
    }
    case 'scroll':
      castRandomSpell('卷轴', true);
      if (state.status !== 'active') return undefined;
      if (state.combat && node) {
        if (!hasLivingMonsters(node)) endCombat(state, node);
        else monsterTurn(state, rng, rolls);
      }
      return undefined;
    default:
      return `${item.name} 的使用方式还没有实现：${use}。`;
  }

  if (state.status !== 'active') return undefined;
  if (state.combat && node) {
    if (!hasLivingMonsters(node)) endCombat(state, node);
    else monsterTurn(state, rng, rolls);
  }
  return undefined;
}

function allocateDamage(state: RunState, target: 'hp' | 'armor', armorUid: string | undefined, rng: Rng, rolls: RollRecord[]): string | undefined {
  const combat = state.combat;
  if (!combat) return '现在不在战斗中。';
  const amount = combat.pendingDamage;
  if (amount <= 0) return '没有待分配的伤害。';
  const hero = state.hero;

  if (target === 'armor') {
    if (combat.pendingDamageUnabsorbable) return '剧毒伤害无法由护甲吸收，只能自己扛。';
    const armor = hero.armors.find((entry) => entry.uid === armorUid) ?? hero.armors[0];
    if (!armor) return '你没有可以承受伤害的护甲。';
    armor.hp = Math.max(0, (armor.hp ?? 0) - amount);
    pushLog(state, 'combat', `${armor.name} 承受了 ${amount} 点伤害（剩 ${armor.hp} HP）。`);
    if ((armor.hp ?? 0) <= 0) {
      hero.armors = hero.armors.filter((entry) => entry.uid !== armor.uid);
      pushLog(state, 'warn', `${armor.name} 被破坏了。`);
    }
  } else {
    hero.hp -= amount;
    pushLog(state, 'combat', `你硬扛了 ${amount} 点伤害（HP ${Math.max(0, hero.hp)}）。`);
    if (checkDeath(state, '被怪物打死')) return undefined;
  }

  combat.pendingDamage = 0;
  combat.pendingDamageFrom = '';
  combat.pendingDamageUnabsorbable = false;
  combat.awaitingDamageTarget = false;
  afterMonsterTurn(state, rng, rolls);
  return undefined;
}

function devour(state: RunState, node: DungeonNode): string | undefined {
  if (!node.corpse || node.corpse.devoured) return '这里没有可以吞噬的尸体。';
  if (!heroHooks(state.hero).healFullOnDevour) return '只有史莱姆人能靠吞噬尸体恢复 HP。';
  node.corpse.devoured = true;
  state.hero.hp = state.hero.maxHp;
  pushLog(state, 'loot', `你吞噬了 ${node.corpse.name} 的尸体，HP 回满（${state.hero.hp}）。`);
  return undefined;
}

/** 把一件装备或武器包成背包物品（遗体上的穿戴物也要能装进背包）。 */
function weaponAsItem(weapon: WeaponSpec & { magic?: boolean; damageBonus?: number; note?: string }): Item {
  return {
    uid: uid('item'),
    name: weapon.name,
    kind: 'weapon',
    text: weapon.note ?? `${weapon.damage} 伤害${weapon.twoHanded ? '；双手' : ''}`,
    value: RULES.itemSellPrice,
    magic: Boolean(weapon.magic),
    damage: weapon.damage,
    twoHanded: weapon.twoHanded,
    damageBonus: weapon.damageBonus ?? 0,
  };
}

/**
 * 搜刮前一位冒险者的遗体：给了 itemUid 就只拿那件，否则把背包还装得下的全拿走。
 * 装不下的东西留在遗体上（looted 仍为 false），下次再来还能拿。
 */
function lootGrave(state: RunState, node: DungeonNode, itemUid: string | undefined): string | undefined {
  const grave = node.heroGrave;
  if (!grave) return '这里没有遗体。';
  if (grave.looted) return `${grave.name} 的遗体已经被搬空了。`;
  const hero = state.hero;
  const taken: string[] = [];
  const blocked: string[] = [];

  if (itemUid) {
    const candidates = [...grave.items, ...grave.armors];
    const item = candidates.find((entry) => entry.uid === itemUid);
    if (!item) return '遗体上没有这件物品。';
    if (!addItem(state, item)) return `背包满了：${item.name} 带不走。`;
    grave.items = grave.items.filter((entry) => entry.uid !== item.uid);
    grave.armors = grave.armors.filter((entry) => entry.uid !== item.uid);
    taken.push(item.name);
  } else {
    for (const item of [...grave.items, ...grave.armors]) {
      if (addItem(state, item)) {
        taken.push(item.name);
        grave.items = grave.items.filter((entry) => entry.uid !== item.uid);
        grave.armors = grave.armors.filter((entry) => entry.uid !== item.uid);
      } else blocked.push(item.name);
    }
    if (grave.weapon) {
      const weaponItem = weaponAsItem(grave.weapon);
      if (addItem(state, weaponItem)) {
        taken.push(weaponItem.name);
        grave.weapon = undefined;
      } else blocked.push(weaponItem.name);
    }
    if (grave.coins > 0) {
      hero.coins += grave.coins;
      state.stats.coinsFound += grave.coins;
      taken.push(`${grave.coins} 金币`);
      grave.coins = 0;
    }
    if (grave.treasure > 0) {
      hero.treasure += grave.treasure;
      state.stats.treasures += grave.treasure;
      taken.push(`${grave.treasure} 个财宝`);
      grave.treasure = 0;
    }
    if (grave.keys > 0) {
      hero.keys += grave.keys;
      taken.push(`${grave.keys} 把钥匙`);
      grave.keys = 0;
    }
  }

  if (taken.length) pushLog(state, 'loot', `你从 ${grave.name} 的遗体上取走了：${taken.join('、')}。`);
  if (blocked.length) pushLog(state, 'warn', `${blocked.join('、')} 还留在遗体上：背包最多 ${RULES.maxItems} 件，先腾地方。`);
  if (!taken.length && !blocked.length) pushLog(state, 'info', `${grave.name} 的遗体上已经什么都没有了。`);
  grave.looted = !grave.items.length && !grave.armors.length && !grave.weapon && grave.coins <= 0 && grave.treasure <= 0 && grave.keys <= 0;
  if (grave.looted) pushLog(state, 'info', '遗体被搬空了：愿他安息。');
  return undefined;
}

function equipArmor(state: RunState, itemUid: string): string | undefined {
  const hero = state.hero;
  const item = hero.items.find((entry) => entry.uid === itemUid && entry.kind === 'armor');
  if (!item) return '背包里没有这件护甲。';
  if (!item.slot) return '这件护甲缺少部位信息。';
  const replaced = hero.armors.find((entry) => entry.slot === item.slot);
  hero.armors = hero.armors.filter((entry) => entry.slot !== item.slot);
  hero.armors.push(item);
  hero.items = hero.items.filter((entry) => entry.uid !== item.uid);
  if (replaced) hero.items.push(replaced);
  pushLog(state, 'info', `装备了 ${item.name}${replaced ? `（换下 ${replaced.name}）` : ''}。`);
  return undefined;
}

function equipWeapon(state: RunState, itemUid: string): string | undefined {
  const hero = state.hero;
  const item = hero.items.find((entry) => entry.uid === itemUid && entry.kind === 'weapon');
  if (!item) return '背包里没有这件武器。';
  const previous = hero.weapon;
  hero.weapon = {
    name: item.name,
    damage: item.damage ?? '1d6',
    twoHanded: item.twoHanded,
    magic: item.magic,
    damageBonus: item.damageBonus ?? 0,
    note: item.text,
  };
  hero.items = hero.items.filter((entry) => entry.uid !== item.uid);
  pushLog(state, 'info', `换上 ${item.name}（${item.damage ?? '1d6'} 伤害）。`);
  const leftover: Item = {
    uid: uid('item'),
    name: previous.name,
    kind: 'weapon',
    text: `${previous.damage} 伤害${previous.twoHanded ? '；双手' : ''}`,
    value: RULES.itemSellPrice,
    magic: Boolean(previous.magic),
    damage: previous.damage,
    twoHanded: previous.twoHanded,
    damageBonus: previous.damageBonus ?? 0,
    use: 'none',
  };
  addItem(state, leftover);
  return undefined;
}

/* ── 城镇与往返 ── */

/** 从当前片段回到入口的无向路径（沿已经打开的门走）。 */
function pathToEntrance(state: RunState): DungeonNode[] | null {
  const byId = new Map(state.dungeon.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const node of state.dungeon.nodes) {
    for (const door of node.doors) {
      if (!door.to || (door.status !== 'open' && door.status !== 'broken')) continue;
      if (!adjacency.has(node.id)) adjacency.set(node.id, []);
      if (!adjacency.has(door.to)) adjacency.set(door.to, []);
      adjacency.get(node.id)?.push(door.to);
      adjacency.get(door.to)?.push(node.id);
    }
  }
  const entranceId = state.dungeon.nodes[0].id;
  const parent = new Map<string, string | null>([[state.dungeon.currentId, null]]);
  const queue: string[] = [state.dungeon.currentId];
  while (queue.length) {
    const id = queue.shift() as string;
    if (id === entranceId) break;
    for (const next of adjacency.get(id) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, id);
      queue.push(next);
    }
  }
  if (!parent.has(entranceId)) return state.dungeon.currentId === entranceId ? [byId.get(entranceId) as DungeonNode] : null;
  const path: DungeonNode[] = [];
  let cursor: string | null = entranceId;
  while (cursor) {
    const node = byId.get(cursor);
    if (node) path.push(node);
    cursor = parent.get(cursor) ?? null;
  }
  return path;
}

/** 回城：原书要求「所在地牢片段与入口之间的所有片段都是空的」。 */
function goToTown(state: RunState): string | undefined {
  if (state.combat) return '战斗还没结束，先打完。';
  const path = pathToEntrance(state);
  if (!path) return '找不到回入口的路。';
  const blocked = path.find((node) => hasLivingMonsters(node));
  if (blocked) return `回城的路上还有怪物（${blocked.monsters[0].name}），必须先清理掉。`;
  state.town.inTown = true;
  state.town.needsMonsterReroll = true;
  state.hero.stunned = 0;
  pushLog(state, 'town', '你顺着原路走出地牢，回到了城镇。');
  return undefined;
}

function returnToDungeon(state: RunState, rng: Rng, rolls: RollRecord[]): string | undefined {
  const hero = state.hero;
  if (!state.town.inTown) return '你已经在里面了。';
  if (hero.torches <= 0 && !hero.hasLight) return '没有火把就下地牢等于送死：先去买几个火把。';
  const cost = hero.hasLight ? 0 : RULES.torchPerDungeonEntry;
  hero.torches = Math.max(0, hero.torches - cost);
  state.dungeon.entries += 1;
  state.town.inTown = false;
  state.dungeon.currentId = state.dungeon.nodes[0].id;
  pushLog(state, 'info', `你重新走进地牢（消耗 ${cost} 个火把，剩 ${hero.torches} 个）。返回后重新进入的空房间都要再掷一次怪物表。`);
  // 一路走下来把最后一个火把烧完：黑暗会立刻找上你（矿工则摸黑离开）
  resolveDarkness(state);
  if (state.status !== 'active') return undefined;
  enterNode(state, state.dungeon.nodes[0], rng, rolls, 'walk');
  return undefined;
}

function townRest(state: RunState): string | undefined {
  const hero = state.hero;
  if (hero.coins < RULES.restCost) return `休息需要 ${RULES.restCost} 金币。`;
  hero.coins -= RULES.restCost;
  hero.hp = hero.maxHp;
  hero.spells = hero.spells.map((spell) => ({ ...spell, spent: false }));
  pushLog(state, 'town', `你在旅店休息：HP 回满、咒语全部恢复（-${RULES.restCost} 金币，剩 ${hero.coins}）。`);
  return undefined;
}

function townRepair(state: RunState, itemUid: string): string | undefined {
  const hero = state.hero;
  const armor = hero.armors.find((entry) => entry.uid === itemUid);
  if (!armor) return '你没有装备这件护甲。';
  if (heroHooks(hero).repairArmorWithTorch) {
    if (hero.torches < RULES.torchPerArmorRepair) return '铁匠的手艺需要 1 个火把。';
    hero.torches -= RULES.torchPerArmorRepair;
    armor.hp = armor.maxHp ?? armor.hp;
    pushLog(state, 'town', `铁匠用 1 个火把修好了 ${armor.name}（火把剩 ${hero.torches} 个）。`);
    return undefined;
  }
  if (hero.coins < RULES.armorRepairCost) return `修理护甲需要 ${RULES.armorRepairCost} 金币。`;
  hero.coins -= RULES.armorRepairCost;
  armor.hp = armor.maxHp ?? armor.hp;
  pushLog(state, 'town', `修好了 ${armor.name}（-${RULES.armorRepairCost} 金币，剩 ${hero.coins}）。`);
  return undefined;
}

function townBuyTorch(state: RunState, count: number): string | undefined {
  const hero = state.hero;
  const room = RULES.maxTorches - hero.torches;
  if (room <= 0) return `最多只能带 ${RULES.maxTorches} 个火把。`;
  const buy = Math.min(Math.max(1, count), room);
  if (hero.coins < buy * RULES.torchPrice) return `买 ${buy} 个火把需要 ${buy * RULES.torchPrice} 金币。`;
  hero.coins -= buy * RULES.torchPrice;
  hero.torches += buy;
  pushLog(state, 'town', `买了 ${buy} 个火把（-${buy * RULES.torchPrice} 金币，火把 ${hero.torches} 个，剩 ${hero.coins} 金币）。`);
  return undefined;
}

/** 出售物品：普通物品按售价；魔法物品 1d6-1 金币；猫人双倍。 */
function townSell(state: RunState, itemUid: string, rng: Rng, rolls: RollRecord[]): string | undefined {
  const hero = state.hero;
  const item = hero.items.find((entry) => entry.uid === itemUid);
  if (!item) return '背包里没有这件物品。';
  if (item.kind === 'key') return '钥匙不能卖。';
  const hooks = heroHooks(hero);
  const removeOne = () => { hero.items = hero.items.filter((entry) => entry.uid !== item.uid); };

  if (item.kind === 'potion' || item.kind === 'scroll' || item.magic) {
    const roll = rollD6(rng);
    pushRoll(rolls, '出售魔法物品 1d6（-1）', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    const price = Math.max(0, roll - 1) * (hooks.doubleSell ? 2 : 1);
    removeOne();
    hero.coins += price;
    pushLog(state, 'town', `卖掉 ${item.name}：+${price} 金币（共 ${hero.coins}）${hooks.doubleSell ? '，猫人的双倍价格' : ''}。`);
    return undefined;
  }
  const price = (item.value || RULES.itemSellPrice) * (hooks.doubleSell ? 2 : 1);
  removeOne();
  hero.coins += price;
  pushLog(state, 'town', `卖掉 ${item.name}：+${price} 金币（共 ${hero.coins}）${hooks.doubleSell ? '，猫人的双倍价格' : ''}。`);
  return undefined;
}

/** 财宝 → 掷奖励表换成物品（原书 Table: Reward）。 */
function townRewardTreasure(state: RunState, count: number, rng: Rng, rolls: RollRecord[]): string | undefined {
  const hero = state.hero;
  if (hero.treasure <= 0) return '你没有财宝可以兑换。';
  const times = Math.min(Math.max(1, count), hero.treasure);
  const type = dungeonType(state);
  for (let index = 0; index < times; index += 1) {
    hero.treasure -= 1;
    const items = treasureToItems(type, rng, rolls);
    for (const item of items) {
      if (addItem(state, item)) pushLog(state, 'loot', `财宝换来了 ${item.name}（${item.text}）。`);
    }
  }
  pushLog(state, 'town', `兑换了 ${times} 个财宝，还剩 ${hero.treasure} 个。`);
  return undefined;
}

/** 通关结算：最终房间的 Boss 被击败就结束这一局（另外还能找到 2d6 个宝藏）。 */
function settle(state: RunState, rng: Rng, rolls: RollRecord[]): void {
  if (state.status !== 'active') return;
  ensureFinalRoom(state, rng, rolls);
  if (state.status !== 'active') return;
  const boss = state.dungeon.nodes.find((node) => node.kind === 'boss');
  if (!boss || !boss.visited || hasLivingMonsters(boss)) return;
  const result = rollDice('2d6', rng);
  pushRoll(rolls, 'Boss 房宝藏 2d6', result);
  state.hero.treasure += result.total;
  state.stats.treasures += result.total;
  finishRun(state, 'cleared', `你击败了最终房间的 Boss，还找到 ${result.total} 个宝藏。`, `🎉 通关！Boss 被击败，另外找到 ${result.total} 个宝藏。`);
}

/**
 * 原书第 8 页：如果这条地牢没有楼梯能让你到达第三层，那么最后一个打开的房间就是最终房间。
 * 所以每次动作结算后都检查一次：地图上再没有任何可以推进的地方时，把最后一个房间升级成 Boss 房。
 */
function ensureFinalRoom(state: RunState, rng: Rng, rolls: RollRecord[]): void {
  if (state.status !== 'active' || state.combat || state.town.inTown) return;
  if (state.dungeon.nodes.some((node) => node.kind === 'boss')) return;
  const hasPendingDoor = state.dungeon.nodes.some((node) => node.doors.some((door) => door.status === 'closed' || door.status === 'locked'));
  if (hasPendingDoor) return;
  if (state.dungeon.nodes.some((node) => !node.visited)) return;
  if (state.dungeon.nodes.some((node) => node.kind === 'stairs')) return;
  const rooms = state.dungeon.nodes.filter((node) => node.kind === 'room');
  if (!rooms.length) return;
  const target = rooms.find((node) => node.id === state.dungeon.currentId) ?? rooms[rooms.length - 1];
  const type = dungeonType(state);
  const roll = rollD6(rng);
  pushRoll(rolls, '地牢 Boss 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
  const entry = pickByRoll(type.boss, roll);
  if (!entry) return;
  target.kind = 'boss';
  // 最终房间不再有「没开的门」，但已经连通的门留着：探索过的房间随时能回来
  target.doors = target.doors.filter((door) => door.to);
  target.chest = undefined;
  target.hasSecretPassage = false;
  target.sneaked = false;
  target.monsters = monstersFromEntry(entry, entry.name, rng, true);
  target.cleared = false;
  target.visited = true;
  state.dungeon.currentId = target.id;
  pushLog(state, 'warn', `路到这里就断了：没有楼梯再往下，这个房间就是最终房间。${entry.intro ?? ''}${entry.name}${entry.en ? ` ${entry.en}` : ''}${entry.flavor ?? ''}`);
  startCombat(state, target, 'player', rng, rolls);
}

/* ── 动作总入口 ── */

function activeNodeOrNotice(state: RunState, nodeId: string | undefined): DungeonNode | string {
  const node = nodeId ? nodeById(state, nodeId) : currentNode(state);
  return node ?? '找不到这个片段。';
}

function requireTown(state: RunState): string | undefined {
  return state.town.inTown ? undefined : '这些只能在城镇里做：先走出地牢回到城镇。';
}

function requireCombat(state: RunState): string | undefined {
  return state.combat ? undefined : '现在不在战斗中。';
}

export function applyAction(prev: RunState, action: GameAction, rng: Rng = Math.random): ActionOutcome {
  if (prev.status !== 'active') {
    return { state: prev, rolls: [], notice: '这一局已经结束了：去「存档」里开新的一局吧。' };
  }
  const state = clone(prev);
  const rolls: RollRecord[] = [];
  let notice: string | undefined;
  const done = (): ActionOutcome => {
    settle(state, rng, rolls);
    state.updatedAt = Date.now();
    return { state, rolls, notice };
  };

  switch (action.type) {
    case 'rename':
      state.title = action.title.trim().slice(0, 60) || state.title;
      break;

    case 'abandon':
      finishRun(state, 'death', '你放弃了这次探索，角色的故事到此为止。', `🚪 ${state.hero.name} 放弃了「${state.dungeon.name}」的探索。`);
      break;

    case 'to-town':
      notice = goToTown(state);
      break;

    case 'return-dungeon':
      notice = returnToDungeon(state, rng, rolls);
      break;

    case 'town-rest':
      notice = requireTown(state) ?? townRest(state);
      break;

    case 'town-repair':
      notice = requireTown(state) ?? townRepair(state, action.itemUid);
      break;

    case 'town-buy-torch':
      notice = requireTown(state) ?? townBuyTorch(state, action.count ?? 1);
      break;

    case 'town-sell':
      notice = requireTown(state) ?? townSell(state, action.itemUid, rng, rolls);
      break;

    case 'town-reward-treasure':
      notice = requireTown(state) ?? townRewardTreasure(state, action.count ?? 1, rng, rolls);
      break;

    case 'equip-armor':
      notice = equipArmor(state, action.itemUid);
      break;

    case 'equip-weapon':
      notice = equipWeapon(state, action.itemUid);
      break;

    case 'attack':
      notice = requireCombat(state) ?? playerAttack(state, action.targetUid, rng, rolls);
      break;

    case 'cast-spell':
      notice = requireCombat(state) ?? castSpell(state, action.spellIndex, action.targetUid, rng, rolls);
      break;

    case 'use-item':
      notice = useItem(state, action.itemUid, rng, rolls);
      break;

    case 'allocate-damage':
      notice = requireCombat(state) ?? allocateDamage(state, action.target, action.armorUid, rng, rolls);
      break;

    case 'devour': {
      const node = activeNodeOrNotice(state, action.nodeId);
      notice = typeof node === 'string' ? node : devour(state, node);
      break;
    }

    case 'loot-grave': {
      const node = activeNodeOrNotice(state, action.nodeId);
      notice = typeof node === 'string' ? node : (requireReady(state, node) ?? lootGrave(state, node, action.itemUid));
      break;
    }

    case 'open-door': {
      const node = activeNodeOrNotice(state, action.nodeId);
      notice = typeof node === 'string' ? node : (requireReady(state, node) ?? openDoor(state, node, action.doorId, rng, rolls));
      break;
    }

    case 'lockpick': {
      const node = activeNodeOrNotice(state, action.nodeId);
      if (typeof node === 'string') { notice = node; break; }
      const blocked = state.town.inTown ? '先回到地牢里再说。' : state.combat ? '战斗还没结束。' : nodeBlocksActions(node) ? '先解决这个片段里的怪物。' : undefined;
      notice = blocked ?? resolveLockedDoor(state, node, action.doorId, 'lockpick', rng, rolls);
      break;
    }

    case 'smash': {
      const node = activeNodeOrNotice(state, action.nodeId);
      if (typeof node === 'string') { notice = node; break; }
      const blocked = state.town.inTown ? '先回到地牢里再说。' : state.combat ? '战斗还没结束。' : undefined;
      notice = blocked ?? resolveLockedDoor(state, node, action.doorId, 'smash', rng, rolls);
      break;
    }

    case 'use-key': {
      const node = activeNodeOrNotice(state, action.nodeId);
      if (typeof node === 'string') { notice = node; break; }
      const blocked = state.town.inTown ? '先回到地牢里再说。' : state.combat ? '战斗还没结束。' : nodeBlocksActions(node) ? '先解决这个片段里的怪物。' : undefined;
      notice = blocked ?? resolveLockedDoor(state, node, action.doorId, 'use-key', rng, rolls);
      break;
    }

    case 'enter-node':
      if (state.town.inTown) { notice = '你还在城镇里：先点「返回地牢」。'; break; }
      if (state.combat) { notice = '战斗还没结束。'; break; }
      notice = enterNeighbor(state, action.nodeId, rng, rolls, action.sneak ? 'sneak' : undefined);
      break;

    case 'search-secret-passage': {
      const node = activeNodeOrNotice(state, action.nodeId);
      notice = typeof node === 'string' ? node : (requireReady(state, node) ?? searchSecretPassage(state, node, rng, rolls));
      break;
    }

    case 'open-chest': {
      const node = activeNodeOrNotice(state, action.nodeId);
      notice = typeof node === 'string' ? node : (requireReady(state, node) ?? openChest(state, node, rng, rolls));
      break;
    }

    case 'descend': {
      const node = activeNodeOrNotice(state, action.nodeId);
      if (typeof node === 'string') { notice = node; break; }
      if (node.kind !== 'stairs') { notice = '这里没有向下的楼梯。'; break; }
      notice = requireReady(state, node);
      if (!notice) travelDeeper(state, rng, rolls);
      break;
    }

    default:
      notice = '未知动作。';
      break;
  }

  return done();
}

/* ── 摘要（存档列表、墓地、冒烟脚本共用） ── */

export function summarizeRun(state: RunState): {
  heroName: string; raceName: string; className: string; dungeonName: string; dungeonTypeId: string;
  depth: number; status: string; turns: number; kills: number; treasures: number; coins: number;
  torches: number; hp: number; maxHp: number; outcomeText: string;
} {
  return {
    heroName: state.hero.name,
    raceName: state.hero.raceName,
    className: state.hero.className,
    dungeonName: state.dungeon.name,
    dungeonTypeId: state.dungeon.typeId,
    depth: state.dungeon.depth,
    status: state.status,
    turns: state.stats.turns,
    kills: state.stats.kills,
    treasures: state.stats.treasures,
    coins: state.hero.coins,
    torches: state.hero.torches,
    hp: state.hero.hp,
    maxHp: state.hero.maxHp,
    outcomeText: state.outcome?.text ?? '',
  };
}

/** 需要记入墓地的角色（死亡或放弃）。 */
export function graveFromRun(state: RunState): { characterName: string; cause: string; depth: number } | null {
  if (state.status !== 'dead') return null;
  return {
    characterName: state.hero.name,
    cause: state.outcome?.text ?? '未知原因',
    depth: state.dungeon.depth,
  };
}

/**
 * 读档升级：v1 的老地图是「一格一个片段」，v2 改成格子占地（小房间 2×2 起）。
 * 版本落后时按门的关系重排一次并补上 w/h，读进来不会一间压一间。
 */
export function migrateRun(state: RunState): RunState {
  const next = clone(state);
  if ((next.version ?? 1) < 2) {
    relayoutNodes(next.dungeon.nodes);
    next.version = 2;
  }
  return next;
}

/**
 * 永久地牢视图：这一局的地图（含遗体与掉落）就是要写回地牢档案的内容。
 * 同一账号同一类型的地牢共用一张图，换角色进来看到的还是这张画过的地图。
 */
export function summarizeDungeon(state: RunState): {
  typeId: string; name: string; depth: number; nodes: DungeonNode[]; rooms: number; corpses: number;
} {
  const nodes = clone(state.dungeon.nodes);
  return {
    typeId: state.dungeon.typeId,
    name: state.dungeon.name,
    depth: state.dungeon.depth,
    nodes,
    rooms: nodes.filter((node) => node.kind === 'room' || node.kind === 'boss').length,
    corpses: nodes.filter((node) => node.heroGrave && !node.heroGrave.looted).length,
  };
}

/** 人物池回写：把这一局结束后的角色整理成池子记录需要的字段。 */
export function summarizeHeroForPool(state: RunState): {
  name: string; raceId: string; raceName: string; classId: string; className: string;
  maxHp: number; status: 'active' | 'dead'; hero: Hero; lastOutcome: string;
} {
  return {
    name: state.hero.name,
    raceId: state.hero.raceId,
    raceName: state.hero.raceName,
    classId: state.hero.classId,
    className: state.hero.className,
    maxHp: state.hero.maxHp,
    status: state.status === 'dead' ? 'dead' : 'active',
    hero: clone(state.hero),
    lastOutcome: state.outcome?.text ?? '',
  };
}

/* ── 战斗 ── */

export function monsterLabel(monster: Monster): string {
  const affixes = monster.affixes.map((id) => affixById(id)?.name ?? id);
  return affixes.length ? `${monster.name}（${affixes.join('、')}）` : monster.name;
}

export function startCombat(state: RunState, node: DungeonNode, initiative: 'player' | 'monsters', rng: Rng = Math.random, rolls: RollRecord[] = []): void {
  if (!hasLivingMonsters(node) || state.combat) return;
  state.combat = {
    nodeId: node.id,
    round: 1,
    phase: initiative === 'player' ? 'player' : 'monsters',
    initiative,
    pendingDamage: 0,
    pendingDamageFrom: '',
    pendingDamageUnabsorbable: false,
    awaitingDamageTarget: false,
    log: [],
  };
  const names = aliveMonsters(node).map(monsterLabel).join('、');
  pushLog(state, 'combat', initiative === 'player'
    ? `战斗开始：你出其不意，先手攻击 ${names}。`
    : `战斗开始：${names} 先手攻击！`);
  if (initiative === 'monsters') monsterTurn(state, rng, rolls);
}

function endCombat(state: RunState, node: DungeonNode): void {
  state.combat = null;
  node.trapsActive = false;
  const corpses = node.monsters.filter((monster) => monster.hp <= 0);
  node.monsters = node.monsters.filter((monster) => monster.hp > 0);
  node.cleared = node.monsters.length === 0;
  if (corpses.length) node.corpse = { name: corpses[corpses.length - 1].name, devoured: false };
  if (node.cleared) pushLog(state, 'combat', '这个片段里没有活着的怪物了，你可以继续开门或搜刮。');
}

/** 玩家攻击骰掷出 1 时，被攻击怪物身上的词缀效果。 */
function applyAttackRollOne(state: RunState, node: DungeonNode, target: Monster, rng: Rng, rolls: RollRecord[]): void {
  for (const affixId of target.affixes) {
    const affix = affixById(affixId);
    if (!affix || affix.trigger !== 'onPlayerAttackRoll1') continue;
    switch (affix.effect) {
      case 'explode': {
        const damage = Math.max(0, target.hp);
        state.hero.hp -= damage;
        pushLog(state, 'combat', `${target.name} 自爆，你受到 ${damage} 点伤害（HP ${Math.max(0, state.hero.hp)}）。`);
        break;
      }
      case 'nextDamage':
        target.bonusDamage += affix.value ?? 0;
        pushLog(state, 'combat', `${target.name} 的下一次伤害 +${affix.value ?? 0}。`);
        break;
      case 'nextDamageDice': {
        const result = rollDice(affix.damage ?? '1d6', rng);
        pushRoll(rolls, `${target.name} 施法 ${affix.damage ?? '1d6'}`, result);
        target.bonusDamage += result.total;
        pushLog(state, 'combat', `${target.name} 的下一次伤害 +${result.total}。`);
        break;
      }
      case 'summon': {
        if (affix.monster) {
          const spawned = monstersFromEntry(affix.monster, '召唤物', rng, false);
          node.monsters.push(...spawned);
          node.cleared = false;
          pushLog(state, 'combat', `${spawned.length} 个${spawned[0].name} 加入战斗！`);
        }
        break;
      }
      case 'nextAttackKills':
        target.killsOnHit = true;
        pushLog(state, 'combat', `${target.name} 的下一次攻击会直接杀死你！`);
        break;
      case 'heal':
        target.hp = Math.min(target.maxHp, target.hp + (affix.value ?? 0));
        pushLog(state, 'combat', `${target.name} 回复了 ${affix.value ?? 0} 点 HP。`);
        break;
      case 'nextAttackParalyze':
        target.paralyzesOnHit = true;
        pushLog(state, 'combat', `${target.name} 的下一次攻击会让你瘫痪！`);
        break;
      default: break;
    }
  }
  checkDeath(state, `${target.name} 的反击`);
}

/** 击杀结算：不死复活、战利品、厨师赏金。 */
function resolveKill(state: RunState, node: DungeonNode, target: Monster, rng: Rng, rolls: RollRecord[]): void {
  if (target.affixes.includes('undead')) {
    const revive = rollD6(rng);
    pushRoll(rolls, `${target.name} 不死复活判定 1d6`, { notation: '1d6', values: [revive], modifier: 0, total: revive });
    if (revive === 1) {
      target.hp = 1;
      pushLog(state, 'combat', `${target.name} 复活了！HP 1。`);
      return;
    }
  }
  if (target.hp > 0) return;
  state.stats.kills += 1;
  pushLog(state, 'combat', `${target.name} 被击败。`);
  if (target.affixes.includes('loot')) {
    const roll = rollD6(rng);
    pushRoll(rolls, '战利品 1d6', { notation: '1d6', values: [roll], modifier: 0, total: roll });
    const entry = lootEntryFor(roll);
    if (entry.kind === 'treasure') {
      state.hero.treasure += entry.amount;
      state.stats.treasures += entry.amount;
      pushLog(state, 'loot', '战利品：1 个财宝。');
    } else if (entry.kind === 'key') {
      state.hero.keys += entry.amount;
      pushLog(state, 'loot', '战利品：1 把钥匙（可以打开任意一扇门）。');
    } else {
      state.hero.coins += entry.amount;
      state.stats.coinsFound += entry.amount;
      pushLog(state, 'loot', `战利品：${entry.amount} 个金币。`);
    }
  }
  if (heroHooks(state.hero).coinPerKill && !target.affixes.includes('undead')) {
    state.hero.coins += 1;
    state.stats.coinsFound += 1;
    pushLog(state, 'loot', '厨师的手艺：杀死敌人获得 1 金币。');
  }
  if (node) node.corpse = { name: target.name, devoured: false };
}

/** 怪物回合：伤害汇总 → 交给玩家选择由 HP 还是护甲承受。 */
function monsterTurn(state: RunState, rng: Rng, rolls: RollRecord[]): void {
  const combat = state.combat;
  if (!combat) return;
  const node = nodeById(state, combat.nodeId);
  if (!node) return;
  const alive = aliveMonsters(node);
  if (!alive.length) {
    endCombat(state, node);
    return;
  }
  const hero = state.hero;
  let damage = 0;
  let unabsorbable = false;
  let killedByTouch = false;
  let paralyze = 0;
  const hasDivineArmor = hero.armors.some((armor) => armor.name.includes('众神之'));

  for (const monster of alive) {
    if (monster.stunned) {
      monster.stunned = false;
      pushLog(state, 'combat', `${monster.name} 还在冰冻中，这一回合无法攻击。`);
      continue;
    }
    damage += monster.damage + monster.bonusDamage;
    monster.bonusDamage = 0;
    if (monster.affixes.includes('poison')) unabsorbable = true;
    if (monster.killsOnHit) {
      monster.killsOnHit = false;
      if (hasDivineArmor) pushLog(state, 'info', '众神之护甲挡下了死亡之触。');
      else killedByTouch = true;
    }
    if (monster.paralyzesOnHit) {
      monster.paralyzesOnHit = false;
      const result = rollDice('1d6', rng);
      pushRoll(rolls, `${monster.name} 瘫痪判定 1d6`, result);
      paralyze = Math.max(paralyze, result.total);
    }
  }

  if (killedByTouch) {
    hero.hp = 0;
    checkDeath(state, '死亡之触');
    return;
  }
  if (paralyze > 0) {
    hero.stunned = paralyze;
    pushLog(state, 'warn', `你被瘫痪 ${paralyze} 个回合！`);
  }

  combat.pendingDamage = Math.max(0, damage);
  combat.pendingDamageFrom = alive.map((monster) => monster.name).join('、');
  combat.pendingDamageUnabsorbable = unabsorbable;
  combat.awaitingDamageTarget = combat.pendingDamage > 0;
  combat.phase = 'player';
  if (combat.pendingDamage > 0) {
    pushLog(state, 'combat', `${combat.pendingDamageFrom} 造成 ${combat.pendingDamage} 点伤害${unabsorbable ? '（剧毒：护甲无法吸收）' : ''}，请选择由 HP 还是护甲承受。`);
  } else {
    pushLog(state, 'combat', '怪物这一回合没有造成伤害。');
    afterMonsterTurn(state, rng, rolls);
  }
}

/** 怪物回合结束后的收尾：玩家瘫痪就再让怪物打一轮，否则交回玩家。 */
function afterMonsterTurn(state: RunState, rng: Rng, rolls: RollRecord[]): void {
  const combat = state.combat;
  if (!combat) return;
  const node = nodeById(state, combat.nodeId);
  if (!node) return;
  if (!hasLivingMonsters(node)) {
    endCombat(state, node);
    return;
  }
  if (state.hero.stunned > 0) {
    state.hero.stunned -= 1;
    pushLog(state, 'warn', `你还在瘫痪中（剩 ${state.hero.stunned} 回合）。`);
    monsterTurn(state, rng, rolls);
    return;
  }
  combat.round += 1;
  combat.phase = 'player';
}