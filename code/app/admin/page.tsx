'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToolBySlug } from '@/lib/tools';

// ============ Types ============

type AuthUser = { username: string; isAdmin: boolean };
type Account = {
  username: string; permissions: string[]; isAdmin: boolean;
  createdAt: string; updatedAt: string;
};
type OnlineUser = {
  username: string; onlineSince: string; lastActivity: string;
  ipAddress: string; userAgent: string; idleSeconds: number;
};
type UserSummary = {
  username: string; permissions: string[]; isAdmin: boolean;
  createdAt: string; updatedAt: string; online: boolean;
  toolCount: number; loginCount: number;
};
type UserDetail = {
  username: string; permissions: string[]; isAdmin: boolean;
  createdAt: string; updatedAt: string;
  online: boolean; onlineSince: string | null; lastActivity: string;
  ipAddress: string | null;
  counts: { toolsUsed: number; logins: number; decks: number; savings: number; chatMessages: number; games: number };
  topTools: { toolSlug: string; openCount: number; lastOpenedAt: string }[];
  lastLogin: { ipAddress: string | null; createdAt: string } | null;
  weeklyActivity: { dayKey: string; openCount: number }[];
};
type TimelineEvent = {
  type: string; toolSlug?: string; detail: string;
  ipAddress?: string; timestamp: string;
};
type Dialog = { type: 'password' | 'delete'; account: Account } | { type: 'create' } | null;

type TabKey = 'dashboard' | 'accounts' | 'online' | 'search';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const shortTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' });

// ============ Helpers ============

function permissionMeta(permission: string) {
  const tool = getToolBySlug(permission);
  return { icon: tool?.icon || '◇', title: tool?.title || permission, description: tool?.description || permission };
}

function fuzzyMatch(query: string, value: string) {
  if (!query) return true;
  const target = value.toLocaleLowerCase();
  let index = 0;
  for (const char of query) {
    index = target.indexOf(char, index);
    if (index < 0) return false;
    index += 1;
  }
  return true;
}

function grantedCount(account: Account, total: number) {
  return account.permissions.includes('*') ? total : account.permissions.length;
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return dateFormatter.format(new Date(isoString));
}

function idleText(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min}分钟`;
  return `${Math.floor(min / 60)}小时${min % 60}分钟`;
}

// ============ Sub-Components ============

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-3.5 py-3 text-sm text-rose-100">{message}</div>;
}

function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3.5 py-3 text-sm text-emerald-100">{message}</div>;
}

function StatCard({ label, value, unit, hint, ratio }: { label: string; value: number | string; unit?: string; hint?: string; ratio?: number }) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 py-3.5">
      <p className="text-[11px] tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}{unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}</p>
      {typeof ratio === 'number'
        ? <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-sky-400" style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }} /></div>
        : hint && <p className="mt-2 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function OnlineIndicator({ online }: { online: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      online ? 'bg-emerald-400/15 text-emerald-200' : 'bg-slate-500/15 text-slate-400'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-slate-500'}`} />
      {online ? '在线' : '离线'}
    </span>
  );
}

