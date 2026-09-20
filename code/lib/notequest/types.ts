/**
 * NoteQuest 单人地牢探索（/tools/notequest）——类型定义。
 *
 * 这一层同时描述两类东西：
 *   1. 「规则数据」的形状：resources/content/notequest/*.json（服务端与前端共用一份）；
 *   2. 「运行状态」的形状：一局游戏 = 一条 NoteQuestRun.stateJson 快照。
 *
 * 想加内容（新地牢、新种族、新词缀、新物品）先看 resources/content/notequest/README.md，
 * 那份文档列出了每个 kind / trigger 由 engine.ts 里的哪个钩子实现。
 */

/* ── 规则数据 ── */

export type ArmorSlot = 'ring' | 'arm' | 'boots' | 'shoulder' | 'helmet' | 'chest';
export type RoomSize = 'small' | 'medium' | 'wide' | 'large';

export interface AbilityDef {
  id: string;
  /** 引擎钩子名，见 engine.ts 的 applyAbility */
  kind: string;
  text: string;
  spell?: string;
  count?: number;
  on?: string;
  amount?: number;
  affix?: string;
  exceptAffix?: string;
  roll?: number;
  damage?: string;
}

export interface RaceDef {
  roll: number;
  id: string;
  name: string;
  hp: number;
  ability: AbilityDef;
}

export interface WeaponSpec {
  name: string;
  damage: string;
  twoHanded?: boolean;
}

export interface ClassDef {
  roll: number;
  id: string;
  name: string;
  hpBonus: number;
  ability: AbilityDef;
  weapon: WeaponSpec;
}

export interface SpellDef {
  roll: number;
  id: string;
  name: string;
  effect: string;
  /** heal | light | teleport | damageStun | damage | damageRoom */
  kind: string;
  amount?: number;
}

export interface DoorTableEntry {
  roll: number;
  kind: 'trap' | 'locked' | 'open';
  text: string;
}

export interface LootEntry {
  rollMin: number;
  rollMax: number;
  kind: 'treasure' | 'key' | 'coin';
  amount: number;
  text: string;
}

export interface GrantDef {
  kind: 'coin' | 'treasure' | 'magic-item' | 'scroll';
  dice?: string;
  amount?: number;
  /** 每个单位额外折算的金币（例如「每幅画像价值2金币」） */
  perUnit?: number;
}

export interface SegmentEntry {
  roll: number;
  kind: 'corridor' | 'room' | 'stairs';
  size?: RoomSize;
  doors: number;
  pillars?: boolean;
  text: string;
}

export interface SegmentsTable {
  note?: string;
  stairs: SegmentEntry[];
  corridor: SegmentEntry[];
  room: SegmentEntry[];
}

export interface SecretPassageEntry {
  roll: number;
  kind: 'trap' | 'nothing' | 'chest' | 'stairs';
  text: string;
}

export interface ArmorTableEntry {
  roll: number;
  slot: ArmorSlot;
  name: string;
  hp: number;
}

export interface SpawnDef {
  name: string;
  en?: string;
  hp: number;
  damage: number;
  count?: number;
  countDice?: string;
  affixes?: string[];
}

export interface AffixDef {
  id: string;
  name: string;
  en?: string;
  text: string;
  /** ignoreDamageAtOrBelow | ignoreDamageOnEvenRoll | doubleDamageOnRoll6 | reviveOnDeathRoll1 | pierceArmor | grantLoot | onPlayerAttackRoll1 */
  trigger: string;
  value?: number;
  /** explode | nextDamage | nextDamageDice | summon | nextAttackKills | heal | nextAttackParalyze */
  effect?: string;
  monster?: SpawnDef;
  damage?: string;
}

export interface TrapEntry {
  roll: number;
  /** blade | damage | torch | monsters | nothing | blank */
  kind: string;
  text: string;
  damage?: number;
  torchCost?: number;
  dice?: string;
  outcomes?: { value: number; effect: 'death' | 'lose-arm'; text: string }[];
  spawn?: SpawnDef;
}

export interface RoomContentEntry {
  roll: number;
  text: string;
  hasSecretPassage?: boolean;
  chest?: boolean;
  bigChest?: boolean;
  portal?: boolean;
  grants?: GrantDef[];
}

export interface MonsterEntry {
  roll?: number;
  rollMin?: number;
  rollMax?: number;
  none?: boolean;
  text?: string;
  name?: string;
  en?: string;
  hp?: number;
  damage?: number;
  count?: number;
  countDice?: string;
  affixes?: string[];
}

