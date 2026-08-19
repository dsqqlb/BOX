import { EdhCard, EdhCardsMeta, EdhDeck, EdhSearchFilters, EdhSearchResult } from './types';

class EdhApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new EdhApiError(body?.error || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function buildSearchQuery(filters: EdhSearchFilters, limit = 60): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.colors.length > 0) params.set('colors', filters.colors.join(','));
  params.set('colorMode', filters.colorMode);
  if (filters.types.length > 0) params.set('types', filters.types.join(','));
  if (filters.cmcMin !== null) params.set('cmcMin', String(filters.cmcMin));
  if (filters.cmcMax !== null) params.set('cmcMax', String(filters.cmcMax));
  if (filters.commanderOnly) params.set('commanderOnly', '1');
  params.set('limit', String(limit));
  return params.toString();
}

export function searchCards(filters: EdhSearchFilters, limit = 60): Promise<EdhSearchResult> {
  return request<EdhSearchResult>(`/api/edh/cards/search?${buildSearchQuery(filters, limit)}`);
}

export function getCardsMeta(): Promise<EdhCardsMeta> {
  return request<EdhCardsMeta>('/api/edh/cards/meta');
}

export function lookupCards(oracleIds: string[]): Promise<EdhCard[]> {
  if (oracleIds.length === 0) return Promise.resolve([]);
  return request<EdhCard[]>(`/api/edh/cards/lookup?ids=${oracleIds.map(encodeURIComponent).join(',')}`);
}

export function listDecks(): Promise<EdhDeck[]> {
  return request<EdhDeck[]>('/api/edh/decks');
}

export function createDeck(name: string): Promise<EdhDeck> {
  return request<EdhDeck>('/api/edh/decks', { method: 'POST', body: JSON.stringify({ name }) });
}

export function updateDeck(deckId: string, patch: Partial<Pick<EdhDeck, 'name' | 'commanderOracleId' | 'cards'>>): Promise<EdhDeck> {
  return request<EdhDeck>(`/api/edh/decks/${encodeURIComponent(deckId)}`, { method: 'PUT', body: JSON.stringify(patch) });
}

export function deleteDeck(deckId: string): Promise<{ success: boolean }> {
  return request(`/api/edh/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
}

export { EdhApiError };
