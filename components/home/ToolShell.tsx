'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ToolGrid from './ToolGrid';
import { getAllTools } from '@/lib/tools';

const CATEGORY_MAP: Record<string, { label: string; icon: string }> = {
  learning: { label: '学习', icon: '◈' },
  ai: { label: 'AI', icon: '✦' },
  game: { label: '游戏', icon: '◇' },
  utility: { label: '工具', icon: '⊞' },
  visualization: { label: '可视化', icon: '◎' },
  life: { label: '生活', icon: '○' },
};

interface AuthenticatedUser {
  username: string;
  allowedTools: string[];
  isAdmin: boolean;
}

function GridIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>;
}

function ListIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="2" width="14" height="2" rx="1" /><rect x="1" y="7" width="14" height="2" rx="1" /><rect x="1" y="12" width="14" height="2" rx="1" /></svg>;
}

function BoxMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="m16 2.5 11 5.8v15.4L16 29.5 5 23.7V8.3L16 2.5Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M5.3 8.5 16 14.2 26.7 8.5M16 14.2v15" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="m11.5 11.8 4.5 2.4 4.5-2.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ToolShell() {
  const tools = useMemo(() => getAllTools(), []);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // 首页只负责导航体验；真正的工具、API 与 WebSocket 权限仍由 server/index.js 强制执行。
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error('未登录');
        return response.json() as Promise<AuthenticatedUser>;
      })
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser);
      })
      .catch(() => {
        if (!cancelled) window.location.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setAuthResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const closeForOutsideClick = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', closeForOutsideClick);
    document.addEventListener('keydown', closeForEscape);
    return () => {
      document.removeEventListener('mousedown', closeForOutsideClick);
      document.removeEventListener('keydown', closeForEscape);
    };
  }, []);

  const permittedTools = useMemo(() => {
    if (!user) return [];
    const allowed = new Set(user.allowedTools);
    return tools.filter((tool) => allowed.has(tool.slug));
  }, [tools, user]);

  const categories = useMemo(() => {
    const keys = [...new Set(permittedTools.map((tool) => tool.category))];
    return [{ key: 'all', label: '全部工具', icon: '✦' }, ...keys.map((key) => ({
      key,
      label: CATEGORY_MAP[key]?.label || key,
      icon: CATEGORY_MAP[key]?.icon || '◇',
    }))];
  }, [permittedTools]);

  const filteredTools = useMemo(() => permittedTools.filter((tool) => {
    const query = search.toLowerCase().trim();
    const matchSearch = !query
      || tool.title.toLowerCase().includes(query)
      || tool.description.toLowerCase().includes(query)
      || tool.tags.some((tag) => tag.toLowerCase().includes(query));
    return matchSearch && (activeCategory === 'all' || tool.category === activeCategory);
  }), [permittedTools, search, activeCategory]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
    window.location.replace('/login');
  };

  if (!authResolved) {
    return (
      <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070915] px-6 text-slate-300">
        <div className="absolute h-72 w-72 rounded-full bg-violet-600/20 blur-[100px]" />
        <div className="relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm shadow-2xl backdrop-blur-xl">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,.9)]" />
          正在验证你的工作空间…
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate min-h-screen">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(91,77,211,.26),transparent_30%),radial-gradient(circle_at_88%_16%,rgba(8,145,178,.16),transparent_27%),linear-gradient(180deg,#10132d_0%,#080a18_46%,#070915_100%)]" />
        <div className="absolute inset-x-0 top-0 h-[640px] opacity-40 [background-image:linear-gradient(rgba(148,163,184,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.08)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="absolute -left-28 top-52 h-80 w-80 rounded-full bg-indigo-500/10 blur-[110px]" />
        <div className="absolute -right-24 top-72 h-72 w-72 rounded-full bg-cyan-400/10 blur-[110px]" />
      </div>

      <header className="relative z-50 border-b border-white/[0.08] bg-[#080a18]/60 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="/" className="group flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-gradient-to-br from-violet-400 to-indigo-600 text-white shadow-[0_8px_30px_rgba(99,102,241,.35)] transition-transform duration-300 group-hover:scale-105"><BoxMark /></span>
            <span>
              <span className="block text-base font-bold tracking-[0.18em] text-white">BOX</span>
              <span className="block text-[10px] font-medium tracking-[0.14em] text-slate-500">PRIVATE WORKSPACE</span>
            </span>
          </a>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs text-slate-300 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,.9)]" />
              已安全连接
            </div>
            <div className="relative" ref={accountMenuRef}>
              <button type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-expanded={accountMenuOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] py-1 pl-1 pr-2 text-left transition hover:border-white/[0.2] hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:pr-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-cyan-300 to-violet-400 text-xs font-bold text-slate-950">{user?.username.slice(0, 1).toUpperCase()}</span>
                <span className="hidden max-w-28 truncate text-xs font-medium text-slate-200 sm:block">{user?.username}</span>
                <svg className={`hidden h-3.5 w-3.5 text-slate-400 transition-transform sm:block ${accountMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
              </button>
              {accountMenuOpen && (
                <div role="menu" className="absolute right-0 z-[60] mt-2 w-56 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#11152b]/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
                  <div className="border-b border-white/[0.08] px-3 py-2.5"><p className="truncate text-sm font-semibold text-white">{user?.username}</p><p className="mt-0.5 text-[11px] text-slate-500">{user?.isAdmin ? '工作区管理员' : '已登录账户'}</p></div>
                  {user?.isAdmin && <a role="menuitem" href="/admin/accounts" onClick={() => setAccountMenuOpen(false)} className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-cyan-100 transition hover:bg-cyan-300/[0.1] hover:text-white"><span className="text-cyan-300">⌘</span>账户管理</a>}
                  <button role="menuitem" onClick={handleLogout} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-rose-400/10 hover:text-rose-100"><span className="text-rose-300">↗</span>退出登录</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.1] bg-white/[0.045] px-5 py-7 shadow-[0_24px_70px_rgba(0,0,0,.28)] backdrop-blur-sm sm:px-8 sm:py-9">
          <div className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full border border-violet-300/20" />
          <div className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-violet-500/15 blur-2xl" />
          <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div>
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-cyan-200/80"><span className="h-px w-7 bg-cyan-300/70" /> PERSONAL COMMAND CENTER</p>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">你好，{user?.username}。<br className="hidden sm:block" />今天想打开哪个工具？</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">一个只属于你的创作、学习和游戏工作台。所有入口均受账户权限保护。</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div className="min-w-[118px] rounded-2xl border border-white/[0.09] bg-slate-950/30 px-4 py-3">
                <p className="text-[11px] font-medium tracking-wide text-slate-500">已授权工具</p>
                <p className="mt-1 text-2xl font-semibold text-white">{permittedTools.length}<span className="ml-1 text-xs font-medium text-slate-500">个</span></p>
              </div>
              <div className="min-w-[118px] rounded-2xl border border-white/[0.09] bg-slate-950/30 px-4 py-3">
                <p className="text-[11px] font-medium tracking-wide text-slate-500">工具分类</p>
                <p className="mt-1 text-2xl font-semibold text-white">{categories.length - 1}<span className="ml-1 text-xs font-medium text-slate-500">类</span></p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-9">
          <div className="flex flex-col gap-4 border-b border-white/[0.09] pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-violet-300">TOOL LIBRARY</p>
              <h2 className="mt-1 text-xl font-semibold text-white">工具库</h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block min-w-0 sm:w-72">
                <span className="sr-only">搜索已授权工具</span>
                <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></svg>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工具、标签或功能…" className="w-full rounded-xl border border-white/[0.1] bg-slate-950/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 hover:border-white/[0.18] focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-300/10" />
              </label>
              <div className="flex rounded-xl border border-white/[0.1] bg-slate-950/40 p-1">
                <button onClick={() => setViewMode('grid')} className={`grid h-9 w-9 place-items-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${viewMode === 'grid' ? 'bg-white/[0.12] text-white shadow-sm' : 'text-slate-500 hover:text-slate-200'}`} title="网格视图" aria-label="网格视图"><GridIcon /></button>
                <button onClick={() => setViewMode('list')} className={`grid h-9 w-9 place-items-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${viewMode === 'list' ? 'bg-white/[0.12] text-white shadow-sm' : 'text-slate-500 hover:text-slate-200'}`} title="列表视图" aria-label="列表视图"><ListIcon /></button>
              </div>
            </div>
          </div>

          {permittedTools.length > 0 ? (
            <>
              <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-5">
                {categories.map((category) => (
                  <button key={category.key} onClick={() => setActiveCategory(category.key)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${activeCategory === category.key ? 'border-violet-300/45 bg-violet-400/15 text-white shadow-[0_8px_24px_rgba(124,58,237,.16)]' : 'border-white/[0.08] bg-white/[0.025] text-slate-400 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-slate-200'}`}>
                    <span className="text-xs text-cyan-200">{category.icon}</span>{category.label}
                  </button>
                ))}
              </div>
              <ToolGrid tools={filteredTools} viewMode={viewMode} />
            </>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-white/[0.15] bg-white/[0.025] px-5 py-14 text-center">
              <p className="text-base font-medium text-white">还没有可用工具</p>
              <p className="mt-2 text-sm text-slate-500">请联系管理员为这个账户授予工具权限。</p>
            </div>
          )}
        </section>
      </div>

      <footer className="border-t border-white/[0.08] px-4 py-7 text-center text-xs text-slate-600">
        <span className="font-semibold tracking-[0.18em] text-slate-500">BOX</span><span className="mx-2 text-slate-800">/</span>PRIVATE TOOL WORKSPACE
      </footer>
    </div>
  );
}
