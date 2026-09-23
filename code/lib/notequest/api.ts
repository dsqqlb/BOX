/**
 * NoteQuest 客户端接口封装：全部走受保护的 /api/notequest/*。
 * 未登录或没有 notequest 权限时服务端直接返回 401/403。
 *
 * 存档策略：改动先更新内存状态（UI 立刻响应），再用 RunSync 防抖 PATCH 到 SQLite；
 * 一局还没落过库时自动降级为 POST 创建。
 */

import type {
  DungeonRecordDetail, DungeonRecordSummary, GraveSummary, Hero, HeroRecord, RunState, RunSummary, SlotSummary,
} from './types';

export class NoteQuestApiError extends Error {}

export type RunDetail = RunSummary & { state: RunState | null };
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new NoteQuestApiError(body?.error || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function fetchRuns(slot = 0): Promise<RunSummary[]> {
  const body = await request<{ runs: RunSummary[] }>(`/api/notequest/runs?slot=${slot}`);
  return body.runs || [];
}

export async function fetchRun(id: string): Promise<RunDetail> {
  const body = await request<{ run: RunDetail }>(`/api/notequest/runs/${encodeURIComponent(id)}`);
  return body.run;
}

export async function createRunServer(state: RunState, title: string, slot = 0): Promise<RunDetail> {
  const body = await request<{ run: RunDetail }>('/api/notequest/runs', {
    method: 'POST',
    body: JSON.stringify({ title, state, slot, characterId: state.characterId, dungeonId: state.dungeonId }),
  });
  return body.run;
}

export async function updateRunServer(id: string, state: RunState, title?: string): Promise<RunDetail> {
  const body = await request<{ run: RunDetail }>(`/api/notequest/runs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(title ? { state, title } : { state }),
  });
  return body.run;
}

export async function deleteRunServer(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/notequest/runs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchGraves(slot = 0): Promise<GraveSummary[]> {
  const body = await request<{ graves: GraveSummary[] }>(`/api/notequest/graves?slot=${slot}`);
  return body.graves || [];
}

/* ── 存档栏位（一个账号三个，首页切换） ── */

export async function fetchSlots(): Promise<{ slots: SlotSummary[]; slotCount: number }> {
  const body = await request<{ slots: SlotSummary[]; slotCount: number }>('/api/notequest/slots');
  return { slots: body.slots || [], slotCount: body.slotCount ?? 3 };
}

/** 清空一个栏位：该栏位的存档、人物池、地牢图与墓地一起删掉，其他栏位不受影响。 */
export async function clearSlotServer(slot: number): Promise<void> {
  await request<{ success: boolean }>(`/api/notequest/slots/${slot}`, { method: 'DELETE' });
}

/* ── 人物池 ── */

export async function fetchCharacters(slot = 0): Promise<HeroRecord[]> {
  const body = await request<{ characters: HeroRecord[] }>(`/api/notequest/characters?slot=${slot}`);
  return body.characters || [];
}

/** 把建好的角色（掷骰或自定义）存进当前栏位的人物池。 */
export async function createCharacterServer(hero: Hero, slot = 0): Promise<HeroRecord> {
  const body = await request<{ character: HeroRecord }>('/api/notequest/characters', {
    method: 'POST',
    body: JSON.stringify({ hero, slot }),
  });
  return body.character;
}

export interface CharacterPatch {
  hero?: Hero;
  status?: 'active' | 'dead' | 'retired';
  lastOutcome?: string;
  incrementRuns?: boolean;
  incrementDeaths?: boolean;
}

export async function updateCharacterServer(id: string, patch: CharacterPatch): Promise<HeroRecord> {
  const body = await request<{ character: HeroRecord }>(`/api/notequest/characters/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body.character;
}

export async function deleteCharacterServer(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/notequest/characters/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ── 永久地牢 ── */

export async function fetchDungeons(slot = 0): Promise<DungeonRecordSummary[]> {
  const body = await request<{ dungeons: DungeonRecordSummary[] }>(`/api/notequest/dungeons?slot=${slot}`);
  return body.dungeons || [];
}

/** 按地牢类型取这个栏位里已经探索过的永久地图（没有就是 null，进去时建一座新的）。 */
export async function fetchDungeonByType(typeId: string, slot = 0): Promise<DungeonRecordDetail | null> {
  const body = await request<{ dungeon: DungeonRecordDetail | null }>(`/api/notequest/dungeons?typeId=${encodeURIComponent(typeId)}&slot=${slot}`);
  return body.dungeon ?? null;
}

export async function fetchDungeon(id: string): Promise<DungeonRecordDetail | null> {
  const body = await request<{ dungeon: DungeonRecordDetail | null }>(`/api/notequest/dungeons/${encodeURIComponent(id)}`);
  return body.dungeon ?? null;
}

/** 把这一局的地图（含遗体与掉落）写回当前栏位的永久地牢。 */
export async function saveDungeonServer(payload: {
  id?: string; typeId: string; name: string; depth: number; rooms: number; corpses: number;
  nodes: DungeonRecordDetail['nodes'];
}, slot = 0): Promise<DungeonRecordDetail> {
  const body = await request<{ dungeon: DungeonRecordDetail }>('/api/notequest/dungeons', {
    method: 'PUT',
    body: JSON.stringify({ ...payload, slot }),
  });
  return body.dungeon;
}

export async function deleteDungeonServer(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/notequest/dungeons/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 防抖同步器：把连续的改动合并成一次 PATCH（新建存档时会带上当前存档栏位）。 */
export class RunSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { id: string; state: RunState; title?: string } | null = null;
  private createdOnServer = false;
  private inFlight = false;
  private slot = 0;

  constructor(private readonly onStatus: (status: SyncStatus) => void, private readonly debounceMs = 700) {}

  /** 切换存档栏位时同步给同步器：新建的存档会落到这个栏位。 */
  setSlot(slot: number): void {
    this.slot = slot;
  }

  markCreated(value = true): void {
    this.createdOnServer = value;
  }

  queue(state: RunState, title?: string): void {
    this.pending = { id: state.id, state, title };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
    this.onStatus(this.inFlight ? 'saving' : 'idle');
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.pending;
    if (!pending || this.inFlight) return;
    this.pending = null;
    this.inFlight = true;
    this.onStatus('saving');
    try {
      if (this.createdOnServer) {
        try {
          await updateRunServer(pending.id, pending.state, pending.title);
        } catch (error) {
          // 记录可能被删掉了（例如换了设备清档）：重建而不是静默丢失
          if (error instanceof NoteQuestApiError) await createRunServer(pending.state, pending.title ?? pending.state.title, this.slot);
          else throw error;
        }
      } else {
        await createRunServer(pending.state, pending.title ?? pending.state.title, this.slot);
      }
      this.createdOnServer = true;
      this.onStatus('saved');
    } catch {
      this.onStatus('offline');
    } finally {
      this.inFlight = false;
      if (this.pending) void this.flush();
    }
  }
}