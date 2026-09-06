export type Side = 0 | 1; // 0 = 左侧玩家（秦），1 = 右侧玩家（马）

export interface CarcassonnePlayer {
  name: string;
  score: number;
  items: [number, number, number]; // 酒 / 粮 / 布
}

export interface ContestedToken {
  count: number;
  holder: Side;
}

export interface CarcassonneState {
  player1: CarcassonnePlayer;
  player2: CarcassonnePlayer;
  king: ContestedToken;
  thief: ContestedToken;
}

export interface CarcassonneSave {
  id: string;
  title: string;
  state: CarcassonneState;
  createdAt: string;
}

export const ITEM_LABELS = ['酒', '粮', '布'] as const;

export function createDefaultState(): CarcassonneState {
  return {
    player1: { name: '秦', score: 0, items: [0, 0, 0] },
    player2: { name: '马', score: 0, items: [0, 0, 0] },
    king: { count: 0, holder: 0 },
    thief: { count: 0, holder: 1 },
  };
}

export async function fetchCarcassonneSaves(): Promise<CarcassonneSave[]> {
  const res = await fetch('/api/carcassonne/saves');
  if (!res.ok) throw new Error('读取存档失败');
  return res.json();
}

export async function createCarcassonneSave(state: CarcassonneState, title: string): Promise<CarcassonneSave> {
  const res = await fetch('/api/carcassonne/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, title }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '保存失败');
  }
  return res.json();
}

export async function deleteCarcassonneSave(id: string): Promise<void> {
  const res = await fetch(`/api/carcassonne/saves/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '删除存档失败');
  }
}
