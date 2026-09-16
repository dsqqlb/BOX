/**
 * EDH 指挥官记血器 —— 类型与纯函数工具。
 *
 * 这里只放不依赖 React 的东西：座位/计数器的数据结构、随机配色、
 * 骰式与硬币表达式、判负判定。页面组件负责状态与交互。
 */

/** 六个常用计数器：能量 / 珍宝 / 线索 / 食物 / 中毒 / 经验。 */
export const COUNTER_KEYS = ['energy', 'treasure', 'clue', 'food', 'poison', 'experience'] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export interface CounterMeta {
  key: CounterKey;
  label: string;
  /** 简短别名：色块上位置紧张时用 */
  short: string;
  icon: string;
  /** 该计数器满多少算输（中毒 10）；null 表示只是资源，没有上限 */
  lethalAt: number | null;
}

export const COUNTERS: CounterMeta[] = [
  { key: 'energy', label: '能量', short: '能', icon: '⚡', lethalAt: null },
  { key: 'treasure', label: '珍宝', short: '宝', icon: '💰', lethalAt: null },
  { key: 'clue', label: '线索', short: '线', icon: '🔍', lethalAt: null },
  { key: 'food', label: '食物', short: '食', icon: '🍖', lethalAt: null },
  { key: 'poison', label: '中毒', short: '毒', icon: '☠', lethalAt: 10 },
  { key: 'experience', label: '经验', short: '验', icon: '✦', lethalAt: null },
];

export const COUNTER_BY_KEY: Record<CounterKey, CounterMeta> = COUNTERS.reduce((acc, meta) => {
  acc[meta.key] = meta;
  return acc;
}, {} as Record<CounterKey, CounterMeta>);

/** 色块左右两侧各放 3 个计数器。 */
/**
 * 六种计数器按一行横排（毛玻璃圆角方块，放在色块下方）。
 * 保留成"列"的分组只是为了给页面按左右两半渲染留余地。
 */
export const COUNTER_COLUMNS: CounterKey[][] = [
  ['energy', 'treasure', 'clue'],
  ['food', 'poison', 'experience'],
];

export const LETHAL_POISON = 10;
export const DEFAULT_STARTING_LIFE = 40;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** 一个座位：基础信息 + 六个计数器（用 Record 交叉，player[key] 可直接索引）。 */
export type PlayerState = {
  seat: number;
  name: string;
  color: string;
  life: number;
  eliminated: boolean;
  eliminatedReason: string | null;
} & Record<CounterKey, number>;

export interface RollRecord {
  id: string;
  at: number;
  source: 'dice' | 'coin';
  notation: string;
  total: number;
  seat: number | null;
  /** 每颗骰子的点数明细（硬币存全部面值） */
  values: number[];
  /** 硬币专用：正面「1」还是反面「日」 */
  coinFace?: 'one' | 'sun';
}

export interface GameState {
  id: string;
  title: string;
  playerCount: number;
  startingLife: number;
  round: number;
  status: 'running' | 'finished';
  winnerSeat: number | null;
  startedAt: number;
  endedAt: number | null;
  /** 已封存的对局时长（秒）；进行中的对局以 timer 为准，这个值在结束时写入 */
  durationSeconds: number;
  /** 计时器：base 是已累计毫秒，running 时再加上 startedAtMs 到现在的部分 */
  timer: { base: number; running: boolean; startedAtMs: number };
  rolls: RollRecord[];
  players: PlayerState[];
}

/* ============================================================
   随机配色
   ------------------------------------------------------------
   四人同桌要一眼分清谁是谁，所以不能纯随机取色（可能撞成两坨
   相近的紫）。做法：随机一个起始色相，再按 360/人数 均分取色，
   保证两两色相差 ≥ 60°（4 人时是 90°），最后加一点随机抖动但
   不破坏最小间距。饱和度和亮度逐个微调，避免"看起来像同一个色"。
============================================================ */

export const MIN_HUE_GAP = 60;

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(Math.max(s, 0), 100) / 100;
  const light = Math.min(Math.max(l, 0), 100) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
      : hue < 180 ? [0, c, x]
        : hue < 240 ? [0, x, c]
          : hue < 300 ? [x, 0, c]
            : [c, 0, x];
  const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 两两色相最小间距（用于自检与测试）。 */
