'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ToolGrid from './ToolGrid';
import HomeHero from './HomeHero';
import { getAllTools } from '@/lib/tools';
import { Tool } from '@/lib/types';

const CATEGORY_MAP: Record<string, { label: string; icon: string }> = {
  learning: { label: '学习', icon: '◈' }, ai: { label: 'AI', icon: '✦' }, game: { label: '游戏', icon: '◇' },
  utility: { label: '工具', icon: '⊞' }, visualization: { label: '可视化', icon: '◎' }, life: { label: '生活', icon: '○' },
};
const THEME_KEYS = ['midnight', 'aurora', 'paper', 'sunset'] as const;
type ThemeKey = typeof THEME_KEYS[number];
const THEMES: Record<ThemeKey, { name: string; description: string; swatch: string; background: string; header: string; panel: string; text: string; muted: string; accent: string }> = {
  midnight: { name: '深海午夜', description: '墨蓝底色与冷青高光', swatch: 'from-teal-400 via-cyan-500 to-sky-500', background: 'bg-[radial-gradient(circle_at_12%_0%,rgba(13,148,136,.26),transparent_30%),radial-gradient(circle_at_88%_16%,rgba(56,189,248,.14),transparent_27%),linear-gradient(180deg,#0c1a22_0%,#08111a_46%,#060a10_100%)]', header: 'border-white/[0.08] bg-[#08111a]/60', panel: 'border-white/[0.1] bg-white/[0.045]', text: 'text-white', muted: 'text-slate-400', accent: 'text-cyan-200/80' },
  aurora: { name: '极光森林', description: '翡翠绿与蓝绿色光晕', swatch: 'from-emerald-400 via-teal-500 to-cyan-400', background: 'bg-[radial-gradient(circle_at_10%_0%,rgba(16,185,129,.25),transparent_32%),radial-gradient(circle_at_88%_15%,rgba(6,182,212,.18),transparent_27%),linear-gradient(180deg,#09231f_0%,#061513_48%,#040b0a_100%)]', header: 'border-emerald-100/[0.09] bg-[#061513]/65', panel: 'border-emerald-100/[0.1] bg-emerald-50/[0.035]', text: 'text-white', muted: 'text-emerald-100/55', accent: 'text-emerald-200/90' },
  paper: { name: '纸页晨光', description: '暖白纸张与深蓝文字', swatch: 'from-amber-100 via-orange-200 to-sky-300', background: 'bg-[radial-gradient(circle_at_8%_0%,rgba(251,191,36,.19),transparent_27%),radial-gradient(circle_at_90%_12%,rgba(56,189,248,.16),transparent_28%),linear-gradient(180deg,#fffdf7_0%,#f4f0e8_53%,#e9eef2_100%)]', header: 'border-slate-900/[0.09] bg-white/70', panel: 'border-slate-900/[0.1] bg-white/65', text: 'text-slate-900', muted: 'text-slate-600', accent: 'text-sky-700' },
  sunset: { name: '落日余晖', description: '玫瑰橙与暖褐暮色', swatch: 'from-rose-400 via-orange-400 to-amber-300', background: 'bg-[radial-gradient(circle_at_12%_0%,rgba(251,113,133,.25),transparent_30%),radial-gradient(circle_at_88%_15%,rgba(249,115,22,.18),transparent_27%),linear-gradient(180deg,#2c1519_0%,#1a0d0e_50%,#100807_100%)]', header: 'border-rose-100/[0.09] bg-[#1a0d0e]/65', panel: 'border-rose-100/[0.1] bg-rose-50/[0.035]', text: 'text-white', muted: 'text-rose-100/60', accent: 'text-rose-200/90' },
};
interface AuthenticatedUser { username: string; allowedTools: string[]; isAdmin: boolean; }
interface HomePreferences { favoriteToolSlugs: string[]; toolOrder: string[]; collapsedCategories: string[]; theme: ThemeKey; viewMode: 'grid' | 'list'; recentTools: { toolSlug: string; lastOpenedAt: string; openCount: number }[]; }
const defaultPreferences: HomePreferences = { favoriteToolSlugs: [], toolOrder: [], collapsedCategories: [], theme: 'midnight', viewMode: 'grid', recentTools: [] };

function BoxMark() { return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 2.5 11 5.8v15.4L16 29.5 5 23.7V8.3L16 2.5Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /><path d="M5.3 8.5 16 14.2 26.7 8.5M16 14.2v15" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>; }
function GridIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>; }
function ListIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3h12M2 8h12M2 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>; }

