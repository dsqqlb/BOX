/**
 * EDH 记血器的持久化。
 *
 * 两层：
 *   1. localStorage —— 立即生效的唯一运行时数据源。记血是"点一下就有结果"的操作，
 *      不能等网络；刷新页面也必须不丢。
 *   2. SQLite（/api/edh-life/*）—— 后台防抖同步，一条记录 = 一局对战，
 *      带时长与掷骰历史，供以后查看/恢复/统计。
 *
 * 服务器不可用时（未登录、断网、接口报错）只降级为"仅本机保存"，
 * 绝不因为同步失败而丢掉本地这局。
 */

import type { GameState, PlayerState, RollRecord } from './types';
import { COUNTER_KEYS, createGame, elapsedSeconds, newId } from './types';

const STORAGE_KEY = 'edh-life-games';
const CURRENT_KEY = 'edh-life-current';
const MAX_LOCAL_GAMES = 20;

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

interface StoredGames {
  [gameId: string]: GameState;
}

function hasStorage(): boolean {
  // 无头浏览器 / 隐私模式下 localStorage 可能直接抛异常，
  // 这时整个记血器仍要能跑（只是不落盘），所以所有访问都先探一次。
  if (typeof window === 'undefined') return true;
  try {
    const probe = '__edh_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readGames(): StoredGames {
  if (typeof window === 'undefined' || !hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredGames) : {};
  } catch {
    return {};
  }
}

function writeGames(games: StoredGames): void {
  if (typeof window === 'undefined' || !hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  } catch (error) {
    console.error('[edh-life] 本地保存失败：', error);
  }
}

