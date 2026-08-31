import Link from 'next/link';
import { Tool } from '@/lib/types';

const ACCENTS: Record<string, { glow: string; icon: string; line: string }> = {
  learning: { glow: 'from-amber-300/20 via-orange-400/5 to-transparent', icon: 'from-amber-200/90 to-orange-400/90', line: 'group-hover:border-amber-200/30' },
  ai: { glow: 'from-fuchsia-300/20 via-violet-400/5 to-transparent', icon: 'from-fuchsia-200/90 to-violet-400/90', line: 'group-hover:border-fuchsia-200/30' },
  game: { glow: 'from-violet-300/20 via-indigo-400/5 to-transparent', icon: 'from-violet-200/90 to-indigo-400/90', line: 'group-hover:border-violet-200/30' },
  utility: { glow: 'from-cyan-300/20 via-sky-400/5 to-transparent', icon: 'from-cyan-200/90 to-sky-400/90', line: 'group-hover:border-cyan-200/30' },
  visualization: { glow: 'from-sky-300/20 via-blue-400/5 to-transparent', icon: 'from-sky-200/90 to-blue-400/90', line: 'group-hover:border-sky-200/30' },
  life: { glow: 'from-emerald-300/20 via-teal-400/5 to-transparent', icon: 'from-emerald-200/90 to-teal-400/90', line: 'group-hover:border-emerald-200/30' },
};

interface ToolCardProps {
  tool: Tool;
  isFavorite?: boolean;
  onToggleFavorite?: (slug: string) => void;
  onToolOpen?: (slug: string) => void;
}

export default function ToolCard({ tool, isFavorite = false, onToggleFavorite, onToolOpen }: ToolCardProps) {
  const accent = ACCENTS[tool.category] || ACCENTS.utility;
  return (
    <article className={`home-tool-card group relative h-full overflow-hidden rounded-2xl border border-white/[0.09] bg-[#101326]/75 shadow-[0_10px_35px_rgba(0,0,0,.13)] transition duration-300 ease-out hover:-translate-y-1 hover:bg-[#151a32] hover:shadow-[0_22px_45px_rgba(0,0,0,.28)] ${accent.line}`}>
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br ${accent.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
      {onToggleFavorite && <button type="button" onClick={() => onToggleFavorite(tool.slug)} aria-label={isFavorite ? `取消收藏 ${tool.title}` : `收藏 ${tool.title}`} title={isFavorite ? '取消收藏' : '收藏'} className={`absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-xl border text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${isFavorite ? 'border-amber-200/35 bg-amber-300/15 text-amber-100' : 'border-white/[0.09] bg-slate-950/30 text-slate-500 hover:border-amber-200/30 hover:text-amber-100'}`}>★</button>}
      <Link href={`/tools/${tool.slug}`} onClick={() => onToolOpen?.(tool.slug)} className="relative block h-full p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${accent.icon} text-2xl shadow-[inset_0_1px_rgba(255,255,255,.45),0_8px_20px_rgba(0,0,0,.2)]`}>{tool.icon}</span>
            {tool.featured && <span className="mr-8 rounded-full border border-cyan-200/15 bg-cyan-300/[0.09] px-2.5 py-1 text-[10px] font-semibold tracking-[0.1em] text-cyan-100">精选</span>}
          </div>
          <div className="mt-6 flex-1"><h3 className="text-base font-semibold tracking-tight text-white transition-colors group-hover:text-cyan-100">{tool.title}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{tool.description}</p></div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4"><div className="flex min-w-0 gap-1.5 overflow-hidden">{tool.tags.slice(0, 2).map((tag) => <span key={tag} className="truncate rounded-md bg-white/[0.055] px-2 py-1 text-[11px] text-slate-500">{tag}</span>)}</div><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.09] text-sm text-slate-500 transition group-hover:border-cyan-200/30 group-hover:bg-cyan-200/10 group-hover:text-cyan-100">→</span></div>
        </div>
      </Link>
    </article>
  );
}