function PermissionPicker({ permissions, selected, onChange, disabled = false }: {
  permissions: string[]; selected: string[]; onChange: (next: string[]) => void; disabled?: boolean;
}) {
  const hasAll = selected.includes('*');
  const toggle = (permission: string) => {
    if (disabled) return;
    if (permission === '*') { onChange(hasAll ? [] : ['*']); return; }
    const next = new Set(hasAll ? [] : selected);
    next.has(permission) ? next.delete(permission) : next.add(permission);
    onChange([...next]);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-2.5 text-sm text-cyan-50 transition hover:bg-cyan-300/[0.12] sm:col-span-2">
        <input className="h-4 w-4 accent-cyan-300" type="checkbox" checked={hasAll} disabled={disabled} onChange={() => toggle('*')} />
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-300/10 text-base">✦</span>
        <span className="min-w-0"><span className="block font-semibold">全部权限</span><span className="block truncate text-xs text-cyan-100/60">管理员，可访问所有工具与账户管理</span></span>
      </label>
      {permissions.map((permission) => {
        const meta = permissionMeta(permission);
        const checked = !hasAll && selected.includes(permission);
        return (
          <label key={permission} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${hasAll ? 'border-white/[0.05] bg-white/[0.02] text-slate-600' : checked ? 'border-cyan-300/25 bg-cyan-300/[0.08] text-slate-100' : 'border-white/[0.08] bg-slate-950/25 text-slate-300 hover:border-white/[0.18] hover:bg-white/[0.04]'}`}>
            <input className="h-4 w-4 shrink-0 accent-cyan-300" type="checkbox" checked={checked} disabled={disabled || hasAll} onChange={() => toggle(permission)} />
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base ${hasAll ? 'bg-white/[0.03]' : 'bg-white/[0.06]'}`}>{meta.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{meta.title}</span>
              <span className={`block truncate text-xs ${hasAll ? 'text-slate-700' : 'text-slate-500'}`}>{meta.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function PermissionMatrix({ all, granted }: { all: string[]; granted: string[] }) {
  const hasAll = granted.includes('*');
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((permission) => {
        const meta = permissionMeta(permission);
        const active = hasAll || granted.includes(permission);
        return (
          <span key={permission} title={`${meta.title} · ${active ? '已授权' : '未授权'}\n${meta.description}`} className={`inline-flex max-w-[15rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition ${active ? 'border-cyan-300/25 bg-cyan-300/[0.1] text-cyan-50' : 'border-white/[0.06] bg-white/[0.015] text-slate-600'}`}>
            <span className={active ? '' : 'opacity-40 grayscale'}>{meta.icon}</span>
            <span className="truncate">{meta.title}</span>
          </span>
        );
      })}
    </div>
  );
}

function TimelineIcon({ type }: { type: string }) {
  if (type === 'login') return <span className="text-emerald-300">◈</span>;
  if (type === 'logout') return <span className="text-rose-300">◇</span>;
  return <span className="text-cyan-300">▶</span>;
}

// ============ Main Page Component ============

export default function AdminPage() {
  const [viewer, setViewer] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  // Auth check
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({})))
      .then((body) => {
        if (!active) return;
        if (!body.isAdmin) { window.location.replace('/'); return; }
        setViewer(body as AuthUser);
      })
      .catch(() => { if (active) window.location.replace('/login'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#060a10] text-sm text-slate-300">正在验证管理权限…</main>;
  if (!viewer) return <main className="grid min-h-screen place-items-center bg-[#060a10] text-sm text-rose-200">无法确认管理权限。</main>;

  return (
    <main className="min-h-screen bg-[#060a10] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-0 h-96 w-96 rounded-full bg-teal-500/20 blur-[120px]" />
        <div className="absolute right-0 top-48 h-80 w-80 rounded-full bg-sky-400/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <header className="flex flex-col gap-4 border-b border-white/[0.1] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a href="/" className="text-xs font-semibold tracking-[0.18em] text-cyan-200 hover:text-white">BOX / 管理控制台</a>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">管理员面板</h1>
            <p className="mt-1 text-sm text-slate-400">账户管理 · 在线监控 · 活动审计</p>
          </div>
          <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-sm">
            <p className="text-xs text-cyan-100/60">当前管理员</p>
            <p className="mt-1 font-semibold text-cyan-50">{viewer.username}</p>
          </div>
        </header>

        {/* Error/Notice area */}
        <div className="mt-4 space-y-3">
          <ErrorMessage message={error} />
        </div>

        {/* Tabs */}
        <div className="mt-5 flex gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
          {([
            { key: 'dashboard' as const, label: '总览', icon: '⊞' },
            { key: 'accounts' as const, label: '账户管理', icon: '👥' },
            { key: 'online' as const, label: '在线用户', icon: '◉' },
            { key: 'search' as const, label: '用户搜索', icon: '⌕' },
          ]).map((tab) => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                activeTab === tab.key
                  ? 'bg-cyan-300/10 text-cyan-50 shadow-sm'
                  : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
              }`}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-5">
          {activeTab === 'dashboard' && <DashboardTab onNavigate={setActiveTab} />}
          {activeTab === 'accounts' && <AccountsTab viewer={viewer} />}
          {activeTab === 'online' && <OnlineTab />}
          {activeTab === 'search' && <SearchTab />}
        </div>
      </div>
    </main>
  );
}

// ============ Dashboard Tab ============

function DashboardTab({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
  const [stats, setStats] = useState<{ accounts: number; admins: number; online: number; tools: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [acctRes, onlineRes] = await Promise.all([
          fetch('/api/admin/accounts', { cache: 'no-store', credentials: 'same-origin' }),
          fetch('/api/admin/online', { cache: 'no-store', credentials: 'same-origin' }),
        ]);
        const acct = await acctRes.json().catch(() => ({ users: [] }));
        const ol = await onlineRes.json().catch(() => ({ users: [] }));
        if (!active) return;
        setStats({
          accounts: (acct.users || []).length,
          admins: (acct.users || []).filter((u: Account) => u.isAdmin).length,
          online: (ol.users || []).length,
          tools: (acct.availablePermissions || []).length,
        });
      } catch { /* ignore */ }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (loading) return <div className="grid min-h-48 place-items-center text-sm text-slate-500">加载统计数据…</div>;
  if (!stats) return <ErrorMessage message="无法加载统计数据。" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="账户总数" value={stats.accounts} unit="个" hint={`可授权工具 ${stats.tools} 个`} />
        <StatCard label="管理员" value={stats.admins} unit="个" ratio={stats.accounts ? stats.admins / stats.accounts : 0} />
        <StatCard label="当前在线" value={stats.online} unit="个" hint="过去5分钟内有活动" />
        <StatCard label="可授权工具" value={stats.tools} unit="个" ratio={1} />
      </div>

      <div className="rounded-2xl border border-white/[0.1] bg-white/[0.035] p-6 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">快速入口</h2>
        <p className="mt-1 text-sm text-slate-400">选择一个操作快速开始</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => onNavigate('accounts')}
            className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-5 text-center transition hover:bg-cyan-300/[0.12]">
            <p className="text-2xl">👥</p>
            <p className="mt-2 font-medium text-cyan-50">账户管理</p>
            <p className="text-xs text-slate-400 mt-1">创建、编辑、删除账户</p>
          </button>
          <button type="button" onClick={() => onNavigate('online')}
            className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-5 text-center transition hover:bg-emerald-300/[0.12]">
            <p className="text-2xl">◉</p>
            <p className="mt-2 font-medium text-emerald-50">在线监控</p>
            <p className="text-xs text-slate-400 mt-1">查看当前在线用户</p>
          </button>
          <button type="button" onClick={() => onNavigate('search')}
            className="rounded-2xl border border-sky-300/20 bg-sky-300/[0.06] px-4 py-5 text-center transition hover:bg-sky-300/[0.12]">
            <p className="text-2xl">⌕</p>
            <p className="mt-2 font-medium text-sky-50">用户详情</p>
            <p className="text-xs text-slate-400 mt-1">搜索并查看活动记录</p>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Accounts Tab ============

function AccountsTab({ viewer }: { viewer: AuthUser }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<string[]>([]);
  const [newPermissions, setNewPermissions] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ username: string; permissions: string[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadAccounts = useCallback(async () => {
    const response = await fetch('/api/admin/accounts', { cache: 'no-store', credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '无法加载账户列表。');
    setAccounts(body.users || []);
    setAvailablePermissions(body.availablePermissions || []);
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const updatePermissions = async (username: string, permissions: string[]) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(username)}`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '权限更新失败。');
      setAccounts((current) => current.map((account) => account.username === username ? body : account));
      setEditing(null); setNotice(`已更新 ${username} 的权限。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '权限更新失败。'); }
    finally { setSaving(false); }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('passwordConfirm') || '')) { setError('两次输入的密码不一致。'); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: String(values.get('username') || ''), password, permissions: newPermissions }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '创建账户失败。');
      setAccounts((current) => [...current, body].sort((a, b) => a.username.localeCompare(b.username)));
      form.reset(); setNewPermissions([]); setDialog(null); setSelectedUsername(body.username); setNotice(`已创建账户 ${body.username}。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '创建账户失败。'); }
    finally { setSaving(false); }
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog || dialog.type !== 'password') return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('passwordConfirm') || '')) { setError('两次输入的密码不一致。'); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(dialog.account.username)}`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '密码更新失败。');
      setDialog(null); setNotice(`已更新 ${body.username} 的密码。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '密码更新失败。'); }
    finally { setSaving(false); }
  };

  const deleteAccount = async () => {
    if (!dialog || dialog.type !== 'delete') return;
    const target = dialog.account.username;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(target)}`, { method: 'DELETE', credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '删除账户失败。');
      setAccounts((current) => current.filter((account) => account.username !== target));
      if (selectedUsername === target) setSelectedUsername(null);
      setNotice(`已删除账户 ${target}`); setDialog(null);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '删除账户失败。'); }
    finally { setSaving(false); }
  };

  const totalPermissions = availablePermissions.length;
  const adminCount = useMemo(() => accounts.filter((account) => account.isAdmin).length, [accounts]);
  const averageCoverage = useMemo(() => {
    if (!accounts.length || !totalPermissions) return 0;
    return accounts.reduce((sum, account) => sum + grantedCount(account, totalPermissions) / totalPermissions, 0) / accounts.length;
  }, [accounts, totalPermissions]);
  const query = search.trim().toLocaleLowerCase();
  const visibleAccounts = useMemo(() => accounts.filter((account) => {
    if (!query) return true;
    if (fuzzyMatch(query, account.username)) return true;
    if (account.permissions.includes('*') && fuzzyMatch(query, '全部权限管理员')) return true;
    return account.permissions.some((permission) => {
      const meta = permissionMeta(permission);
      return fuzzyMatch(query, meta.title) || fuzzyMatch(query, permission);
    });
  }), [accounts, query]);
  const selectedAccount = visibleAccounts.find((account) => account.username === selectedUsername) || visibleAccounts[0] || null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">创建、管理账户并分配工具权限</p>
        <button type="button" onClick={() => { setDialog({ type: 'create' }); setError(null); }}
          className="rounded-xl bg-gradient-to-r from-teal-300 to-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-teal-400/10 transition hover:brightness-110">＋ 新建账户</button>
      </div>

      <div className="space-y-3 mb-4"><ErrorMessage message={error} /><Notice message={notice} /></div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="账户总数" value={accounts.length} unit="个" hint={`可授权工具 ${totalPermissions} 个`} />
        <StatCard label="管理员" value={adminCount} unit="个" ratio={accounts.length ? adminCount / accounts.length : 0} />
        <StatCard label="平均权限覆盖" value={`${Math.round(averageCoverage * 100)}%`} ratio={averageCoverage} />
        <StatCard label="当前筛选" value={visibleAccounts.length} unit="个" hint={query ? `关键字「${search.trim()}」` : '未使用搜索'} />
      </section>

      <section className="mt-4 overflow-hidden rounded-3xl border border-white/[0.1] bg-white/[0.035] shadow-2xl shadow-black/20 backdrop-blur-sm">
        <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="border-b border-white/[0.08] lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
              <p className="text-xs font-semibold tracking-[0.15em] text-cyan-200/80">DIRECTORY</p>
              <span className="text-[11px] text-slate-500">{visibleAccounts.length} / {accounts.length}</span>
            </div>
            <div className="px-4 pb-3 pt-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-slate-950/40 px-3 py-2.5 focus-within:border-cyan-300/50">
                <span aria-hidden="true" className="text-slate-500">⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户名或工具权限…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" />
                {search && <button type="button" onClick={() => setSearch('')} aria-label="清除搜索" className="text-slate-500 hover:text-white">×</button>}
              </label>
            </div>
            <div className="max-h-[26rem] overflow-y-auto px-2 pb-3 lg:max-h-[38rem]">
              {visibleAccounts.length === 0 && <p className="px-3 py-10 text-center text-sm text-slate-500">没有匹配的账户。</p>}
              {visibleAccounts.map((account) => {
                const granted = grantedCount(account, totalPermissions);
                const active = account.username === selectedAccount?.username;
                return (
                  <button type="button" key={account.username} onClick={() => { setSelectedUsername(account.username); setEditing(null); }} aria-current={active}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${active ? 'bg-cyan-300/[0.1] ring-1 ring-inset ring-cyan-300/25' : 'hover:bg-white/[0.05]'}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-cyan-300 text-sm font-bold text-slate-950">{account.username.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-white">{account.username}</span>
                        {account.isAdmin && <span className="shrink-0 rounded-full bg-cyan-300/[0.14] px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">管理员</span>}
                        {account.username === viewer.username && <span className="shrink-0 text-[10px] text-slate-500">你</span>}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full rounded-full bg-gradient-to-r from-teal-300 to-sky-400" style={{ width: `${totalPermissions ? Math.round((granted / totalPermissions) * 100) : 0}%` }} /></span>
                        <span className="shrink-0 text-[10px] text-slate-500">{granted}/{totalPermissions}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 p-4 sm:p-6">
            {!selectedAccount ? (
              <div className="grid h-full min-h-48 place-items-center text-center text-sm text-slate-500">
                {accounts.length ? '左侧没有匹配的账户，换个关键字试试。' : '还没有任何账户，点右上角新建一个。'}
              </div>
            ) : (<>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-300 to-cyan-300 text-xl font-bold text-slate-950 shadow-lg shadow-teal-400/10">{selectedAccount.username.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-semibold text-white">{selectedAccount.username}</h2>
                      {selectedAccount.isAdmin && <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">管理员</span>}
                      {selectedAccount.username === viewer.username && <span className="text-xs text-slate-500">当前账户</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">创建于 {dateFormatter.format(new Date(selectedAccount.createdAt))}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setEditing(editing?.username === selectedAccount.username ? null : { username: selectedAccount.username, permissions: selectedAccount.permissions })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${editing?.username === selectedAccount.username ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100' : 'border-white/[0.12] text-slate-200 hover:bg-white/[0.07]'}`}>管理权限</button>
                  <button onClick={() => setDialog({ type: 'password', account: selectedAccount })}
                    className="rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-100 hover:bg-sky-400/20">更改密码</button>
                  <button disabled={selectedAccount.username === viewer.username} onClick={() => setDialog({ type: 'delete', account: selectedAccount })}
                    className="rounded-lg px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:text-slate-600">删除</button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
                  <p className="text-[11px] text-slate-500">权限覆盖</p>
                  <p className="mt-1 text-xl font-semibold text-white">{grantedCount(selectedAccount, totalPermissions)}<span className="text-xs font-normal text-slate-500"> / {totalPermissions}</span></p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-sky-400" style={{ width: `${totalPermissions ? Math.round((grantedCount(selectedAccount, totalPermissions) / totalPermissions) * 100) : 0}%` }} /></div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
                  <p className="text-[11px] text-slate-500">授权方式</p>
                  <p className="mt-1 text-sm font-medium text-white">{selectedAccount.permissions.includes('*') ? '全部权限（通配）' : '按工具逐项授权'}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
                  <p className="text-[11px] text-slate-500">最近更新</p>
                  <p className="mt-1 text-sm font-medium text-white">{dateFormatter.format(new Date(selectedAccount.updatedAt))}</p>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between"><p className="text-sm text-slate-300">权限总览</p><p className="text-[11px] text-slate-500">高亮为已授权</p></div>
                <PermissionMatrix all={availablePermissions} granted={selectedAccount.permissions} />
              </div>

              {editing && editing.username === selectedAccount.username && (
                <div className="mt-5 border-t border-white/[0.08] pt-5">
                  <p className="mb-3 text-sm text-slate-300">编辑 {selectedAccount.username} 的权限</p>
                  <PermissionPicker permissions={availablePermissions} selected={editing.permissions} onChange={(permissions) => setEditing({ ...editing, permissions })} disabled={saving} />
                  <div className="mt-4 flex justify-end gap-2">
                    <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-white">取消</button>
                    <button disabled={saving || !editing.permissions.length} onClick={() => updatePermissions(selectedAccount.username, editing.permissions)}
                      className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50">保存权限</button>
                  </div>
                </div>
              )}
            </>)}
          </div>
        </div>
      </section>

      {/* Dialogs */}
      {dialog && (
        <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-950/80 p-4 py-[6vh] backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className={`w-full rounded-2xl border border-white/[0.12] bg-[#0a1320] p-5 shadow-2xl ${dialog.type === 'create' ? 'max-w-2xl' : 'max-w-md'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.15em] text-cyan-200/80">{dialog.type === 'create' ? 'NEW ACCOUNT' : dialog.type === 'password' ? 'RESET PASSWORD' : 'DELETE ACCOUNT'}</p>
                <h2 className="mt-2 text-xl font-semibold">{dialog.type === 'create' ? '新建账户' : dialog.type === 'password' ? `更改 ${dialog.account.username} 的密码` : `删除 ${dialog.account.username}？`}</h2>
              </div>
              <button onClick={() => setDialog(null)} className="text-slate-500 hover:text-white" aria-label="关闭">×</button>
            </div>

            {dialog.type === 'create' && (
              <form className="mt-5 space-y-4" onSubmit={submitCreate}>
                <p className="text-sm leading-6 text-slate-400">密码至少 8 个字符。权限可稍后随时调整。</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block text-sm text-slate-300">用户名
                    <input required name="username" autoFocus autoComplete="username" placeholder="例如 explorer" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label>
                  <label className="block text-sm text-slate-300">初始密码
                    <input required name="password" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label>
                  <label className="block text-sm text-slate-300">确认密码
                    <input required name="passwordConfirm" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label>
                </div>
                <div>
                  <p className="mb-2 text-sm text-slate-300">初始权限 <span className="text-xs text-slate-500">选择该账户可以打开的工具</span></p>
                  <div className="max-h-[42vh] overflow-y-auto pr-1"><PermissionPicker permissions={availablePermissions} selected={newPermissions} onChange={setNewPermissions} disabled={saving} /></div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white">取消</button>
                  <button disabled={saving || !newPermissions.length} className="rounded-xl bg-gradient-to-r from-teal-300 to-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-teal-400/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '正在保存…' : '创建账户'}</button>
                </div>
              </form>
            )}

            {dialog.type === 'password' && (
              <form className="mt-5 space-y-4" onSubmit={submitPassword}>
                <label className="block text-sm text-slate-300">新密码
                  <input required name="password" type="password" minLength={8} autoFocus autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-white outline-none focus:border-cyan-300" /></label>
                <label className="block text-sm text-slate-300">确认新密码
                  <input required name="passwordConfirm" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-white outline-none focus:border-cyan-300" /></label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400">取消</button>
                  <button disabled={saving} className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">保存新密码</button>
                </div>
              </form>
            )}

            {dialog.type === 'delete' && (
              <div className="mt-5">
                <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">此操作不可撤销。该账户的牌组、DND 存档和储蓄记录等所有账户数据也会一并删除。</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400">取消</button>
                  <button disabled={saving} onClick={deleteAccount} className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">确认删除</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Online Users Tab ============

function OnlineTab() {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/online', { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({ users: [] }));
      setUsers(body.users || []);
      setError(null);
    } catch { setError('无法加载在线用户列表。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) return <div className="grid min-h-48 place-items-center text-sm text-slate-500">加载在线用户…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">过去 5 分钟内有过活动（HTTP 请求或 WebSocket 连接）的用户</p>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)] animate-pulse" />
          <span className="text-sm text-emerald-200">{users.length} 人在线</span>
        </div>
      </div>
      <ErrorMessage message={error} />

      {users.length === 0 ? (
        <div className="grid min-h-48 place-items-center rounded-3xl border border-white/[0.1] bg-white/[0.035] text-center text-sm text-slate-500">当前没有在线用户。</div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/[0.1] bg-white/[0.035] backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-[11px] font-semibold tracking-[0.12em] text-cyan-200/80">
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">在线时长</th>
                  <th className="px-4 py-3">空闲</th>
                  <th className="px-4 py-3">IP 地址</th>
                  <th className="px-4 py-3">最后活动</th>
                  <th className="px-4 py-3">用户代理</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.username} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-300 to-cyan-300 text-xs font-bold text-slate-950">{user.username.slice(0, 1).toUpperCase()}</span>
                        <span className="font-medium text-white">{user.username}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3"><OnlineIndicator online={true} /></td>
                    <td className="px-4 py-3 text-slate-300">{relativeTime(user.onlineSince)}</td>
                    <td className="px-4 py-3 text-slate-300">{idleText(user.idleSeconds)}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">{user.ipAddress || '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{shortTime.format(new Date(user.lastActivity))}</td>
                    <td className="px-4 py-3 text-slate-500 text-[11px] max-w-[200px] truncate" title={user.userAgent}>{user.userAgent.slice(0, 60) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Search Tab ============

function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(null); setSearched(true); setSelectedUser(null); setDetail(null);
    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({ users: [] }));
      if (!res.ok) throw new Error(body.error || '搜索失败。');
      setResults(body.users || []);
    } catch (e) { setError(e instanceof Error ? e.message : '搜索失败。'); }
    finally { setLoading(false); }
  };

  const loadDetail = async (username: string) => {
    setSelectedUser(username); setDetailLoading(true);
    try {
      const [detailRes, timelineRes] = await Promise.all([
        fetch(`/api/admin/users/detail?username=${encodeURIComponent(username)}`, { cache: 'no-store', credentials: 'same-origin' }),
        fetch(`/api/admin/users/activity?username=${encodeURIComponent(username)}`, { cache: 'no-store', credentials: 'same-origin' }),
      ]);
      const d = await detailRes.json().catch(() => null);
      const t = await timelineRes.json().catch(() => ({ timeline: [] }));
      if (d && d.username) setDetail(d);
      setTimeline(t.timeline || []);
    } catch { setError('加载用户详情失败。'); }
    finally { setDetailLoading(false); }
  };

  useEffect(() => { if (detailRef.current) detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [detail]);

  return (
    <div>
      {/* Search bar */}
      <div className="flex gap-3">
        <label className="flex flex-1 items-center gap-3 rounded-2xl border border-white/[0.1] bg-slate-950/40 px-4 py-3 focus-within:border-cyan-300/50">
          <span className="text-slate-500 text-lg">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            placeholder="输入用户名搜索…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500" />
          {query && <button type="button" onClick={() => { setQuery(''); setResults([]); setSearched(false); setDetail(null); }} className="text-slate-500 hover:text-white">×</button>}
        </label>
        <button onClick={doSearch} disabled={loading || !query.trim()}
          className="rounded-2xl bg-gradient-to-r from-teal-300 to-sky-400 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-teal-400/10 transition hover:brightness-110 disabled:opacity-50">搜索</button>
      </div>

      <ErrorMessage message={error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Results */}
        <div>
          {loading && <div className="grid min-h-32 place-items-center text-sm text-slate-500">搜索中…</div>}
          {!loading && searched && results.length === 0 && (
            <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-8 text-center text-sm text-slate-500">没有找到匹配的账户。</div>
          )}
          {!loading && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-[0.15em] text-cyan-200/80 mb-3">搜索结果 ({results.length})</p>
              {results.map((user) => (
                <button key={user.username} type="button" onClick={() => loadDetail(user.username)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    selectedUser === user.username
                      ? 'border-cyan-300/30 bg-cyan-300/[0.08]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
                  }`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-cyan-300 text-sm font-bold text-slate-950">{user.username.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{user.username}</span>
                      <OnlineIndicator online={user.online} />
                      {user.isAdmin && <span className="shrink-0 rounded-full bg-cyan-300/[0.14] px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">管理员</span>}
                    </span>
                    <span className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                      <span>使用过 {user.toolCount} 个工具</span>
                      <span>登录 {user.loginCount} 次</span>
                    </span>
                  </span>
                  <span className="text-slate-500 text-lg">→</span>
                </button>
              ))}
            </div>
          )}
          {!loading && !searched && (
            <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-8 text-center text-sm text-slate-500">输入用户名后点击"搜索"查看账户详情与活动记录。</div>
          )}
        </div>

        {/* Detail panel */}
        <div ref={detailRef}>
          {detailLoading && <div className="grid min-h-48 place-items-center text-sm text-slate-500">加载用户详情…</div>}

          {!detailLoading && detail && (
            <div className="space-y-4">
              {/* Profile header */}
              <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-5 backdrop-blur-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-300 to-cyan-300 text-2xl font-bold text-slate-950 shadow-lg shadow-teal-400/10">{detail.username.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold text-white">{detail.username}</h2>
                        <OnlineIndicator online={detail.online} />
                        {detail.isAdmin && <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-100">管理员</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        创建于 {dateFormatter.format(new Date(detail.createdAt))}
                        {detail.onlineSince && <> · 本次会话始于 {relativeTime(detail.onlineSince)}</>}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center">
                    <p className="text-lg font-semibold text-white">{detail.counts.toolsUsed}</p>
                    <p className="text-[10px] text-slate-500">使用工具</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center">
                    <p className="text-lg font-semibold text-white">{detail.counts.logins}</p>
                    <p className="text-[10px] text-slate-500">登录次数</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center">
                    <p className="text-lg font-semibold text-white">{detail.counts.chatMessages}</p>
                    <p className="text-[10px] text-slate-500">聊天消息</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center">
                    <p className="text-lg font-semibold text-white">{detail.counts.decks}</p>
                    <p className="text-[10px] text-slate-500">牌组</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center">
                    <p className="text-lg font-semibold text-white">{detail.counts.savings}</p>
                    <p className="text-[10px] text-slate-500">省钱记录</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center">
                    <p className="text-lg font-semibold text-white">{detail.counts.games}</p>
                    <p className="text-[10px] text-slate-500">EDH 对局</p>
                  </div>
                </div>

                {detail.ipAddress && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <span>最后 IP：<span className="font-mono text-slate-300">{detail.ipAddress}</span></span>
                    {detail.lastLogin && <span>· 最后登录：{dateFormatter.format(new Date(detail.lastLogin.createdAt))}</span>}
                  </div>
                )}
              </div>

              {/* Permissions */}
              <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-5 backdrop-blur-sm">
                <p className="mb-2 text-xs font-semibold tracking-[0.15em] text-cyan-200/80">权限</p>
                <PermissionMatrix all={detail.permissions} granted={detail.permissions} />
              </div>

              {/* Top tools */}
              {detail.topTools.length > 0 && (
                <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-5 backdrop-blur-sm">
                  <p className="mb-3 text-xs font-semibold tracking-[0.15em] text-cyan-200/80">最常使用的工具</p>
                  <div className="space-y-2">
                    {detail.topTools.map((tool) => (
                      <div key={tool.toolSlug} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="text-sm">{permissionMeta(tool.toolSlug).icon}</span>
                          <span className="text-sm text-white">{permissionMeta(tool.toolSlug).title}</span>
                        </span>
                        <span className="text-xs text-slate-400">
                          {tool.openCount} 次 · 最后 {relativeTime(tool.lastOpenedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Weekly activity */}
              {detail.weeklyActivity.length > 0 && (
                <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-5 backdrop-blur-sm">
                  <p className="mb-3 text-xs font-semibold tracking-[0.15em] text-cyan-200/80">最近 7 天活跃度</p>
                  <div className="flex items-end gap-2">
                    {detail.weeklyActivity.map((day) => {
                      const maxCount = Math.max(...detail.weeklyActivity.map((d) => d.openCount), 1);
                      const height = Math.max(4, (day.openCount / maxCount) * 80);
                      const dayName = new Date(day.dayKey + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'short' });
                      return (
                        <div key={day.dayKey} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[10px] text-slate-500">{day.openCount}</span>
                          <div className="w-full rounded-sm bg-gradient-to-t from-teal-400 to-cyan-300" style={{ height: `${height}%`, minHeight: '4px' }} title={`${day.dayKey}: ${day.openCount} 次`} />
                          <span className="text-[10px] text-slate-500">{dayName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Activity timeline */}
              <div className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-5 backdrop-blur-sm">
                <p className="mb-3 text-xs font-semibold tracking-[0.15em] text-cyan-200/80">活动时间线</p>
                {timeline.length === 0 ? (
                  <p className="text-sm text-slate-500">暂无活动记录。</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-1">
                    {timeline.map((event, index) => (
                      <div key={index} className="flex items-start gap-3 rounded-xl px-3 py-2 hover:bg-white/[0.03]">
                        <span className="mt-0.5 shrink-0"><TimelineIcon type={event.type} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="text-sm text-slate-200">{event.detail}</span>
                          {event.ipAddress && <span className="ml-2 text-[11px] font-mono text-slate-500">{event.ipAddress}</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-500">{relativeTime(event.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}