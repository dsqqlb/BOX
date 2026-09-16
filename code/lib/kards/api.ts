import { KardsCatalog, KardsDeck } from './types';

class KardsApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new KardsApiError(body?.error || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchCatalog(): Promise<KardsCatalog> {
  return request<KardsCatalog>('/api/kards/cards');
}

export function listDecks(): Promise<KardsDeck[]> {
  return request<KardsDeck[]>('/api/kards/decks');
}

export function createDeck(name: string, cards: string[]): Promise<KardsDeck> {
  return request<KardsDeck>('/api/kards/decks', { method: 'POST', body: JSON.stringify({ name, cards }) });
}

export function updateDeck(id: string, patch: Partial<Pick<KardsDeck, 'name' | 'faction' | 'cards'>>): Promise<KardsDeck> {
  return request<KardsDeck>(`/api/kards/decks/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
}

export function deleteDeck(id: string): Promise<{ success: boolean }> {
  return request(`/api/kards/decks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export { KardsApiError };
