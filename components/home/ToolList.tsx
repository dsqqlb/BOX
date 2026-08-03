import Link from 'next/link';
import { Tool } from '@/lib/types';

export default function ToolList({ tools }: { tools: Tool[] }) {
  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-t border-b border-zinc-200 dark:border-zinc-800">
      {tools.map((tool) => (
        <Link key={tool.slug} href={`/tools/${tool.slug}`}>
          <div className="flex items-center gap-4 px-4 sm:px-6 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
            {/* Icon */}
            <div className="text-2xl sm:text-3xl flex-shrink-0">
              {tool.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {tool.title}
                </h3>
                {tool.featured && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    精选
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 truncate">
                {tool.description}
              </p>
            </div>

            {/* Tags */}
            <div className="hidden sm:flex flex-wrap gap-1.5 flex-shrink-0">
              {tool.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Arrow */}
            <span className="text-zinc-300 dark:text-zinc-600 flex-shrink-0">→</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