export default function ToolShell() {
  const allTools = useMemo(() => getAllTools(), []);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [toolOrder, setToolOrder] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeKey>('midnight');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const skipInitialPersist = useRef(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => { if (!response.ok) throw new Error('未登录'); return response.json() as Promise<AuthenticatedUser>; })
      .then((nextUser) => { if (!cancelled) setUser(nextUser); })
      .catch(() => { if (!cancelled) window.location.replace('/login'); })
      .finally(() => { if (!cancelled) setAuthResolved(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/home/preferences', { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => { if (!response.ok) throw new Error('偏好不可用'); return response.json() as Promise<HomePreferences>; })
      .then((saved) => {
        if (cancelled) return;
        setFavorites(saved.favoriteToolSlugs || []); setToolOrder(saved.toolOrder || []); setCollapsedCategories(saved.collapsedCategories || []);
        setTheme(THEME_KEYS.includes(saved.theme) ? saved.theme : 'midnight'); setViewMode(saved.viewMode === 'list' ? 'list' : 'grid');
      })
      .catch(() => { /* Workspace remains usable with local defaults; saving will retry on later changes. */ })
      .finally(() => { if (!cancelled) { skipInitialPersist.current = true; setPreferencesReady(true); } });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenuOpen(false);
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) setThemeMenuOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandPaletteOpen(true); }
      if (event.key === 'Escape') { setAccountMenuOpen(false); setThemeMenuOpen(false); setCommandPaletteOpen(false); }
    };
    document.addEventListener('mousedown', closeMenus); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('mousedown', closeMenus); document.removeEventListener('keydown', keyboard); };
  }, []);

  useEffect(() => { if (commandPaletteOpen) window.setTimeout(() => commandInputRef.current?.focus(), 0); else setCommandQuery(''); }, [commandPaletteOpen]);
  useEffect(() => {
    if (!preferencesReady || !user) return;
    if (skipInitialPersist.current) { skipInitialPersist.current = false; return; }
    const timer = window.setTimeout(() => {
      void fetch('/api/home/preferences', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favoriteToolSlugs: favorites, toolOrder, collapsedCategories, theme, viewMode }) });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [favorites, toolOrder, collapsedCategories, theme, viewMode, preferencesReady, user]);

  const permittedTools = useMemo(() => {
    if (!user) return [];
    const allowed = new Set(user.allowedTools);
    return allTools.filter((tool) => allowed.has(tool.slug));
  }, [allTools, user]);
  const orderedTools = useMemo(() => {
    const positions = new Map(toolOrder.map((slug, index) => [slug, index]));
    return [...permittedTools].sort((left, right) => (positions.get(left.slug) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.slug) ?? Number.MAX_SAFE_INTEGER));
  }, [permittedTools, toolOrder]);
  const categories = useMemo(() => [...new Set(orderedTools.map((tool) => tool.category))], [orderedTools]);
  const query = search.trim().toLocaleLowerCase();
  const matchesSearch = (tool: Tool, value = query) => !value || [tool.title, tool.description, ...tool.tags].some((part) => part.toLocaleLowerCase().includes(value));
  const commandTools = useMemo(() => orderedTools.filter((tool) => matchesSearch(tool, commandQuery.trim().toLocaleLowerCase())).slice(0, 8), [orderedTools, commandQuery]);
  const currentTheme = THEMES[theme];
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const toggleFavorite = (slug: string) => setFavorites((current) => current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]);
  const toggleCategory = (category: string) => setCollapsedCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  const recordToolUsage = (slug: string) => {
    // 只把使用记录写进服务器，不在当前页面立刻改“最近使用”区：
    // 否则点击卡片后首页会在跳转前先重排，出现卡片“突然和别的卡片换位置”的感觉。
    void fetch('/api/home/tool-usage', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toolSlug: slug }), keepalive: true });
  };
  const openFromCommand = (slug: string) => { recordToolUsage(slug); window.location.assign(`/tools/${slug}`); };
  const handleLogout = async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }); window.location.replace('/login'); };

  if (!authResolved) return <div className="grid min-h-screen place-items-center bg-[#060a10] px-6 text-slate-300"><div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm shadow-2xl"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />正在验证你的工作空间…</div></div>;

  return <div data-home-theme={theme} className={`home-workspace relative isolate min-h-screen ${theme === 'paper' ? 'home-paper' : ''}`}>
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"><div className={`absolute inset-0 ${currentTheme.background}`} /><div className="absolute inset-x-0 top-0 h-[640px] opacity-30 [background-image:linear-gradient(rgba(148,163,184,.1)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.1)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent)]" /></div>
    <header className={`relative z-50 border-b backdrop-blur-xl ${currentTheme.header}`}><div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <a href="/" className="group flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-sky-600 text-white shadow-lg"><BoxMark /></span><span><span className={`block text-base font-bold tracking-[0.18em] ${currentTheme.text}`}>BOX</span><span className={`block text-[10px] font-medium tracking-[0.14em] ${currentTheme.muted}`}>PRIVATE WORKSPACE</span></span></a>
      <div className="flex items-center gap-2 sm:gap-3"><button type="button" onClick={() => setCommandPaletteOpen(true)} className={`hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs transition hover:opacity-90 sm:flex ${theme === 'paper' ? 'border-slate-900/10 bg-white/70 text-slate-600' : 'border-white/10 bg-white/[0.045] text-slate-300'}`}><span>搜索工具</span><kbd className="rounded border border-current/20 px-1.5 py-0.5 text-[10px]">⌘ K</kbd></button>
        <div className="relative" ref={accountMenuRef}><button type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-expanded={accountMenuOpen} aria-haspopup="menu" className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-2 transition sm:pr-3 ${theme === 'paper' ? 'border-slate-900/10 bg-white/70' : 'border-white/10 bg-white/[0.045]'}`}><span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-cyan-300 to-teal-500 text-xs font-bold text-slate-950">{user?.username.slice(0, 1).toUpperCase()}</span><span className={`hidden max-w-28 truncate text-xs font-medium sm:block ${currentTheme.text}`}>{user?.username}</span></button>{accountMenuOpen && <div role="menu" className="absolute right-0 z-[60] mt-2 w-56 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b1420]/95 p-1.5 shadow-2xl backdrop-blur-xl"><div className="border-b border-white/[0.08] px-3 py-2.5"><p className="truncate text-sm font-semibold text-white">{user?.username}</p><p className="mt-0.5 text-[11px] text-slate-500">{user?.isAdmin ? '工作区管理员' : '已登录账户'}</p></div><a role="menuitem" href="/profile" className="mt-1 flex rounded-xl px-3 py-2.5 text-sm text-cyan-100 hover:bg-cyan-300/[0.1]">个人中心</a>{user?.isAdmin && <a role="menuitem" href="/admin/accounts" className="mt-1 flex rounded-xl px-3 py-2.5 text-sm text-cyan-100 hover:bg-cyan-300/[0.1]">账户管理</a>}<button role="menuitem" onClick={handleLogout} className="mt-1 flex w-full rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-rose-400/10 hover:text-rose-100">退出登录</button></div>}</div>
      </div></div></header>
    <main className="mx-auto max-w-7xl px-4 pb-14 pt-9 sm:px-6 sm:pt-12 lg:px-8"><HomeHero username={user?.username || ''} toolCount={permittedTools.length} categoryCount={categories.length} paper={theme === 'paper'} panelClass={currentTheme.panel} textClass={currentTheme.text} mutedClass={currentTheme.muted} accentClass={currentTheme.accent} />
      {/* 工具栏抬到 z-40：主题下拉要盖住后面的收藏/最近入口条（它有 backdrop-blur，会形成新的绘制层）。 */}
      <section className="relative z-40 mt-8"><div className="flex flex-col gap-3 rounded-2xl border border-white/[0.09] bg-slate-950/20 p-3 backdrop-blur-sm lg:flex-row lg:items-center"><label className={`flex flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 ${theme === 'paper' ? 'border-slate-900/10 bg-white/75 text-slate-700' : 'border-white/[0.09] bg-black/15 text-slate-300'}`}><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、描述或标签…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500" /><span className="hidden text-xs text-slate-500 sm:block">{orderedTools.filter((tool) => matchesSearch(tool)).length} 个结果</span></label><div className="flex items-center justify-between gap-2"><div className="relative" ref={themeMenuRef}><button type="button" onClick={() => setThemeMenuOpen((open) => !open)} className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition ${theme === 'paper' ? 'border-slate-900/10 bg-white/75 text-slate-700' : 'border-white/[0.09] bg-black/15 text-slate-300'}`}>◐ {currentTheme.name}</button>{themeMenuOpen && <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-white/[0.12] bg-[#0b1420]/95 p-2 shadow-2xl backdrop-blur-xl">{THEME_KEYS.map((key) => <button type="button" key={key} onClick={() => { setTheme(key); setThemeMenuOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${key === theme ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'}`}><span className={`h-9 w-9 rounded-xl bg-gradient-to-br ${THEMES[key].swatch}`} /><span><span className="block text-sm font-medium text-white">{THEMES[key].name}</span><span className="block text-xs text-slate-400">{THEMES[key].description}</span></span></button>)}</div>}</div><div className={`flex rounded-xl border p-1 ${theme === 'paper' ? 'border-slate-900/10 bg-white/75 text-slate-600' : 'border-white/[0.09] bg-black/15 text-slate-400'}`}><button type="button" title="网格视图" onClick={() => setViewMode('grid')} className={`grid h-8 w-8 place-items-center rounded-lg ${viewMode === 'grid' ? 'bg-cyan-300/20 text-cyan-100' : ''}`}><GridIcon /></button><button type="button" title="列表视图" onClick={() => setViewMode('list')} className={`grid h-8 w-8 place-items-center rounded-lg ${viewMode === 'list' ? 'bg-cyan-300/20 text-cyan-100' : ''}`}><ListIcon /></button></div></div></div></section>
      <section className="mt-8"><div className="mb-5"><p className={`text-xs font-semibold tracking-[0.14em] ${currentTheme.accent}`}>TOOL LIBRARY</p><h2 className={`mt-1 text-xl font-semibold ${currentTheme.text}`}>{query ? '搜索结果' : '全部工具'}</h2><p className={`mt-1 text-sm ${currentTheme.muted}`}>{query ? '搜索时会自动显示所有匹配分类。' : '点击分类标题可折叠或展开整类工具。'}</p></div>{categories.map((category) => { const categoryTools = orderedTools.filter((tool) => tool.category === category && matchesSearch(tool)); if (!categoryTools.length) return null; const isCollapsed = !query && collapsedCategories.includes(category); const meta = CATEGORY_MAP[category] || { label: category, icon: '◇' }; return <section key={category} className={`mb-5 overflow-hidden rounded-2xl border ${theme === 'paper' ? 'border-slate-900/[0.1] bg-white/55' : 'border-white/[0.09] bg-black/10'}`}><button type="button" onClick={() => toggleCategory(category)} aria-expanded={!isCollapsed} className={`flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition sm:px-5 ${theme === 'paper' ? 'hover:bg-slate-900/[0.035]' : 'hover:bg-white/[0.035]'}`}><span className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300/10 text-lg text-cyan-100">{meta.icon}</span><span><span className={`block text-base font-semibold ${currentTheme.text}`}>{meta.label}</span><span className={`block text-xs ${currentTheme.muted}`}>{categoryTools.length} 个工具</span></span></span><span className={`text-sm transition-transform ${currentTheme.muted} ${isCollapsed ? '-rotate-90' : ''}`}>⌄</span></button>{!isCollapsed && <div className="border-t border-white/[0.07] p-4 sm:p-5"><ToolGrid tools={categoryTools} viewMode={viewMode} favorites={favoriteSet} onToggleFavorite={toggleFavorite} onToolOpen={recordToolUsage} /></div>}</section>; })}</section>
    </main>
    {commandPaletteOpen && <div role="dialog" aria-modal="true" aria-label="打开工具" className="fixed inset-0 z-[80] grid place-items-start overflow-y-auto bg-slate-950/70 px-4 py-[10vh] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandPaletteOpen(false); }}><div className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/[0.14] bg-[#0a1320]/95 shadow-2xl"><div className="flex items-center gap-3 border-b border-white/[0.09] px-4 py-4"><span className="text-cyan-200">⌕</span><input ref={commandInputRef} value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="输入工具名称或标签…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500" /><kbd className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400">ESC</kbd></div><div className="max-h-[55vh] overflow-y-auto p-2">{commandTools.length ? commandTools.map((tool) => <button type="button" key={tool.slug} onClick={() => openFromCommand(tool.slug)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-white/[0.07]"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07] text-xl">{tool.icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{tool.title}</span><span className="mt-0.5 block truncate text-xs text-slate-400">{tool.description}</span></span><span className="text-slate-500">↵</span></button>) : <p className="px-3 py-10 text-center text-sm text-slate-500">没有匹配的已授权工具。</p>}</div><p className="border-t border-white/[0.09] px-4 py-3 text-xs text-slate-500">只显示当前账户可访问的工具</p></div></div>}
  </div>;
}