export function minHueGap(colors: string[]): number {
  const hues = colors.map(hexToHue).sort((a, b) => a - b);
  if (hues.length < 2) return 360;
  let gap = 360;
  for (let i = 0; i < hues.length; i++) {
    const next = hues[(i + 1) % hues.length];
    const delta = i === hues.length - 1 ? hues[0] + 360 - hues[i] : next - hues[i];
    gap = Math.min(gap, delta);
  }
  return gap;
}

export function hexToHue(hex: string): number {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((hue * 60) % 360 + 360) % 360;
}

/**
 * 为 count 个座位随机分配一组颜色。
 * 保证：两两色相间距 ≥ MIN_HUE_GAP；饱和度/亮度各自不同，避免撞色。
 */
export function randomSeatColors(count: number, random: () => number = Math.random): string[] {
  const base = random() * 360;
  const step = 360 / Math.max(count, 1);
  // 抖动范围：保证 step - 2*jitter >= MIN_HUE_GAP
  const jitter = Math.max(0, Math.min(14, (step - MIN_HUE_GAP) / 2));
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = base + i * step + (random() * 2 - 1) * jitter;
    const sat = 62 + random() * 26;          // 62% ~ 88%
    const light = 48 + (i % 2 === 0 ? 0 : 7) + random() * 6;   // 相邻座位明暗错开
    colors.push(hslToHex(hue, sat, light));
  }
  return colors;
}

/** 按背景色亮度决定叠在上面的文字用黑还是白，保证任何随机色上都读得清。 */
export function readableTextColor(hex: string): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // ITU-R BT.601 亮度
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 150 ? '#101010' : '#f5f5f5';
}