export function loadCurrentGameId(): string | null {
  if (typeof window === 'undefined' || !hasStorage()) return null;
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentGameId(id: string | null): void {
  if (typeof window === 'undefined' || !hasStorage()) return;
  try {
    if (id) window.localStorage.setItem(CURRENT_KEY, id);
    else window.localStorage.removeItem(CURRENT_KEY);
  } catch { /* 忽略 */ }
}

/** 本机保存一局（立即生效，不等待服务器）。 */
export function saveGameLocal(state: GameState): void {
  const games = readGames();
  games[state.id] = state;
  const ids = Object.keys(games);
  if (ids.length > MAX_LOCAL_GAMES) {
    // 超量时先淘汰最旧的"已结束"对局，正在进行的永远保留
    const finished = ids.filter((id) => games[id].status === 'finished').sort((a, b) => games[a].startedAt - games[b].startedAt);
    for (const id of finished) {
      if (Object.keys(games).length <= MAX_LOCAL_GAMES) break;
      delete games[id];
    }
  }
  writeGames(games);
}

export function loadGameLocal(id: string): GameState | null {
  const games = readGames();
  return games[id] || null;
}

export function listGamesLocal(): GameState[] {
  return Object.values(readGames()).sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteGameLocal(id: string): void {
  const games = readGames();
  delete games[id];
  writeGames(games);
}

/* ============================================================
   客户端状态 ↔ 服务器载荷
============================================================ */

export interface ServerPlayerPayload extends Record<string, unknown> {
  seat: number;
  name: string;
  color: string;
  life: number;
  eliminated: boolean;
  eliminatedReason: string | null;
}

export function toServerPlayers(players: PlayerState[]): ServerPlayerPayload[] {
  return players.map((player) => {
    const payload: ServerPlayerPayload = {
      seat: player.seat,
      name: player.name,
      color: player.color,
      life: player.life,
      eliminated: player.eliminated,
      eliminatedReason: player.eliminatedReason,
    };
    for (const key of COUNTER_KEYS) payload[key] = player[key];
    return payload;
  });
}

/** 服务器记录 → 客户端状态。stateJson 是权威快照，缺了就用座位行重建。 */
export function fromServerGame(serverGame: {
  id: string;
  title: string;
  playerCount: number;
  startingLife: number;
  round: number;
  status: string;
  winnerSeat: number | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  players: ServerPlayerPayload[];
  state: GameState | null;
}): GameState {
  if (serverGame.state && Array.isArray(serverGame.state.players) && serverGame.state.players.length) {
    // 快照里的 id/时间可能与服务器行不一致，以服务器行为准补齐。
    // 另外：离开页面会暂停计时，所以恢复时一律按"暂停"状态回来（由「开始对局」继续）。
    return {
      ...serverGame.state,
      id: serverGame.id,
      title: serverGame.title,
      status: serverGame.status === 'finished' ? 'finished' : 'running',
      startedAt: new Date(serverGame.startedAt).getTime() || serverGame.state.startedAt,
      durationSeconds: serverGame.durationSeconds,
      timer: {
        base: serverGame.durationSeconds * 1000,
        running: false,
        startedAtMs: Date.now(),
      },
    };
  }
  const startedAt = new Date(serverGame.startedAt).getTime() || Date.now();
  const fallback = createGame(Math.max(2, serverGame.playerCount), serverGame.startingLife);
  return {
    ...fallback,
    id: serverGame.id,
    title: serverGame.title,
    playerCount: serverGame.playerCount,
    startingLife: serverGame.startingLife,
    round: serverGame.round,
    status: serverGame.status === 'finished' ? 'finished' : 'running',
    winnerSeat: serverGame.winnerSeat,
    startedAt,
    endedAt: serverGame.endedAt ? new Date(serverGame.endedAt).getTime() : null,
    timer: { base: serverGame.durationSeconds * 1000, running: serverGame.status !== 'finished', startedAtMs: Date.now() },
    rolls: [],
    players: serverGame.players.map((player) => ({
      seat: player.seat,
      name: String(player.name ?? `玩家 ${player.seat + 1}`),
      color: String(player.color ?? '#888888'),
      life: Number(player.life ?? 0),
      energy: Number(player.energy ?? 0),
      treasure: Number(player.treasure ?? 0),
      clue: Number(player.clue ?? 0),
      food: Number(player.food ?? 0),
      poison: Number(player.poison ?? 0),
      experience: Number(player.experience ?? 0),
      eliminated: Boolean(player.eliminated),
      eliminatedReason: (player.eliminatedReason as string | null) ?? null,
    })),
  };
}

/* ============================================================
   与服务器通信
============================================================ */

async function request<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface ServerGameResponse {
  game: Parameters<typeof fromServerGame>[0] | null;
}

/** 历史列表用的摘要（服务器返回的形状 + 本机来源标记）。 */
export interface GameSummary {
  id: string;
  title: string;
  playerCount: number;
  startingLife: number;
  round: number;
  status: string;
  winnerSeat: number | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  updatedAt: string;
  players: ServerPlayerPayload[];
  /** true 表示这条来自服务器（读档会先去服务器取详情） */
  fromServer?: boolean;
}

export async function fetchRunningGame(): Promise<GameState | null> {
  const data = await request<ServerGameResponse>('/api/edh-life/games/running');
  if (!data?.game) return null;
  try {
    return fromServerGame(data.game);
  } catch {
    return null;
  }
}

/** 历史列表（服务器）。服务器不可用时返回 null，由调用方决定怎么提示。 */
export async function fetchGames(options: { onlyFinished?: boolean } = {}): Promise<GameSummary[] | null> {
  const data = await request<{ games?: GameSummary[] }>('/api/edh-life/games');
  if (!data || !Array.isArray(data.games)) return null;
  const list = data.games.map((entry) => ({ ...entry, fromServer: true }));
  // 存档 = 已经结束的对局；正在进行的对局单独用于"继续上一局"
  return options.onlyFinished ? list.filter((entry) => entry.status === 'finished') : list;
}

/** 删除一局（本机 + 服务器）。服务器删不掉也至少把本机那份清掉。 */
export async function deleteGame(id: string): Promise<boolean> {
  deleteGameLocal(id);
  if (loadCurrentGameId() === id) setCurrentGameId(null);
  const data = await request<{ success?: boolean }>(`/api/edh-life/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return Boolean(data?.success);
}

/** 单局详情（含完整快照），用于读档。 */
export async function fetchGame(id: string): Promise<GameState | null> {
  const data = await request<ServerGameResponse>(`/api/edh-life/games/${encodeURIComponent(id)}`);
  if (!data?.game) return null;
  try {
    return fromServerGame(data.game);
  } catch {
    return null;
  }
}

export async function createGameOnServer(state: GameState): Promise<boolean> {
  const data = await request<ServerGameResponse>('/api/edh-life/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gamePayload(state, true)),
  });
  return Boolean(data?.game);
}

export async function updateGameOnServer(state: GameState): Promise<boolean> {
  const data = await request<ServerGameResponse>(`/api/edh-life/games/${encodeURIComponent(state.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gamePayload(state, false)),
  });
  return Boolean(data?.game);
}

export async function pushRoll(state: GameState, roll: RollRecord): Promise<boolean> {
  const data = await request<{ roll: unknown }>(`/api/edh-life/games/${encodeURIComponent(state.id)}/rolls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      at: new Date(roll.at).toISOString(),
      source: roll.source,
      notation: roll.notation,
      total: roll.total,
      seat: roll.seat,
      detail: { values: roll.values, coinFace: roll.coinFace ?? null },
    }),
  });
  return Boolean(data?.roll);
}

function gamePayload(state: GameState, isCreate: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: state.title,
    startingLife: state.startingLife,
    round: state.round,
    status: state.status,
    winnerSeat: state.winnerSeat,
    durationSeconds: elapsedSeconds(state),
    players: toServerPlayers(state.players),
    state,
  };
  if (isCreate) {
    payload.startedAt = new Date(state.startedAt).toISOString();
  }
  if (state.status === 'finished' && state.endedAt) {
    payload.endedAt = new Date(state.endedAt).toISOString();
  }
  return payload;
}

/**
 * 防抖同步器：改动只写 localStorage，服务器写入合并到一次 PATCH。
 * 首局（服务器还没有这条记录）自动降级为 POST 创建。
 */
export class GameSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: GameState | null = null;
  private createdOnServer = false;
  private inFlight = false;
  private lastError = false;

  constructor(
    private readonly onStatus: (status: SyncStatus) => void,
    private readonly debounceMs = 700,
  ) {}

  markCreated(): void {
    this.createdOnServer = true;
  }

  setCreated(value: boolean): void {
    this.createdOnServer = value;
  }

  get isCreated(): boolean {
    return this.createdOnServer;
  }

  queue(state: GameState): void {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
    this.onStatus(this.inFlight ? 'saving' : 'idle');
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const state = this.pending;
    if (!state || this.inFlight) return;
    this.pending = null;
    this.inFlight = true;
    this.onStatus('saving');
    try {
      let ok = this.createdOnServer ? await updateGameOnServer(state) : await createGameOnServer(state);
      if (!ok && this.createdOnServer) {
        // 记录可能被删掉了：重建而不是静默丢失
        ok = await createGameOnServer(state);
      }
      if (ok) {
        this.createdOnServer = true;
        this.lastError = false;
        this.onStatus('saved');
      } else {
        this.lastError = true;
        this.onStatus('offline');
      }
    } catch {
      this.lastError = true;
      this.onStatus('offline');
    } finally {
      this.inFlight = false;
      // 同步期间又有新改动：再排一次
      if (this.pending) void this.flush();
    }
  }

  /** 掷骰要立刻落库（历史面板依赖它），所以不等防抖。 */
  async saveRoll(state: GameState, roll: RollRecord): Promise<void> {
    if (!this.createdOnServer) await this.flush();
    const ok = await pushRoll(state, roll);
    if (!ok) this.onStatus('offline');
  }
}

export function makeRollId(): string {
  return newId('roll');
}
