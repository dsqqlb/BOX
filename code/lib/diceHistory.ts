// 骰子历史按房间号保存在当前遥控器设备的 localStorage，并同步到房间供主屏幕展示。
// 初次结果会立即写入；后续重投以同一投掷 ID 覆盖该条记录，保留最新总和与完整重投明细。

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
