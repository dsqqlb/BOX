'use client';

import { useEffect, useMemo, useState } from 'react';
import ToolGrid from './ToolGrid';
import { getAllTools } from '@/lib/tools';

const CATEGORY_MAP: Record<string, string> = {
  learning: '学习',
  ai: 'AI',
  game: '游戏',
  utility: '工具',
  visualization: '可视化',
  life: '生活',
};

interface AuthenticatedUser {
  username: string;
  allowedTools: string[];
}

export default function ToolShell() {
  const tools = useMemo(() => getAllTools(), []);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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

  const permittedTools = useMemo(() => {
    if (!user) return [];
    const allowed = new Set(user.allowedTools);
    return tools.filter((tool) => allowed.has(tool.slug));
  }, [tools, user]);

  const categories = useMemo(() => {
    const keys = [...new Set(permittedTools.map((tool) => tool.category))];
    return [{ key: 'all', label: '全部' }, ...keys.map((key) => ({ key, label: CATEGORY_MAP[key] || key }))];
  }, [permittedTools]);

  const filteredTools = useMemo(() => permittedTools.filter((tool) => {
    const matchSearch = !search
      || tool.title.toLowerCase().includes(search.toLowerCase())
      || tool.description.toLowerCase().includes(search.toLowerCase())
      || tool.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
    const matchCategory = activeCategory === 'all' || tool.category === activeCategory;
    return matchSearch && matchCategory;
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
    return <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-sm text-zinc-500 dark:text-zinc-400">正在验证访问权限…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 py-4">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索已获授权的工具..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400">已登录：{user?.username}</div>
          <button onClick={handleLogout} className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">退出登录</button>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex-shrink-0">
            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`} title="网格视图">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>
            </button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`} title="列表视图">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5" /><rect x="1" y="7" width="14" height="2" rx="0.5" /><rect x="1" y="12" width="14" height="2" rx="0.5" /></svg>
            </button>
          </div>
        </div>
      </div>

      {permittedTools.length > 0 ? (
        <>
          <div className="flex items-center gap-1 pb-6 overflow-x-auto scrollbar-none">
            {categories.map((category) => (
              <button key={category.key} onClick={() => setActiveCategory(category.key)} className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${activeCategory === category.key ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                {category.label}
              </button>
            ))}
          </div>
          <ToolGrid tools={filteredTools} viewMode={viewMode} />
        </>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-5 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">此账户目前没有被授予任何工具权限。</div>
      )}
    </div>
  );
}
