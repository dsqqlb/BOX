'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fetchSavings, addSavings, deleteSavings, updateSavings } from '@/lib/savings';
import type { SavingsRecord, NewSavingsRecord } from '@/lib/savings';

// ============ 预设数据 ============

const ACTIVITY_PRESETS = ['逛街', '刷淘宝', '看直播', '刷抖音', '逛商场', '网上冲浪', '通勤路上', '午休时间'];
const ITEM_PRESETS = ['奶茶', '咖啡', '外卖', '新衣服', '游戏皮肤', '新手机', '零食', '电子产品', '化妆品', '书籍'];
const AMOUNT_PRESETS = [10, 15, 18, 25, 30, 50, 100, 200, 500];

// ============ 自定义预设 hook ============

function useCustomPresets(key: string): [string[], (v: string) => void, (v: string) => void] {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`savings-presets-${key}`);
      if (stored) setItems(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [key]);

  const add = useCallback((value: string) => {
    setItems((prev) => {
      if (prev.includes(value)) return prev;
      const next = [...prev, value];
      localStorage.setItem(`savings-presets-${key}`, JSON.stringify(next));
      return next;
    });
  }, [key]);

  const remove = useCallback((value: string) => {
    setItems((prev) => {
      const next = prev.filter((v) => v !== value);
      localStorage.setItem(`savings-presets-${key}`, JSON.stringify(next));
      return next;
    });
  }, [key]);

  return [items, add, remove];
}

// ============ 主题 hook ============

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem('box-theme') as 'light' | 'dark' | null;
    if (stored) setTheme(stored);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme('dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('box-theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}

// ============ 预设按钮组件 ============

function PresetChips({
  presets, currentValue, onSelect, isAmount = false, storageKey,
}: {
  presets: (string | number)[];
  currentValue: string;
  onSelect: (value: string) => void;
  isAmount?: boolean;
  storageKey: string;
}) {
  const [customPresets, addCustom, removeCustom] = useCustomPresets(storageKey);
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState('');

  const allPresets = [...presets.map(String), ...customPresets];

  const handleAdd = () => {
    const v = newValue.trim();
    if (!v) { setAdding(false); setNewValue(''); return; }
    const val = isAmount ? String(Number(v)) : v;
    if (!val || val === 'NaN') { setAdding(false); setNewValue(''); return; }
    addCustom(val);
    onSelect(val);
    setAdding(false);
    setNewValue('');
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 items-center">
      {allPresets.map((p) => {
        const isCustom = customPresets.includes(p);
        const active = currentValue === p;
        return (
          <span key={p} className="relative group/chip inline-flex">
            <button type="button" onClick={() => onSelect(p)} className={active ? 'savings-chip-active' : 'savings-chip'}>
              {isAmount ? `¥${p}` : p}
            </button>
            {isCustom && (
              <button type="button" onClick={(e) => { e.stopPropagation(); removeCustom(p); }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-300 dark:bg-zinc-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity hover:bg-red-400">
                ×
              </button>
            )}
          </span>
        );
      })}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            ref={(el) => el?.focus()}
            type={isAmount ? 'number' : 'text'}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setNewValue(''); } }}
            onBlur={handleAdd}
            placeholder={isAmount ? '金额' : '自定义'}
            className="w-20 px-2 py-1 text-xs rounded-lg border-2 border-coral-300 dark:border-coral-400 bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 outline-none"
          />
        </span>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="px-2 py-0.5 text-xs rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500 hover:border-coral-300 dark:hover:border-coral-500 hover:text-coral-400 dark:hover:text-coral-400 transition-colors">
          + 自定义
        </button>
      )}
    </div>
  );
}

// ============ 工具函数 ============

function getWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now); monday.setDate(now.getDate() - diffToMonday);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

function getMonthRange() {
  const now = new Date();
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
}

