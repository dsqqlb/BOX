import ToolCard from './ToolCard';
import ToolList from './ToolList';
import { Tool } from '@/lib/types';

interface ToolGridProps {
  tools: Tool[];
  viewMode: 'grid' | 'list';
  favorites?: Set<string>;
  onToggleFavorite?: (slug: string) => void;
  onToolOpen?: (slug: string) => void;
  emptyMessage?: string;
}

export default function ToolGrid({ tools, viewMode, favorites, onToggleFavorite, onToolOpen, emptyMessage = '没有找到匹配的工具' }: ToolGridProps) {
  if (tools.length === 0) return <div className="rounded-2xl border border-dashed border-white/[0.15] bg-white/[0.025] py-12 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-xl">⌕</div><p className="mt-4 text-base font-medium text-white">{emptyMessage}</p><p className="mt-1.5 text-sm text-slate-500">试试调整搜索词，或展开其他工具分类。</p></div>;
  if (viewMode === 'list') return <ToolList tools={tools} favorites={favorites} onToggleFavorite={onToggleFavorite} onToolOpen={onToolOpen} />;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{tools.map((tool) => <ToolCard key={tool.slug} tool={tool} isFavorite={favorites?.has(tool.slug)} onToggleFavorite={onToggleFavorite} onToolOpen={onToolOpen} />)}</div>;
}
