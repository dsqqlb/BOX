import {
  ScratchBuyPayload, ScratchCatalog, ScratchLedgerPayload, ScratchProfile,
  ScratchRedeemPayload, ScratchRevealPayload, ScratchShredPayload, ScratchTicket, ScratchTicketsPayload,
} from './types';

/** 刮刮乐接口封装：全部走受保护的 /api/scratch/*，未登录或没权限时服务端直接返回 401/403。 */

export class ScratchApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ScratchApiError(body?.error || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchProfile(): Promise<ScratchProfile> {
  return request<ScratchProfile>('/api/scratch/profile');
}

export function fetchCatalog(): Promise<ScratchCatalog> {
  return request<ScratchCatalog>('/api/scratch/catalog');
}

export function fetchTickets(): Promise<ScratchTicketsPayload> {
  return request<ScratchTicketsPayload>('/api/scratch/tickets');
}

export function fetchLedger(): Promise<ScratchLedgerPayload> {
  return request<ScratchLedgerPayload>('/api/scratch/ledger');
}

export function buyTicket(kind: string): Promise<ScratchBuyPayload> {
  return request<ScratchBuyPayload>('/api/scratch/tickets', { method: 'POST', body: JSON.stringify({ kind }) });
}

/** 保存桌面坐标（拖动松手时调用）。 */
export function saveTicketPosition(id: string, patch: { posX?: number; posY?: number; z?: number }): Promise<{ ticket: ScratchTicket }> {
  return request(`/api/scratch/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/** 刮开揭晓：达到票种阈值后服务端确认结算（没中奖也算结算，只是 prize = 0）。 */
export function revealTicket(id: string, scratchRatio: number): Promise<ScratchRevealPayload> {
  return request<ScratchRevealPayload>(`/api/scratch/tickets/${encodeURIComponent(id)}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ scratchRatio }),
  });
}

/** 兑奖：把中奖的票送进兑奖机，钱进与德州扑克共用的那份余额。 */
export function redeemTicket(id: string): Promise<ScratchRedeemPayload> {
  return request<ScratchRedeemPayload>(`/api/scratch/tickets/${encodeURIComponent(id)}/redeem`, { method: 'POST' });
}

/** 碎纸：把票送进碎纸机，产出纸屑。 */
export function shredTicket(id: string): Promise<ScratchShredPayload> {
  return request<ScratchShredPayload>(`/api/scratch/tickets/${encodeURIComponent(id)}/shred`, { method: 'POST' });
}