function formatMoney(amount: number): string { return `¥${amount.toFixed(2)}`; }
function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function nowTimeStr(): string { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

// ============ 主题切换按钮 ============

function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="savings-theme-toggle" title={theme === 'light' ? '切换暗色模式' : '切换明亮模式'}>
      <span className="text-lg">{theme === 'light' ? '🌙' : '☀️'}</span>
    </button>
  );
}

// ============ 表单字段组件（添加/编辑共用） ============

function RecordFields({
  date, time, activity, item, amount,
  onDateChange, onTimeChange, onActivityChange, onItemChange, onAmountChange,
}: {
  date: string; time: string; activity: string; item: string; amount: string;
  onDateChange: (v: string) => void; onTimeChange: (v: string) => void;
  onActivityChange: (v: string) => void; onItemChange: (v: string) => void;
  onAmountChange: (v: string) => void;
}) {
  const labelClass = 'block text-sm font-medium mb-1 text-zinc-600 dark:text-zinc-400';

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>📅 日期</label>
          <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} className="savings-input" required />
        </div>
        <div>
          <label className={labelClass}>⏰ 时间</label>
          <input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} className="savings-input" required />
        </div>
      </div>

      <div>
        <label className={labelClass}>🎯 当时在干什么</label>
        <input type="text" value={activity} onChange={(e) => onActivityChange(e.target.value)} placeholder="比如：逛街、刷淘宝、看直播…" className="savings-input" required />
        <PresetChips presets={ACTIVITY_PRESETS} currentValue={activity} onSelect={onActivityChange} storageKey="activity" />
      </div>

      <div>
        <label className={labelClass}>🛒 本想买什么</label>
        <input type="text" value={item} onChange={(e) => onItemChange(e.target.value)} placeholder="比如：奶茶、新手机、游戏皮肤…" className="savings-input" required />
        <PresetChips presets={ITEM_PRESETS} currentValue={item} onSelect={onItemChange} storageKey="item" />
      </div>

      <div>
        <label className={labelClass}>💰 省了多少钱</label>
        <div className="flex items-center rounded-xl border-2 border-pink-200 dark:border-zinc-600 focus-within:border-coral-400 dark:focus-within:border-coral-400 focus-within:ring-2 focus-within:ring-coral-200/50 dark:focus-within:ring-coral-500/20 bg-white/80 dark:bg-zinc-700/80 overflow-hidden transition-all">
          <span className="pl-4 pr-1 text-lg font-bold text-coral-400 dark:text-coral-300 select-none">¥</span>
          <input
            type="number" value={amount} onChange={(e) => onAmountChange(e.target.value)}
            placeholder="0.00" step="0.01" min="0.01"
            className="flex-1 py-2.5 pr-4 bg-transparent outline-none text-zinc-700 dark:text-zinc-200 text-lg font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            required
          />
        </div>
        <PresetChips presets={AMOUNT_PRESETS} currentValue={amount} onSelect={onAmountChange} isAmount storageKey="amount" />
      </div>
    </>
  );
}

// ============ 记录卡片 ============

