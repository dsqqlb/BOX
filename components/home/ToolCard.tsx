import Link from 'next/link';
import { Tool } from '@/lib/types';

/**
 * 紧凑型工具卡：图标在左、文字在右，去掉大图标与标签页脚。
 * 工具变多时卡片高度是主要噪声来源，因此这里只保留“图标 + 标题 + 一句描述”。
 */
const ACCENTS: Record<string, { glow: string; icon: string; line: string }> = {
  learning: { glow: 'from-amber-300/15 to-transparent', icon: 'from-amber-200/90 to-orange-400/90', line: 'group-hover:border-amber-200/30' },
  ai: { glow: 'from-rose-300/15 to-transparent', icon: 'from-rose-200/90 to-pink-500/90', line: 'group-hover:border-rose-200/30' },
  game: { glow: 'from-lime-300/15 to-transparent', icon: 'from-lime-200/90 to-green-500/90', line: 'group-hover:border-lime-200/30' },
  utility: { glow: 'from-cyan-300/15 to-transparent', icon: 'from-cyan-200/90 to-sky-500/90', line: 'group-hover:border-cyan-200/30' },
  visualization: { glow: 'from-sky-300/15 to-transparent', icon: 'from-sky-200/90 to-blue-500/90', line: 'group-hover:border-sky-200/30' },
  life: { glow: 'from-emerald-300/15 to-transparent', icon: 'from-emerald-200/90 to-teal-500/90', line: 'group-hover:border-emerald-200/30' },
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
    <article className={`home-tool-card group relative h-full overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a1320]/70 shadow-[0_6px_20px_rgba(0,0,0,.16)] transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#0e1a2a] hover:shadow-[0_14px_30px_rgba(0,0,0,.26)] ${accent.line}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent.glow} opacity-0 transition-opacity duration-200 group-hover:opacity-100`} />
      {onToggleFavorite && <button type="button" onClick={() => onToggleFavorite(tool.slug)} aria-label={isFavorite ? `取消收藏 ${tool.title}` : `收藏 ${tool.title}`} title={isFavorite ? '取消收藏' : '收藏'} className={`absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-lg text-xs transition focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-cyan-300 ${isFavorite ? 'text-amber-200' : 'text-slate-600 opacity-0 hover:text-amber-100 group-hover:opacity-100'}`}>★</button>}
      <Link href={`/tools/${tool.slug}`} onClick={() => onToolOpen?.(tool.slug)} className="relative flex h-full items-start gap-3 p-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${accent.icon} text-lg shadow-[inset_0_1px_rgba(255,255,255,.4)]`}>{tool.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 pr-6">
            <h3 className="truncate text-sm font-semibold tracking-tight text-white transition-colors group-hover:text-cyan-100">{tool.title}</h3>
            {tool.featured && <span title="精选" aria-label="精选" className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/80" />}
          </span>
          {/* 固定两行高度：描述长短不再改变卡片高度，超出部分由 line-clamp 省略。 */}
          <span className="home-tool-desc mt-1 line-clamp-2 block h-10 text-xs leading-5 text-slate-400">{tool.description}</span>
        </span>
      </Link>
    </article>
  );
}
