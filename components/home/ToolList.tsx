import Link from 'next/link';
import { Tool } from '@/lib/types';

export default function ToolList({ tools }: { tools: Tool[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#101326]/60">
      {tools.map((tool, index) => (
        <Link key={tool.slug} href={`/tools/${tool.slug}`} className="group block focus:outline-none focus-visible:bg-white/[0.08]">
          <article className={`flex items-center gap-4 px-4 py-4 transition hover:bg-white/[0.045] sm:px-5 ${index > 0 ? 'border-t border-white/[0.07]' : ''}`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.055] text-2xl">{tool.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-white group-hover:text-cyan-100 sm:text-base">{tool.title}</h3>
                {tool.featured && <span className="hidden rounded-full bg-cyan-300/[0.1] px-2 py-0.5 text-[10px] font-medium text-cyan-100 sm:inline">精选</span>}
              </div>
              <p className="mt-1 truncate text-xs text-slate-500 sm:text-sm">{tool.description}</p>
            </div>
            <div className="hidden shrink-0 gap-1.5 md:flex">
              {tool.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-md bg-white/[0.055] px-2 py-1 text-[11px] text-slate-500">{tag}</span>)}
            </div>
            <span className="text-lg text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-100">→</span>
          </article>
        </Link>
      ))}
    </div>
  );
}