function RecordCard({ record, onDelete, onEdit }: {
  record: SavingsRecord;
  onDelete: (id: string) => void;
  onEdit: (record: SavingsRecord) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`确定删除「${record.item}」这条省钱记录吗？`)) return;
    setDeleting(true);
    try { await onDelete(record.id); } catch { setDeleting(false); }
  };

  return (
    <div className="savings-record-card group animate-slideInUp">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100 truncate">🛒 {record.item}</h3>
            <span className="text-lg font-black text-emerald-500 dark:text-emerald-400 whitespace-nowrap">+{formatMoney(record.amount)}</span>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">🎯 {record.activity}</p>
          <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
            <span>📅 {record.date}</span>
            <span>⏰ {record.time}</span>
          </div>
        </div>
        {/* 操作按钮 */}
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(record)}
            className="p-2 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="编辑">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="p-2 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="删除">
            {deleting ? <span className="text-xs">⏳</span> : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ 编辑弹窗 ============

function EditModal({ record, onSave, onCancel }: {
  record: SavingsRecord;
  onSave: (r: SavingsRecord) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(record.date);
  const [time, setTime] = useState(record.time);
  const [activity, setActivity] = useState(record.activity);
  const [item, setItem] = useState(record.item);
  const [amount, setAmount] = useState(String(record.amount));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time || !activity.trim() || !item.trim() || !amount) return;
    setSaving(true);
    try {
      await onSave({
        ...record,
        date,
        time,
        activity: activity.trim(),
        item: item.trim(),
        amount: Number(amount),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="savings-form-card w-full max-w-md max-h-[90vh] overflow-y-auto animate-pop-in" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-zinc-700 dark:text-zinc-200 mb-4 text-center">✏️ 编辑省钱记录</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <RecordFields
            date={date} time={time} activity={activity} item={item} amount={amount}
            onDateChange={setDate} onTimeChange={setTime}
            onActivityChange={setActivity} onItemChange={setItem} onAmountChange={setAmount}
          />
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl border-2 border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all">
              取消
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-400 to-blue-500 text-white font-bold shadow-lg shadow-blue-200 dark:shadow-blue-900/40 hover:shadow-xl hover:shadow-blue-300 dark:hover:shadow-blue-800/50 hover:-translate-y-0.5 transition-all disabled:opacity-50">
              {saving ? '保存中…' : '💾 保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============ 空状态 ============

function EmptyState({ onAddClick }: { onAddClick: () => void }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="text-7xl mb-4 animate-bounce-slow">🐷</div>
      <p className="text-zinc-500 dark:text-zinc-400 text-lg font-medium mb-2">还没有省下一分钱哦～</p>
      <p className="text-zinc-400 dark:text-zinc-500 text-sm mb-6">快去忍住购物冲动，来这里记下你省了多少！</p>
      <button onClick={onAddClick}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-coral-400 to-pink-400 text-white font-bold shadow-lg shadow-coral-200 dark:shadow-coral-900/40 hover:shadow-xl hover:shadow-coral-300 dark:hover:shadow-coral-800/50 hover:-translate-y-0.5 transition-all">
        🐷 记下第一笔省钱！
      </button>
    </div>
  );
}

// ============ 主页面 ============

export default function SavingsTrackerPage() {
  const { theme, toggleTheme } = useTheme();
  const [records, setRecords] = useState<SavingsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SavingsRecord | null>(null);
  const [error, setError] = useState('');

  const loadRecords = useCallback(async () => {
    try { setRecords(await fetchSavings()); setError(''); }
    catch { setError('加载数据失败，请检查服务器是否启动'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const handleAdd = async (record: NewSavingsRecord) => {
    const newRecord = await addSavings(record);
    setRecords((prev) => [newRecord, ...prev]);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await deleteSavings(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleEdit = async (record: SavingsRecord) => {
    const updated = await updateSavings(record);
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setEditingRecord(null);
  };

  const { monday, sunday } = getWeekRange();
  const { start: monthStart, end: monthEnd } = getMonthRange();

  const totalSaved = records.reduce((sum, r) => sum + r.amount, 0);
  const monthSaved = records.filter((r) => { const d = new Date(r.date); return d >= monthStart && d <= monthEnd; }).reduce((sum, r) => sum + r.amount, 0);
  const weekSaved = records.filter((r) => { const d = new Date(r.date); return d >= monday && d <= sunday; }).reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="savings-page-bg min-h-screen">
      {/* 顶部导航 + 主题切换 */}
      <header className="savings-header sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="savings-header-link inline-flex items-center text-sm font-medium transition-colors group">
            <span className="mr-1.5 group-hover:-translate-x-1 transition-transform">←</span>
            返回首页
          </Link>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="savings-stat-card">
            <div className="text-2xl mb-1">🐷</div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">累计省钱</div>
            <div className="text-base sm:text-lg font-black text-coral-500 dark:text-coral-300">{formatMoney(totalSaved)}</div>
          </div>
          <div className="savings-stat-card">
            <div className="text-2xl mb-1">📅</div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">本月省钱</div>
            <div className="text-base sm:text-lg font-black text-amber-500 dark:text-amber-400">{formatMoney(monthSaved)}</div>
          </div>
          <div className="savings-stat-card">
            <div className="text-2xl mb-1">📆</div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">本周省钱</div>
            <div className="text-base sm:text-lg font-black text-emerald-500 dark:text-emerald-400">{formatMoney(weekSaved)}</div>
          </div>
        </div>

        {/* 添加按钮 */}
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="w-full mb-6 py-4 rounded-2xl bg-gradient-to-r from-coral-400 to-pink-400 text-white font-bold text-lg shadow-lg shadow-coral-200 dark:shadow-coral-900/40 hover:shadow-xl hover:shadow-coral-300 dark:hover:shadow-coral-800/50 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
            🐷 忍住没买？点我记一笔！
          </button>
        )}

        {/* 添加表单 */}
        {showForm && (
          <div className="savings-form-card mb-6 animate-slideInUp">
            <h3 className="text-lg font-bold text-zinc-700 dark:text-zinc-200 mb-4 text-center">🐷 记录一次省钱</h3>
            <AddForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* 加载 / 错误 */}
        {loading && (
          <div className="text-center py-12">
            <div className="text-4xl animate-bounce-slow mb-3">🐷</div>
            <p className="text-zinc-400 dark:text-zinc-500">加载中…</p>
          </div>
        )}
        {error && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">😢</div>
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={loadRecords}
              className="mt-3 px-4 py-2 rounded-xl bg-coral-100 dark:bg-coral-900/30 text-coral-600 dark:text-coral-400 font-medium hover:bg-coral-200 dark:hover:bg-coral-900/50 transition-all">
              重试
            </button>
          </div>
        )}

        {/* 空状态 */}
        {!loading && !error && records.length === 0 && (
          <EmptyState onAddClick={() => setShowForm(true)} />
        )}

        {/* 记录列表 */}
        {!loading && !error && records.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">📋 共 {records.length} 条省钱记录</h2>
            </div>
            <div className="space-y-3">
              {records.map((record) => (
                <RecordCard key={record.id} record={record} onDelete={handleDelete} onEdit={setEditingRecord} />
              ))}
            </div>
          </>
        )}

        {/* 编辑弹窗 */}
        {editingRecord && (
          <EditModal record={editingRecord} onSave={handleEdit} onCancel={() => setEditingRecord(null)} />
        )}
      </div>
    </div>
  );
}

// ============ AddForm（复用 RecordFields） ============

function AddForm({ onAdd, onCancel }: { onAdd: (r: NewSavingsRecord) => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowTimeStr());
  const [activity, setActivity] = useState('');
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time || !activity.trim() || !item.trim() || !amount) return;
    setSubmitting(true);
    try { await onAdd({ date, time, activity: activity.trim(), item: item.trim(), amount: Number(amount) }); }
    finally { setSubmitting(false); }
  };

  const btnBase = 'flex-1 py-2.5 rounded-xl font-medium transition-all';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <RecordFields
        date={date} time={time} activity={activity} item={item} amount={amount}
        onDateChange={setDate} onTimeChange={setTime}
        onActivityChange={setActivity} onItemChange={setItem} onAmountChange={setAmount}
      />
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel}
          className={`${btnBase} border-2 border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50`}>
          取消
        </button>
        <button type="submit" disabled={submitting}
          className={`${btnBase} bg-gradient-to-r from-coral-400 to-pink-400 text-white font-bold shadow-lg shadow-coral-200 dark:shadow-coral-900/40 hover:shadow-xl hover:shadow-coral-300 dark:hover:shadow-coral-800/50 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0`}>
          {submitting ? '🐷 记录中…' : '🐷 记一笔！省到就是赚到！'}
        </button>
      </div>
    </form>
  );
}
