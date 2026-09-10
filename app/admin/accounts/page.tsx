'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { getToolBySlug } from '@/lib/tools';

type Account = {
  username: string;
  permissions: string[];
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuthUser = { username: string; isAdmin: boolean };
type Dialog = { type: 'password' | 'delete'; account: Account } | { type: 'create' } | null;

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** 权限就是工具 slug，界面上一律显示工具卡片的中文名/图标/描述，slug 只作为兜底。 */
function permissionMeta(permission: string) {
  const tool = getToolBySlug(permission);
  return { icon: tool?.icon || '◇', title: tool?.title || permission, description: tool?.description || permission };
}

/**
 * 模糊匹配：把查询串当作子序列去匹配用户名或它能访问的工具名，
 * 所以 "exp" 能命中 "explorer"，输入工具中文名也能筛出有该权限的账户。
 */
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

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-3.5 py-3 text-sm text-rose-100">{message}</div>;
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

function PermissionPicker({ permissions, selected, onChange, disabled = false }: {
  permissions: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const hasAll = selected.includes('*');
  const toggle = (permission: string) => {
    if (disabled) return;
    if (permission === '*') {
      onChange(hasAll ? [] : ['*']);
      return;
    }
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

/** 权限总览：把「全部可授权工具」铺开，已授权高亮、未授权压暗，一眼看出覆盖范围。 */
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

export default function AccountManagementPage() {
  const [viewer, setViewer] = useState<AuthUser | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<string[]>([]);
  const [newPermissions, setNewPermissions] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ username: string; permissions: string[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || '登录状态已失效。');
        if (!body.isAdmin) {
          window.location.replace('/');
          return;
        }
        await loadAccounts();
        if (active) setViewer(body as AuthUser);
      } catch (requestError) {
        if (!active) return;
        const message = requestError instanceof Error ? requestError.message : '无法加载管理页面。';
        if (/登录|需要登录/.test(message)) window.location.replace('/login?next=%2Fadmin%2Faccounts');
        else setError(message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    return () => { active = false; };
  }, [loadAccounts]);

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
      setAccounts((current) => current.map((account) => account.username === body.username ? body : account));
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
      setNotice(`已删除账户 ${target} 及其所有账户数据。`); setDialog(null);
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
  // 选中项必须落在当前可见列表里，否则筛选后详情面板会和左侧列表脱节。
  const selectedAccount = visibleAccounts.find((account) => account.username === selectedUsername) || visibleAccounts[0] || null;

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#060a10] text-sm text-slate-300">正在验证管理权限…</main>;
  if (!viewer) return <main className="grid min-h-screen place-items-center bg-[#060a10] p-6 text-center text-sm text-rose-200"><ErrorMessage message={error || '无法确认管理权限。'} /></main>;

  const isSelf = selectedAccount?.username === viewer.username;
  const isEditing = Boolean(selectedAccount && editing?.username === selectedAccount.username);
  const selectedGranted = selectedAccount ? grantedCount(selectedAccount, totalPermissions) : 0;

  return (
    <main className="min-h-screen bg-[#060a10] px-4 py-6 text-slate-100 sm:px-6 sm:py-10">
      <div className="pointer-events-none fixed inset-0 overflow-hidden"><div className="absolute -left-40 top-0 h-96 w-96 rounded-full bg-teal-500/20 blur-[120px]" /><div className="absolute right-0 top-48 h-80 w-80 rounded-full bg-sky-400/10 blur-[110px]" /></div>
      <div className="relative mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-white/[0.1] pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div><a href="/" className="text-xs font-semibold tracking-[0.18em] text-cyan-200 hover:text-white">BOX / 管理控制台</a><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">账户与权限</h1><p className="mt-2 text-sm text-slate-400">创建账户、重设密码，并精确分配每个工具的访问权限。</p></div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-sm"><p className="text-xs text-cyan-100/60">当前管理员</p><p className="mt-1 font-semibold text-cyan-50">{viewer.username}</p></div>
            <button type="button" onClick={() => { setDialog({ type: 'create' }); setError(null); }} className="rounded-xl bg-gradient-to-r from-teal-300 to-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-teal-400/10 transition hover:brightness-110">＋ 新建账户</button>
          </div>
        </header>

        <div className="mt-6 space-y-3"><ErrorMessage message={error} />{notice && <div role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3.5 py-3 text-sm text-emerald-100">{notice}</div>}</div>

        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="账户总数" value={accounts.length} unit="个" hint={`可授权工具 ${totalPermissions} 个`} />
          <StatCard label="管理员" value={adminCount} unit="个" ratio={accounts.length ? adminCount / accounts.length : 0} />
          <StatCard label="平均权限覆盖" value={`${Math.round(averageCoverage * 100)}%`} ratio={averageCoverage} />
          <StatCard label="当前筛选结果" value={visibleAccounts.length} unit="个" hint={query ? `关键字「${search.trim()}」` : '未使用搜索'} />
        </section>

        {/* 账户目录：左侧一个带模糊搜索的可滚动列表，右侧是选中账户的详情面板。 */}
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
                    <button type="button" key={account.username} onClick={() => { setSelectedUsername(account.username); setEditing(null); }} aria-current={active} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${active ? 'bg-cyan-300/[0.1] ring-1 ring-inset ring-cyan-300/25' : 'hover:bg-white/[0.05]'}`}>
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
              {!selectedAccount ? <div className="grid h-full min-h-48 place-items-center text-center text-sm text-slate-500">{accounts.length ? '左侧没有匹配的账户，换个关键字试试。' : '还没有任何账户，点右上角新建一个。'}</div> : <>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-300 to-cyan-300 text-xl font-bold text-slate-950 shadow-lg shadow-teal-400/10">{selectedAccount.username.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-2xl font-semibold text-white">{selectedAccount.username}</h2>{selectedAccount.isAdmin && <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">管理员</span>}{isSelf && <span className="text-xs text-slate-500">当前账户</span>}</div>
                      <p className="mt-1 text-xs text-slate-500">创建于 {dateFormatter.format(new Date(selectedAccount.createdAt))}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setEditing(isEditing ? null : { username: selectedAccount.username, permissions: selectedAccount.permissions })} className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${isEditing ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100' : 'border-white/[0.12] text-slate-200 hover:bg-white/[0.07]'}`}>管理权限</button>
                    <button onClick={() => setDialog({ type: 'password', account: selectedAccount })} className="rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-100 hover:bg-sky-400/20">更改密码</button>
                    <button disabled={isSelf} onClick={() => setDialog({ type: 'delete', account: selectedAccount })} className="rounded-lg px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:text-slate-600">删除</button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
                    <p className="text-[11px] text-slate-500">权限覆盖</p>
                    <p className="mt-1 text-xl font-semibold text-white">{selectedGranted}<span className="text-xs font-normal text-slate-500"> / {totalPermissions}</span></p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-sky-400" style={{ width: `${totalPermissions ? Math.round((selectedGranted / totalPermissions) * 100) : 0}%` }} /></div>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
                    <p className="text-[11px] text-slate-500">授权方式</p>
                    <p className="mt-1 text-sm font-medium text-white">{selectedAccount.permissions.includes('*') ? '全部权限（通配）' : '按工具逐项授权'}</p>
                    <p className="mt-2 text-[11px] text-slate-500">{selectedAccount.isAdmin ? '可进入账户管理' : '仅能访问已授权工具'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
                    <p className="text-[11px] text-slate-500">最近更新</p>
                    <p className="mt-1 text-sm font-medium text-white">{dateFormatter.format(new Date(selectedAccount.updatedAt))}</p>
                    <p className="mt-2 text-[11px] text-slate-500">权限或密码变更时间</p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between"><p className="text-sm text-slate-300">权限总览</p><p className="text-[11px] text-slate-500">高亮为已授权</p></div>
                  <PermissionMatrix all={availablePermissions} granted={selectedAccount.permissions} />
                </div>

                {isEditing && editing && <div className="mt-5 border-t border-white/[0.08] pt-5">
                  <p className="mb-3 text-sm text-slate-300">编辑 {selectedAccount.username} 的权限</p>
                  <PermissionPicker permissions={availablePermissions} selected={editing.permissions} onChange={(permissions) => setEditing({ ...editing, permissions })} disabled={saving} />
                  <div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-white">取消</button><button disabled={saving || !editing.permissions.length} onClick={() => updatePermissions(selectedAccount.username, editing.permissions)} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50">保存权限</button></div>
                </div>}
              </>}
            </div>
          </div>
        </section>
      </div>

      {dialog && <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-950/80 p-4 py-[6vh] backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
        <div className={`w-full rounded-2xl border border-white/[0.12] bg-[#0a1320] p-5 shadow-2xl ${dialog.type === 'create' ? 'max-w-2xl' : 'max-w-md'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] text-cyan-200/80">{dialog.type === 'create' ? 'NEW ACCOUNT' : dialog.type === 'password' ? 'RESET PASSWORD' : 'DELETE ACCOUNT'}</p>
              <h2 id="account-dialog-title" className="mt-2 text-xl font-semibold">{dialog.type === 'create' ? '新建账户' : dialog.type === 'password' ? `更改 ${dialog.account.username} 的密码` : `删除 ${dialog.account.username}？`}</h2>
            </div>
            <button onClick={() => setDialog(null)} className="text-slate-500 hover:text-white" aria-label="关闭">×</button>
          </div>

          {dialog.type === 'create' && <form className="mt-5 space-y-4" onSubmit={submitCreate}>
            <p className="text-sm leading-6 text-slate-400">密码至少 8 个字符。权限可稍后随时调整。</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm text-slate-300">用户名<input required name="username" autoFocus autoComplete="username" placeholder="例如 explorer" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label>
              <label className="block text-sm text-slate-300">初始密码<input required name="password" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label>
              <label className="block text-sm text-slate-300">确认密码<input required name="passwordConfirm" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label>
            </div>
            <div>
              <p className="mb-2 text-sm text-slate-300">初始权限 <span className="text-xs text-slate-500">选择该账户可以打开的工具</span></p>
              <div className="max-h-[42vh] overflow-y-auto pr-1"><PermissionPicker permissions={availablePermissions} selected={newPermissions} onChange={setNewPermissions} disabled={saving} /></div>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white">取消</button><button disabled={saving || !newPermissions.length} className="rounded-xl bg-gradient-to-r from-teal-300 to-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-teal-400/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '正在保存…' : '创建账户'}</button></div>
          </form>}

          {dialog.type === 'password' && <form className="mt-5 space-y-4" onSubmit={submitPassword}>
            <label className="block text-sm text-slate-300">新密码<input required name="password" type="password" minLength={8} autoFocus autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-white outline-none focus:border-cyan-300" /></label>
            <label className="block text-sm text-slate-300">确认新密码<input required name="passwordConfirm" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-white outline-none focus:border-cyan-300" /></label>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400">取消</button><button disabled={saving} className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">保存新密码</button></div>
          </form>}

          {dialog.type === 'delete' && <div className="mt-5">
            <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">此操作不可撤销。该账户的牌组、DND 存档和储蓄记录等所有账户数据也会一并删除。</p>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400">取消</button><button disabled={saving} onClick={deleteAccount} className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">确认删除</button></div>
          </div>}
        </div>
      </div>}
    </main>
  );
}
