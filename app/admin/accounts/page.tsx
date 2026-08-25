'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Account = {
  username: string;
  permissions: string[];
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuthUser = { username: string; isAdmin: boolean };
type Dialog = { type: 'password' | 'delete'; account: Account } | null;

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-3.5 py-3 text-sm text-rose-100">{message}</div>;
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
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-2.5 text-sm text-cyan-50 transition hover:bg-cyan-300/[0.12]">
        <input className="h-4 w-4 accent-cyan-300" type="checkbox" checked={hasAll} disabled={disabled} onChange={() => toggle('*')} />
        <span><span className="font-semibold">全部权限</span><span className="ml-2 text-xs text-cyan-100/60">管理员</span></span>
      </label>
      {permissions.map((permission) => (
        <label key={permission} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${hasAll ? 'border-white/[0.05] bg-white/[0.02] text-slate-600' : 'border-white/[0.08] bg-slate-950/25 text-slate-300 hover:border-white/[0.18] hover:bg-white/[0.04]'}`}>
          <input className="h-4 w-4 accent-violet-400" type="checkbox" checked={!hasAll && selected.includes(permission)} disabled={disabled || hasAll} onChange={() => toggle(permission)} />
          <span className="font-mono text-xs">{permission}</span>
        </label>
      ))}
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
      form.reset(); setNewPermissions([]); setNotice(`已创建账户 ${body.username}。`);
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
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(dialog.account.username)}`, { method: 'DELETE', credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '删除账户失败。');
      setAccounts((current) => current.filter((account) => account.username !== dialog.account.username));
      setNotice(`已删除账户 ${dialog.account.username} 及其所有账户数据。`); setDialog(null);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '删除账户失败。'); }
    finally { setSaving(false); }
  };

  const adminCount = useMemo(() => accounts.filter((account) => account.isAdmin).length, [accounts]);
  if (loading) return <main className="grid min-h-screen place-items-center bg-[#070915] text-sm text-slate-300">正在验证管理权限…</main>;
  if (!viewer) return <main className="grid min-h-screen place-items-center bg-[#070915] p-6 text-center text-sm text-rose-200"><ErrorMessage message={error || '无法确认管理权限。'} /></main>;

  return (
    <main className="min-h-screen bg-[#070915] px-4 py-6 text-slate-100 sm:px-6 sm:py-10">
      <div className="pointer-events-none fixed inset-0 overflow-hidden"><div className="absolute -left-40 top-0 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" /><div className="absolute right-0 top-48 h-80 w-80 rounded-full bg-cyan-400/10 blur-[110px]" /></div>
      <div className="relative mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-white/[0.1] pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div><a href="/" className="text-xs font-semibold tracking-[0.18em] text-cyan-200 hover:text-white">BOX / 管理控制台</a><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">账户与权限</h1><p className="mt-2 text-sm text-slate-400">创建账户、重设密码，并精确分配每个工作台的访问权限。</p></div>
          <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-sm"><p className="text-xs text-cyan-100/60">当前管理员</p><p className="mt-1 font-semibold text-cyan-50">{viewer.username}</p></div>
        </header>
        <div className="mt-6"><ErrorMessage message={error} />{notice && <div role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3.5 py-3 text-sm text-emerald-100">{notice}</div>}</div>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="order-2 space-y-4 xl:order-1">
            <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.15em] text-violet-300">DIRECTORY</p><h2 className="mt-1 text-xl font-semibold">现有账户 <span className="text-sm font-normal text-slate-500">{accounts.length} 个</span></h2></div><p className="text-xs text-slate-500">管理员 {adminCount} 个</p></div>
            {accounts.map((account) => {
              const isEditing = editing?.username === account.username;
              const isSelf = account.username === viewer.username;
              return <article key={account.username} className="rounded-2xl border border-white/[0.1] bg-white/[0.045] p-4 shadow-xl shadow-black/10 backdrop-blur-sm sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-300 to-cyan-300 font-bold text-slate-950">{account.username.slice(0, 1).toUpperCase()}</span><h3 className="truncate font-semibold text-white">{account.username}</h3>{account.isAdmin && <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">管理员</span>}{isSelf && <span className="text-xs text-slate-500">当前账户</span>}</div><p className="mt-3 text-xs text-slate-500">创建于 {dateFormatter.format(new Date(account.createdAt))} · 更新于 {dateFormatter.format(new Date(account.updatedAt))}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setEditing(isEditing ? null : { username: account.username, permissions: account.permissions })} className="rounded-lg border border-white/[0.12] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.07]">管理权限</button><button onClick={() => setDialog({ type: 'password', account })} className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-400/20">更改密码</button><button disabled={isSelf} onClick={() => setDialog({ type: 'delete', account })} className="rounded-lg px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:text-slate-600">删除</button></div></div>
                <div className="mt-4 flex flex-wrap gap-1.5">{account.permissions.map((permission) => <span key={permission} className="rounded-md border border-white/[0.08] bg-slate-950/40 px-2 py-1 font-mono text-[11px] text-slate-400">{permission}</span>)}</div>
                {isEditing && <div className="mt-5 border-t border-white/[0.08] pt-5"><PermissionPicker permissions={availablePermissions} selected={editing.permissions} onChange={(permissions) => setEditing({ ...editing, permissions })} disabled={saving} /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-white">取消</button><button disabled={saving || !editing.permissions.length} onClick={() => updatePermissions(account.username, editing.permissions)} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50">保存权限</button></div></div>}
              </article>;
            })}
          </div>

          <aside className="order-1 rounded-2xl border border-white/[0.1] bg-white/[0.05] p-5 shadow-2xl shadow-black/20 backdrop-blur-sm xl:order-2 xl:self-start xl:sticky xl:top-6"><p className="text-xs font-semibold tracking-[0.15em] text-cyan-200">NEW ACCOUNT</p><h2 className="mt-2 text-xl font-semibold">新建账户</h2><p className="mt-2 text-sm leading-6 text-slate-400">密码至少 8 个字符。权限可稍后随时调整。</p><form className="mt-5 space-y-4" onSubmit={submitCreate}><label className="block text-sm text-slate-300">用户名<input required name="username" autoComplete="username" placeholder="例如 explorer" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label><label className="block text-sm text-slate-300">初始密码<input required name="password" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label><label className="block text-sm text-slate-300">确认密码<input required name="passwordConfirm" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /></label><div><p className="mb-2 text-sm text-slate-300">初始权限</p><PermissionPicker permissions={availablePermissions} selected={newPermissions} onChange={setNewPermissions} disabled={saving} /></div><button disabled={saving || !newPermissions.length} className="w-full rounded-xl bg-gradient-to-r from-cyan-300 to-violet-300 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-400/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '正在保存…' : '创建账户'}</button></form></aside>
        </section>
      </div>
      {dialog && <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><div className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#101329] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.15em] text-violet-300">{dialog.type === 'password' ? 'RESET PASSWORD' : 'DELETE ACCOUNT'}</p><h2 id="account-dialog-title" className="mt-2 text-xl font-semibold">{dialog.type === 'password' ? `更改 ${dialog.account.username} 的密码` : `删除 ${dialog.account.username}？`}</h2></div><button onClick={() => setDialog(null)} className="text-slate-500 hover:text-white" aria-label="关闭">×</button></div>{dialog.type === 'password' ? <form className="mt-5 space-y-4" onSubmit={submitPassword}><label className="block text-sm text-slate-300">新密码<input required name="password" type="password" minLength={8} autoFocus autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-white outline-none focus:border-cyan-300" /></label><label className="block text-sm text-slate-300">确认新密码<input required name="passwordConfirm" type="password" minLength={8} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-slate-950/50 px-3 py-2.5 text-white outline-none focus:border-cyan-300" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400">取消</button><button disabled={saving} className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">保存新密码</button></div></form> : <div className="mt-5"><p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">此操作不可撤销。该账户的牌组、DND 存档和储蓄记录等所有账户数据也会一并删除。</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-slate-400">取消</button><button disabled={saving} onClick={deleteAccount} className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">确认删除</button></div></div>}</div></div>}
    </main>
  );
}
