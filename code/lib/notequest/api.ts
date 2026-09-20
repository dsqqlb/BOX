/**
 * NoteQuest 客户端接口封装：全部走受保护的 /api/notequest/*。
 * 未登录或没有 notequest 权限时服务端直接返回 401/403。
 *
 * 存档策略：改动先更新内存状态（UI 立刻响应），再用 RunSync 防抖 PATCH 到 SQLite；
 * 一局还没落过库时自动降级为 POST 创建。
 */

import type { GraveSummary, RunState, RunSummary } from './types';

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

export async function fetchRuns(): Promise<RunSummary[]> {
  const body = await request<{ runs: RunSummary[] }>('/api/notequest/runs');
  return body.runs || [];
}

export async function fetchRun(id: string): Promise<RunDetail> {
  const body = await request<{ run: RunDetail }>(`/api/notequest/runs/${encodeURIComponent(id)}`);
  return body.run;
}

export async function createRunServer(state: RunState, title: string): Promise<RunDetail> {
  const body = await request<{ run: RunDetail }>('/api/notequest/runs', {
    method: 'POST',
    body: JSON.stringify({ title, state }),
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

export async function fetchGraves(): Promise<GraveSummary[]> {
  const body = await request<{ graves: GraveSummary[] }>('/api/notequest/graves');
  return body.graves || [];
}

/** 防抖同步器：把连续的改动合并成一次 PATCH。 */
export class RunSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { id: string; state: RunState; title?: string } | null = null;
  private createdOnServer = false;
  private inFlight = false;

  constructor(private readonly onStatus: (status: SyncStatus) => void, private readonly debounceMs = 700) {}

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
          if (error instanceof NoteQuestApiError) await createRunServer(pending.state, pending.title ?? pending.state.title);
          else throw error;
        }
      } else {
        await createRunServer(pending.state, pending.title ?? pending.state.title);
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