export interface RewardEntry {
  roll: number;
  name?: string;
  text: string;
  /** sellable | potion-heal | potion-spells | scroll | roll-oddity | roll-magic | roll-weapon | armor | weapon */
  kind?: string;
  value?: number;
  valueDice?: string;
  valueMultiplier?: number;
  hpBonus?: number;
  damageBonus?: number;
  /** 道具的使用方式：light | luck | rage | arm | torch | learn-spell | heal | spells */
  use?: string;
}

export interface BossEntry {
  roll: number;
  intro?: string;
  name: string;
  en?: string;
  flavor?: string;
  hp: number;
  damage: number;
  count?: number;
  affixes?: string[];
}

export interface WeaponEntry {
  roll?: number;
  rollMin?: number;
  rollMax?: number;
  name: string;
  damage: string;
  twoHanded?: boolean;
}

export interface NoteQuestRules {
  startingTorches: number;
  maxTorches: number;
  maxItems: number;
  startingCoins: number;
  torchPrice: number;
  torchPerDungeonEntry: number;
  restCost: number;
  armorRepairCost: number;
  torchPerArmorRepair: number;
  itemSellPrice: number;
  maxDepth: number;
  finalRoomDepth: number;
  torchPerAction: number;
}

export interface CoreData {
  version: number;
  meta: { title: string; source: string; note?: string };
  rules: NoteQuestRules;
  races: RaceDef[];
  classes: ClassDef[];
  spells: SpellDef[];
  doors: DoorTableEntry[];
  secretPassages: SecretPassageEntry[];
  armors: ArmorTableEntry[];
  monsterAffixes: AffixDef[];
  chest: { dice: string; text: string };
  segments: SegmentsTable;
  loot: LootEntry[];
  combat: { id: string; name: string; text: string }[];
  dungeonActions: { id: string; name: string; torches: number; text: string }[];
  townActions: { id: string; name: string; cost: number; text: string }[];
  dungeonName: {
    note?: string;
    prefix: { roll: number; text: string }[];
    middle: { roll: number; text: string }[];
    suffix: { roll: number; text: string; typeId: string }[];
  };
}

export interface DungeonType {
  id: string;
  name: string;
  pageRef: number;
  icon?: string;
  intro: string;
  traps: TrapEntry[];
  roomContent: RoomContentEntry[];
  monsters: MonsterEntry[];
  rewards: { treasure: RewardEntry[]; oddity: RewardEntry[]; magic: RewardEntry[] };
  boss: BossEntry[];
  weapons: WeaponEntry[];
  /** 缺省共用 core.json 的表；写了就覆盖 */
  segments?: SegmentsTable;
  secretPassages?: SecretPassageEntry[];
  armors?: ArmorTableEntry[];
}

export interface DungeonsData {
  version: number;
  meta: { title: string; note?: string };
  types: DungeonType[];
}

/* ── 运行状态（存档快照） ── */

/** 物品统一成一个结构：护甲/武器/道具/财宝都走它，UI 与存档只认它。 */
export type ItemKind = 'treasure' | 'oddity' | 'armor' | 'weapon' | 'potion' | 'scroll' | 'key' | 'other';

export interface Item {
  uid: string;
  name: string;
  kind: ItemKind;
  text: string;
  /** 城镇出售价（0 = 卖不出钱） */
  value: number;
  magic: boolean;
  slot?: ArmorSlot;
  hp?: number;
  maxHp?: number;
  damage?: string;
  twoHanded?: boolean;
  damageBonus?: number;
  /** 提供光源（光亮术、油灯、荧光药水） */
  light?: boolean;
  /** 可使用：heal | spells | luck | rage | arm | torch | learn-spell | none */
  use?: string;
}

export interface Monster {
  uid: string;
  name: string;
  en?: string;
  hp: number;
  maxHp: number;
  damage: number;
  affixes: string[];
  /** 词缀留下的临时状态 */
  bonusDamage: number;
  killsOnHit: boolean;
  paralyzesOnHit: boolean;
  stunned: boolean;
  isBoss: boolean;
}

export interface DoorState {
  id: string;
  /** closed（还没掷骰）| locked | open（已打开，门后已确定）| broken */
  status: 'closed' | 'locked' | 'open' | 'broken';
  /** 门后连接到的节点 id（未打开时为 null） */
  to: string | null;
  /** 最近一次开门掷骰 */
  lastRoll?: number;
  /** 门是被砸开/硬闯的：进门时怪物先手 */
  forced?: boolean;
  /** 门后节点的房间内容还没结算过 */
  sealed?: boolean;
}

export interface ChestState {
  opened: boolean;
  big?: boolean;
}

