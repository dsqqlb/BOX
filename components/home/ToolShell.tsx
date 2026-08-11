'use client';

import { useState, useMemo } from 'react';
import ToolGrid from './ToolGrid';
import { getAllTools } from '@/lib/tools';
import { ToolCategory } from '@/lib/types';

const CATEGORY_MAP: Record<string, string> = {
  learning: '学习',
  ai: 'AI',
  game: '游戏',
  utility: '工具',
  visualization: '可视化',
  life: '生活',
};

export default function ToolShell() {
  const tools = useMemo(() => getAllTools(), []);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // 从数据中提取分类
  const categories = useMemo(() => {
    const keys = [...new Set(tools.map((t) => t.category))];
    return [{ key: 'all', label: '全部' }, ...keys.map((k) => ({ key: k, label: CATEGORY_MAP[k] || k }))];
  }, [tools]);

  // 过滤
  const filteredTools = useMemo(() => {
    return tools.filter((tool) => {
      const matchSearch =
        !search ||
        tool.title.toLowerCase().includes(search.toLowerCase()) ||
        tool.description.toLowerCase().includes(search.toLowerCase()) ||
        tool.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      const matchCategory = activeCategory === 'all' || tool.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [tools, search, activeCategory]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* 工具栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 py-4">
        {/* 搜索栏 */}
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none">
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工具..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>

        {/* 视图切换 */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex-shrink-0 self-end sm:self-auto">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewMode === 'grid'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            title="网格视图"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewMode === 'list'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            title="列表视图"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="14" height="2" rx="0.5" />
              <rect x="1" y="7" width="14" height="2" rx="0.5" />
              <rect x="1" y="12" width="14" height="2" rx="0.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* 分类 Tab */}
      <div className="flex items-center gap-1 pb-6 overflow-x-auto scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${
              activeCategory === cat.key
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 工具列表 */}
      <ToolGrid tools={filteredTools} viewMode={viewMode} />
    </div>
  );
}