/** 同色系的浅色描边，用于色块边框/计数徽章，让色块更像"一块牌"。 */
export function lighten(hex: string, amount = 0.35): string {
  const value = hex.replace('#', '');
  const channel = (start: number) => {
    const c = parseInt(value.slice(start, start + 2), 16);
    return Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

export function darken(hex: string, amount = 0.45): string {
  const value = hex.replace('#', '');
  const channel = (start: number) => {
    const c = parseInt(value.slice(start, start + 2), 16);
    return Math.round(c * (1 - amount)).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/* ============================================================
   判负
============================================================ */

export function eliminationReason(player: PlayerState): string | null {
  if (player.poison >= LETHAL_POISON) return '中毒';
  if (player.life <= 0) return '生命归零';
  return null;
}

/** 血量归零或中毒满 10 即出局；两个条件都解除后自动复活（方便误判回退）。 */
export function applyElimination(player: PlayerState): PlayerState {
  const reason = eliminationReason(player);
  return {
    ...player,
    eliminated: reason !== null,
    eliminatedReason: reason,
  };
}

/* ============================================================
   骰式
============================================================ */

/** 骰子弹窗里的默认预设（可在设置里改）。 */
export const DEFAULT_DICE_PRESETS = ['1d20', '1d6'];
export const MAX_DICE_PRESETS = 6;
export const MIN_DICE_PRESETS = 1;

/** 硬币：引擎内置的 d2 硬币骰，两面是"正 / 反"。 */
export const COIN_NOTATION = '1d2';
/**
 * 投掷力度：引擎把表达式里的 '!' 当力度倍数（每个 '!' = +4，最多 3 个）。
 * 默认力度对硬币来说太小、几乎不翻面，所以要显式加满，才有"快速多次翻转"的观感。
 */
export const COIN_ROLL_NOTATION = '1d2!!!';

/**
 * 引擎返回的硬币面值 → 面别。
 *
 * DICE.dc 里 labels 是 [tail.png, heads.png]、values 是 [0, 1]，
 * 引擎取的是"翻到的面在 values 里的值 + 1"，所以会拿到 1 或 2：
 *   1 → tail.png（我们画的是数字 2）
 *   2 → heads.png（我们画的是数字 1）
 */
export function coinFaceForValue(value: number): 'one' | 'sun' {
  return value === 1 ? 'sun' : 'one';
}

/** 硬币两面的名字：数字 1 / 数字 2。 */
export function coinLabel(face: 'one' | 'sun'): string {
  return face === 'one' ? '1' : '2';
}

/* ============================================================
   其它小工具
============================================================ */

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

export function elapsedMs(state: GameState, now: number = Date.now()): number {
  const { base, running, startedAtMs } = state.timer;
  return base + (running ? Math.max(0, now - startedAtMs) : 0);
}

export function elapsedSeconds(state: GameState, now: number = Date.now()): number {
  return Math.floor(elapsedMs(state, now) / 1000);
}

export function formatClock(date: number): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function defaultTitle(date: number): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 的对局`;
}

let idCounter = 0;
export function newId(prefix = 'edh'): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${random}`;
}

export function createPlayer(seat: number, color: string, startingLife: number): PlayerState {
  return {
    seat,
    name: `玩家 ${seat + 1}`,
    color,
    life: startingLife,
    energy: 0,
    treasure: 0,
    clue: 0,
    food: 0,
    poison: 0,
    experience: 0,
    eliminated: false,
    eliminatedReason: null,
  };
}

export function createGame(playerCount: number, startingLife = DEFAULT_STARTING_LIFE, random: () => number = Math.random): GameState {
  const now = Date.now();
  const colors = randomSeatColors(playerCount, random);
  return {
    id: newId('game'),
    title: defaultTitle(now),
    playerCount,
    startingLife,
    round: 1,
    status: 'running',
    winnerSeat: null,
    startedAt: now,
    endedAt: null,
    durationSeconds: 0,
    timer: { base: 0, running: true, startedAtMs: now },
    rolls: [],
    players: Array.from({ length: playerCount }, (_, seat) => createPlayer(seat, colors[seat], startingLife)),
  };
}

/** 动态调整人数：保留已有座位的数据，新增座位给新随机色。 */
export function resizeGame(state: GameState, playerCount: number): GameState {
  const count = Math.min(Math.max(playerCount, MIN_PLAYERS), MAX_PLAYERS);
  if (count === state.players.length) return state;
  if (count < state.players.length) {
    return { ...state, playerCount: count, players: state.players.slice(0, count) };
  }
  const colors = randomSeatColors(count);
  const players = [...state.players];
  for (let seat = players.length; seat < count; seat++) {
    players.push(createPlayer(seat, colors[seat], state.startingLife));
  }
  return { ...state, playerCount: count, players };
}

/* ============================================================
   屏幕排布
   ------------------------------------------------------------
   2×2 中心对称：**靠近自己这一排是正的，对面那一排上下颠倒**。
   所以下排（seat 0/1）不旋转，上排（seat 2/3）旋转 180°。
   2 人时下方一个（seat 0）、上方一个（seat 1）；3 人时下方两个、上方一个。
============================================================ */

export const SEAT_ROTATION: Record<number, number[]> = {
  2: [0, 180],           // 下方（seat 0）/ 上方（seat 1）
  3: [0, 0, 180],        // 下方两个（seat 0/1），上方一个（seat 2）
  4: [0, 0, 180, 180],   // 下排 seat 0/1，上排 seat 2/3
};

export function seatRotation(playerCount: number, seat: number): number {
  const table = SEAT_ROTATION[playerCount] || SEAT_ROTATION[4];
  return table[seat] ?? 0;
}

/**
 * 座位在网格里的位置。
 * CSS 用属性选择器按 data-seat 排布，这里返回的行列与 app/tools/edh-life/edh-life.css 保持一致：
 *   - 2 人：seat 0 在下行、seat 1 在上行
 *   - 3 人：seat 0/1 在下行（左右），seat 2 在上行（居中）
 *   - 4 人：seat 0/1 在上行、seat 2/3 在下行——但旋转值让"近自己的一排"是正的
 *     （见 SEAT_ROTATION：下排 0°，上排 180°）
 */
export function seatGridPosition(playerCount: number, seat: number): { row: number; col: number } {
  if (playerCount === 2) return seat === 0 ? { row: 1, col: 0 } : { row: 0, col: 0 };
  if (playerCount === 3) return seat < 2 ? { row: 1, col: seat } : { row: 0, col: 0 };
  return seat < 2 ? { row: 1, col: seat } : { row: 0, col: seat - 2 };
}