export interface DungeonNode {
  id: string;
  /** entrance（入口片段）| corridor | room | stairs | boss */
  kind: string;
  size?: RoomSize;
  depth: number;
  doors: DoorState[];
  /** 房间内容掷骰结果 */
  contentRoll?: number;
  contentText?: string;
  hasSecretPassage?: boolean;
  secretPassageSearched?: boolean;
  /** 房间里的奖励还没被拾取 */
  pendingGrants?: GrantDef[];
  chest?: ChestState;
  monsters: Monster[];
  trapsActive: boolean;
  trapsRoll?: number;
  /** 战斗是否已经打完（房间里没有怪物 = true） */
  cleared: boolean;
  /** 安静移动成功：怪物还在，但暂时没发现你，可以穿过房间继续行动 */
  sneaked?: boolean;
  /** 战斗后留下的尸体（史莱姆人可以吞噬尸体回满 HP） */
  corpse?: { name: string; devoured: boolean };
  visited: boolean;
  /** 需要重新掷怪物表（返回地牢后重进空房间） */
  needsMonsterReroll?: boolean;
  /** 布局坐标（由 map.ts 计算，存档里也留着，便于读档立刻画图） */
  x: number;
  y: number;
}

export interface LogEntry {
  id: string;
  at: number;
  /** roll | info | combat | loot | town | death | table | warn */
  kind: string;
  text: string;
}

export interface RollRecord {
  id: string;
  notation: string;
  label: string;
  total: number;
  detail: string;
}

export interface Hero {
  name: string;
  raceId: string;
  raceName: string;
  classId: string;
  className: string;
  hp: number;
  maxHp: number;
  /** 种族 HP + 职业修正（不含装备） */
  baseHp: number;
  abilityNotes: string[];
  weapon: WeaponSpec & { magic?: boolean; damageBonus?: number; note?: string };
  spareWeapons: (WeaponSpec & { magic?: boolean; damageBonus?: number; note?: string })[];
  armors: Item[];
  spells: { spellId: string; name: string; effect: string; spent: boolean }[];
  torches: number;
  coins: number;
  /** 财宝个数（1 财宝 ≈ 1 件战利品，掷奖励表用） */
  treasure: number;
  keys: number;
  items: Item[];
  /** 失去一条手臂：不能再用双手武器 */
  lostArm: boolean;
  /** 有替代光源（光亮术/油灯）时双手可用 */
  hasLight: boolean;
  /** 被瘫痪的剩余回合 */
  stunned: number;
  /** 吞噬过敌人尸体（史莱姆人能力） */
  devoured: boolean;
  /** 下一次陷阱可以被无视（幸运药水等） */
  trapShield: number;
}

export interface CombatState {
  nodeId: string;
  round: number;
  /** player | monster | over */
  phase: string;
  initiative: 'player' | 'monsters';
  /** 怪物回合的伤害还没分配 */
  pendingDamage: number;
  pendingDamageFrom: string;
  /** 剧毒等：这笔伤害不能由护甲吸收 */
  pendingDamageUnabsorbable: boolean;
  /** 等待玩家选择承受对象 */
  awaitingDamageTarget: boolean;
  /** 狂怒药水：本场战斗伤害 +2 */
  raging?: boolean;
  log: string[];
}

export interface TownState {
  /** 人在城镇（需要先进入地牢才能继续探索） */
  inTown: boolean;
  /** 返回地牢后需要为每个空房间重掷怪物表 */
  needsMonsterReroll: boolean;
}

export interface RunStats {
  kills: number;
  treasures: number;
  coinsFound: number;
  deepestDepth: number;
  turns: number;
  trapsTriggered: number;
  chestsOpened: number;
}

export interface RunState {
  version: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  /** active | dead | cleared */
  status: 'active' | 'dead' | 'cleared';
  title: string;
  dungeon: {
    typeId: string;
    name: string;
    intro: string;
    depth: number;
    entered: boolean;
    nodes: DungeonNode[];
    currentId: string;
    /** 进入地牢时又消耗了几个火把（多次往返时记录） */
    entries: number;
  };
  hero: Hero;
  combat: CombatState | null;
  town: TownState;
  log: LogEntry[];
  stats: RunStats;
  /** 结局信息（死亡原因 / 通关总结） */
  outcome: { kind: string; text: string; at: number } | null;
}

/** 服务器返回的存档摘要（列表用，不含整包状态） */
export interface RunSummary {
  id: string;
  title: string;
  heroName: string;
  raceName: string;
  className: string;
  dungeonTypeId: string;
  dungeonName: string;
  depth: number;
  status: string;
  turns: number;
  kills: number;
  treasures: number;
  coins: number;
  torches: number;
  hp: number;
  maxHp: number;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  outcomeText: string;
}

export interface GraveSummary {
  id: string;
  runId: string | null;
  characterName: string;
  raceName: string;
  className: string;
  dungeonName: string;
  dungeonTypeId: string;
  depth: number;
  cause: string;
  kills: number;
  treasures: number;
  diedAt: string;
}