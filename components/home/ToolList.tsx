import Link from 'next/link';
import { Tool } from '@/lib/types';

interface ToolListProps {
  tools: Tool[];
  favorites?: Set<string>;
  onToggleFavorite?: (slug: string) => void;
  onToolOpen?: (slug: string) => void;
}

export default function ToolList({ tools, favorites = new Set(), onToggleFavorite, onToolOpen }: ToolListProps) {
  return <div className="home-tool-list overflow-hidden rounded-2xl border border-white/[0.09] bg-[#101326]/60">{tools.map((tool, index) => <article key={tool.slug} className={`group relative flex items-center gap-4 px-4 py-4 transition hover:bg-white/[0.045] sm:px-5 ${index > 0 ? 'border-t border-white/[0.07]' : ''}`}>
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.055] text-2xl">{tool.icon}</span><Link href={`/tools/${tool.slug}`} onClick={() => onToolOpen?.(tool.slug)} className="min-w-0 flex-1 focus:outline-none"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold text-white group-hover:text-cyan-100 sm:text-base">{tool.title}</h3>{tool.featured && <span className="hidden rounded-full bg-cyan-300/[0.1] px-2 py-0.5 text-[10px] font-medium text-cyan-100 sm:inline">精选</span>}</div><p className="mt-1 truncate text-xs text-slate-500 sm:text-sm">{tool.description}</p></Link>
    <div className="hidden shrink-0 gap-1.5 md:flex">{tool.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-md bg-white/[0.055] px-2 py-1 text-[11px] text-slate-500">{tag}</span>)}</div>{onToggleFavorite && <button type="button" onClick={() => onToggleFavorite(tool.slug)} aria-label={favorites.has(tool.slug) ? `取消收藏 ${tool.title}` : `收藏 ${tool.title}`} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-sm transition ${favorites.has(tool.slug) ? 'border-amber-200/35 bg-amber-300/15 text-amber-100' : 'border-white/[0.09] text-slate-600 hover:text-amber-100'}`}>★</button>}<Link href={`/tools/${tool.slug}`} onClick={() => onToolOpen?.(tool.slug)} aria-label={`打开 ${tool.title}`} className="text-lg text-slate-600 transition hover:translate-x-0.5 hover:text-cyan-100">→</Link>
  </article>)}</div>;
}
