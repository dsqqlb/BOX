'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getAllTools } from '@/lib/tools';
import { Tool } from '@/lib/types';

type User = { username: string; allowedTools: string[]; isAdmin: boolean };
type Usage = { toolSlug: string; lastOpenedAt: string; openCount: number };
type ActivityDay = { dayKey: string; openCount: number };
type Milestone = { id: string; title: string; description: string; unlocked: boolean; value: number; target: number };
type ProfileSummary = {
  favoriteToolSlugs: string[];
  recentTools: Usage[];
  frequentTools: Usage[];
  activity: { days: ActivityDay[]; activeDays: number; streak: number; weekOpens: number; totalOpens: number; exploredTools: number };
  milestones: Milestone[];
};
type Tab = 'recent' | 'favorite' | 'frequent';

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value));
}

function levelFor(count: number, max: number) {
  if (!count) return 0;
  if (count <= Math.max(1, Math.ceil(max * 0.25))) return 1;
  if (count <= Math.ceil(max * 0.6)) return 2;
  return 3;
}

export default function ProfilePage() {
  const allTools = useMemo(() => getAllTools(), []);
  const [user, setUser] = useState<User | null>(null);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [tab, setTab] = useState<Tab>('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' }),
      fetch('/api/profile/summary', { cache: 'no-store', credentials: 'same-origin' }),
    ]).then(async ([userResponse, summaryResponse]) => {
      if (!userResponse.ok) throw new Error('登录状态已失效。');
      const profileUser = await userResponse.json() as User;
      if (!summaryResponse.ok) { const body = await summaryResponse.json().catch(() => ({})); throw new Error(body.error || '无法读取个人数据。'); }
      return [profileUser, await summaryResponse.json() as ProfileSummary] as const;
    }).then(([profileUser, profileSummary]) => {
      if (!cancelled) { setUser(profileUser); setSummary(profileSummary); }
    }).catch((requestError) => {
      if (!cancelled) {
        const message = requestError instanceof Error ? requestError.message : '无法加载个人中心。';
        if (/登录/.test(message)) window.location.replace('/login?next=%2Fprofile'); else setError(message);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const permittedTools = useMemo(() => !user ? [] : allTools.filter((tool) => user.allowedTools.includes(tool.slug)), [allTools, user]);
  const toolMap = useMemo(() => new Map(permittedTools.map((tool) => [tool.slug, tool])), [permittedTools]);
  const favoriteTools = useMemo(() => (summary?.favoriteToolSlugs || []).map((slug) => toolMap.get(slug)).filter((tool): tool is Tool => Boolean(tool)), [summary, toolMap]);
  const recentEntries = useMemo(() => (summary?.recentTools || []).map((entry) => ({ ...entry, tool: toolMap.get(entry.toolSlug) })).filter((entry): entry is Usage & { tool: Tool } => Boolean(entry.tool)), [summary, toolMap]);
  const frequentEntries = useMemo(() => (summary?.frequentTools || []).map((entry) => ({ ...entry, tool: toolMap.get(entry.toolSlug) })).filter((entry): entry is Usage & { tool: Tool } => Boolean(entry.tool)), [summary, toolMap]);
  const categories = useMemo(() => new Set(permittedTools.map((tool) => tool.category)).size, [permittedTools]);
  const visibleEntries = tab === 'recent' ? recentEntries : tab === 'frequent' ? frequentEntries : favoriteTools.map((tool) => ({ tool, toolSlug: tool.slug, lastOpenedAt: '', openCount: 0 }));

  const recordToolUsage = (slug: string) => {
    void fetch('/api/home/tool-usage', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toolSlug: slug }), keepalive: true });
  };
  const toggleFavorite = async (slug: string) => {
    if (!summary) return;
    const current = summary.favoriteToolSlugs;
    const favoriteToolSlugs = current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug];
    setSummary({ ...summary, favoriteToolSlugs });
    const response = await fetch('/api/home/preferences', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favoriteToolSlugs }) });
    if (!response.ok) setSummary(summary);
  };

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#060a10] text-sm text-slate-300">正在整理你的个人工作台…</main>;
  if (!user || !summary) return <main className="grid min-h-screen place-items-center bg-[#060a10] p-6 text-center text-sm text-rose-200">{error || '无法加载个人中心。'}</main>;

  const maxActivity = Math.max(...summary.activity.days.map((day) => day.openCount), 1);
  const usedToolSet = new Set([...recentEntries, ...frequentEntries].map((entry) => entry.toolSlug));

  return <main className="min-h-screen bg-[#060a10] px-4 py-6 text-slate-100 sm:px-6 sm:py-10">
    <div className="pointer-events-none fixed inset-0 overflow-hidden"><div className="absolute -left-36 top-0 h-96 w-96 rounded-full bg-teal-500/20 blur-[120px]" /><div className="absolute right-0 top-64 h-80 w-80 rounded-full bg-sky-400/10 blur-[110px]" /></div>
    <div className="relative mx-auto max-w-6xl">
      <header className="flex items-center justify-between gap-4"><Link href="/" className="text-xs font-semibold tracking-[0.18em] text-cyan-200 hover:text-white">BOX / 个人中心</Link><Link href="/" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300 transition hover:bg-white/[0.08]">进入工作台 →</Link></header>

      <section className="mt-6 overflow-hidden rounded-3xl border border-white/[0.1] bg-white/[0.045] shadow-2xl shadow-black/20 backdrop-blur-sm">
        <div className="relative p-5 sm:p-8"><div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-cyan-300/10 blur-[70px]" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4"><span className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-teal-300 via-cyan-300 to-sky-400 text-3xl font-bold text-slate-950 shadow-xl shadow-teal-400/15">{user.username.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="text-xs font-semibold tracking-[0.15em] text-cyan-200/80">PERSONAL WORKSPACE</p><h1 className="mt-1 truncate text-3xl font-semibold tracking-tight text-white">{user.username}</h1><p className="mt-1 text-sm text-slate-400">{user.isAdmin ? '工作区管理员 · 可管理账户与权限' : '已登录账户 · 私人工具空间'}</p></div></div>
            <div className="flex flex-wrap gap-2"><Link href="/" className="rounded-xl bg-gradient-to-r from-teal-300 to-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:brightness-110">进入工作台</Link>{user.isAdmin && <Link href="/admin/accounts" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.14]">账户管理</Link>}</div>
          </div>
          <div className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[[permittedTools.length, '已授权工具'], [favoriteTools.length, '收藏工具'], [summary.activity.exploredTools, '已使用工具'], [categories, '工具分类']].map(([value, label]) => <div key={String(label)} className="rounded-2xl border border-white/[0.08] bg-black/15 px-4 py-3"><p className="text-2xl font-semibold text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.65fr)]">
        <section className="overflow-hidden rounded-3xl border border-white/[0.1] bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.14em] text-cyan-200/80">YOUR TOOLKIT</p><h2 className="mt-1 text-xl font-semibold">常用工具</h2></div><div className="flex rounded-xl border border-white/[0.09] bg-black/15 p-1">{([['recent', '最近'], ['favorite', '收藏'], ['frequent', '常用']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-3 py-1.5 text-xs transition ${tab === key ? 'bg-cyan-300/15 text-cyan-100' : 'text-slate-500 hover:text-slate-200'}`}>{label}</button>)}</div></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {visibleEntries.length ? visibleEntries.map((entry) => <article key={entry.tool.slug} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3 transition hover:border-cyan-200/25 hover:bg-white/[0.045]"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-xl">{entry.tool.icon}</span><Link href={`/tools/${entry.tool.slug}`} onClick={() => recordToolUsage(entry.tool.slug)} className="min-w-0 flex-1 focus:outline-none"><h3 className="truncate text-sm font-semibold text-white group-hover:text-cyan-100">{entry.tool.title}</h3><p className="mt-0.5 truncate text-xs text-slate-500">{tab === 'recent' ? `最近打开 · ${relativeTime(entry.lastOpenedAt)}` : tab === 'frequent' ? `累计打开 ${entry.openCount} 次` : entry.tool.description}</p></Link><button onClick={() => void toggleFavorite(entry.tool.slug)} title={summary.favoriteToolSlugs.includes(entry.tool.slug) ? '取消收藏' : '收藏'} className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs ${summary.favoriteToolSlugs.includes(entry.tool.slug) ? 'text-amber-200' : 'text-slate-600 hover:text-amber-100'}`}>★</button></article>) : <p className="col-span-2 py-10 text-center text-sm text-slate-500">这里还没有记录。打开工具或收藏它们后会出现在这里。</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5"><p className="text-xs font-semibold tracking-[0.14em] text-cyan-200/80">THIS WEEK</p><h2 className="mt-1 text-xl font-semibold">本周回顾</h2><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl bg-black/15 p-3"><p className="text-xl font-semibold text-white">{summary.activity.weekOpens}</p><p className="mt-1 text-[11px] text-slate-500">打开次数</p></div><div className="rounded-xl bg-black/15 p-3"><p className="text-xl font-semibold text-white">{summary.activity.streak}</p><p className="mt-1 text-[11px] text-slate-500">连续天数</p></div><div className="rounded-xl bg-black/15 p-3"><p className="text-xl font-semibold text-white">{summary.activity.activeDays}</p><p className="mt-1 text-[11px] text-slate-500">70 天活跃</p></div></div><p className="mt-4 text-sm leading-6 text-slate-400">{summary.activity.weekOpens ? `这周你已经打开工具 ${summary.activity.weekOpens} 次。` : '从今天第一次打开工具开始，周报会在这里慢慢生长。'}</p></section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.65fr)]">
        <section className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.14em] text-cyan-200/80">ACTIVITY</p><h2 className="mt-1 text-xl font-semibold">使用热力图</h2></div><p className="text-xs text-slate-500">近 70 天 · UTC</p></div><div className="mt-5 grid grid-flow-col grid-rows-7 gap-1.5 overflow-x-auto pb-1">{summary.activity.days.map((day) => <span key={day.dayKey} title={`${day.dayKey} · ${day.openCount} 次`} className={`h-4 w-4 rounded-[4px] ${['bg-white/[0.04]', 'bg-cyan-300/15', 'bg-cyan-300/35', 'bg-cyan-300/70'][levelFor(day.openCount, maxActivity)]}`} />)}</div><div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-slate-500"><span>少</span>{[0, 1, 2, 3].map((level) => <span key={level} className={`h-3 w-3 rounded-[3px] ${['bg-white/[0.04]', 'bg-cyan-300/15', 'bg-cyan-300/35', 'bg-cyan-300/70'][level]}`} />)}<span>多</span></div>
          <div className="mt-5 border-t border-white/[0.07] pt-4"><p className="text-sm text-slate-300">最近使用</p><div className="mt-3 space-y-2">{recentEntries.slice(0, 4).map((entry) => <Link key={entry.tool.slug} href={`/tools/${entry.tool.slug}`} onClick={() => recordToolUsage(entry.tool.slug)} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.045]"><span>{entry.tool.icon}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-300">{entry.tool.title}</span><span className="text-xs text-slate-500">{relativeTime(entry.lastOpenedAt)}</span></Link>)}{!recentEntries.length && <p className="text-sm text-slate-500">暂无使用记录。</p>}</div></div>
        </section>
        <section className="rounded-3xl border border-white/[0.1] bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5"><p className="text-xs font-semibold tracking-[0.14em] text-cyan-200/80">MILESTONES</p><h2 className="mt-1 text-xl font-semibold">个人里程碑</h2><div className="mt-4 space-y-3">{summary.milestones.map((milestone) => <div key={milestone.id} className={`rounded-2xl border p-3 ${milestone.unlocked ? 'border-cyan-300/20 bg-cyan-300/[0.07]' : 'border-white/[0.06] bg-black/10 opacity-60'}`}><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-white">{milestone.unlocked ? '✦ ' : '○ '}{milestone.title}</p><span className="text-xs text-slate-400">{milestone.value}/{milestone.target}</span></div><p className="mt-1 text-xs text-slate-500">{milestone.description}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-cyan-300/70" style={{ width: `${Math.min(100, milestone.value / milestone.target * 100)}%` }} /></div></div>)}</div></section>
      </div>

      <section className="mt-5 rounded-3xl border border-white/[0.1] bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.14em] text-cyan-200/80">COLLECTION</p><h2 className="mt-1 text-xl font-semibold">工具收藏集</h2></div><p className="text-xs text-slate-500">高亮为已使用或已收藏</p></div><div className="mt-4 flex flex-wrap gap-2">{permittedTools.map((tool) => { const active = usedToolSet.has(tool.slug) || summary.favoriteToolSlugs.includes(tool.slug); return <Link key={tool.slug} href={`/tools/${tool.slug}`} onClick={() => recordToolUsage(tool.slug)} title={tool.description} className={`inline-flex max-w-[13rem] items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${active ? 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-50 hover:bg-cyan-300/[0.14]' : 'border-white/[0.07] bg-black/10 text-slate-600 hover:text-slate-300'}`}><span className={active ? '' : 'grayscale opacity-50'}>{tool.icon}</span><span className="truncate">{tool.title}</span></Link>; })}</div></section>
    </div>
  </main>;
}
