export interface SavingsRecord {
  id: string;
  date: string;        // "2026-08-11"
  time: string;        // "14:30"
  activity: string;    // 干什么
  item: string;        // 要买什么
  amount: number;      // 省了多少钱
  createdAt: string;   // ISO timestamp
}

export type NewSavingsRecord = Omit<SavingsRecord, 'id' | 'createdAt'>;

export async function fetchSavings(): Promise<SavingsRecord[]> {
  const res = await fetch('/api/savings');
  if (!res.ok) throw new Error('获取记录失败');
  return res.json();
}

export async function addSavings(record: NewSavingsRecord): Promise<SavingsRecord> {
  const res = await fetch('/api/savings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '添加记录失败');
  }
  return res.json();
}

export async function deleteSavings(id: string): Promise<void> {
  const res = await fetch(`/api/savings?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '删除记录失败');
  }
}

export async function updateSavings(record: SavingsRecord): Promise<SavingsRecord> {
  const res = await fetch('/api/savings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '更新记录失败');
  }
  return res.json();
}
