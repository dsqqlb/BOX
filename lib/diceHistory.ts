// 骰子历史：只保存在当前遥控器设备的 localStorage，并按房间号隔离。
// 一次投掷只有在用户点击“收起”后才会写入，保证记录的是包含全部重投后的最终快照。

export interface DiceRerollHistoryItem {
  dieId: number;
  sides: number;
  from: number;
  to: number;
}

export interface DiceHistoryEntry {
  id: string;
  recordedAt: string;
  label: string;
  expression: string;
  finalTotal: number;
  rerolls: DiceRerollHistoryItem[];
}

const MAX_HISTORY_ENTRIES = 50;

function storageKey(roomId: string): string {
  return `dnd-dice-history:${roomId}`;
}

export function loadDiceHistory(roomId: string): DiceHistoryEntry[] {
  if (typeof window === 'undefined' || !roomId) return [];
  try {
    const saved = localStorage.getItem(storageKey(roomId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DiceHistoryEntry =>
      entry
      && typeof entry.id === 'string'
      && typeof entry.recordedAt === 'string'
      && typeof entry.label === 'string'
      && typeof entry.expression === 'string'
      && typeof entry.finalTotal === 'number'
      && Array.isArray(entry.rerolls),
    ).slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function saveDiceHistory(roomId: string, entries: DiceHistoryEntry[]): void {
  if (typeof window === 'undefined' || !roomId) return;
  localStorage.setItem(storageKey(roomId), JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)));
}
