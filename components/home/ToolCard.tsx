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

export default function ToolCard({ tool }: { tool: Tool }) {
  const accent = ACCENTS[tool.category] || ACCENTS.utility;

  return (
    <Link href={`/tools/${tool.slug}`} className="group relative block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#080a18]">
      <article className={`relative h-full overflow-hidden rounded-2xl border border-white/[0.09] bg-[#101326]/75 p-5 shadow-[0_10px_35px_rgba(0,0,0,.13)] transition duration-300 ease-out hover:-translate-y-1 hover:bg-[#151a32] hover:shadow-[0_22px_45px_rgba(0,0,0,.28)] ${accent.line}`}>
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br ${accent.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${accent.icon} text-2xl shadow-[inset_0_1px_rgba(255,255,255,.45),0_8px_20px_rgba(0,0,0,.2)]`}>{tool.icon}</span>
            {tool.featured && <span className="rounded-full border border-cyan-200/15 bg-cyan-300/[0.09] px-2.5 py-1 text-[10px] font-semibold tracking-[0.1em] text-cyan-100">精选</span>}
          </div>
          <div className="mt-6 flex-1">
            <h3 className="text-base font-semibold tracking-tight text-white transition-colors group-hover:text-cyan-100">{tool.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{tool.description}</p>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
            <div className="flex min-w-0 gap-1.5 overflow-hidden">
              {tool.tags.slice(0, 2).map((tag) => <span key={tag} className="truncate rounded-md bg-white/[0.055] px-2 py-1 text-[11px] text-slate-500">{tag}</span>)}
            </div>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.09] text-sm text-slate-500 transition group-hover:border-cyan-200/30 group-hover:bg-cyan-200/10 group-hover:text-cyan-100">→</span>
          </div>
        </div>
      </article>
    </Link>
  );
}
