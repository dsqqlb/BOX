import type { UnoCatalog, UnoLobbyRoom } from './types';

/** UNO 的 HTTP 接口只有两个：牌库目录与大厅列表（对局本身走 WebSocket）。 */

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || '请求失败，请稍后重试。');
  return body as T;
}

export function fetchUnoCatalog(): Promise<UnoCatalog> {
  return request<UnoCatalog>('/api/uno/catalog');
}

export async function fetchUnoRooms(): Promise<UnoLobbyRoom[]> {
  const body = await request<{ rooms: UnoLobbyRoom[] }>('/api/uno/rooms');
  return body.rooms || [];
}