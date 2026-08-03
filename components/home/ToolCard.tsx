import Link from 'next/link';
import { Tool } from '@/lib/types';

export default function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link href={`/tools/${tool.slug}`}>
      <div className="group relative overflow-hidden rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 sm:p-6 transition-all duration-200 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700">
        {/* Icon */}
        <div className="text-4xl sm:text-5xl mb-3 sm:mb-4">
          {tool.icon}
        </div>

        {/* Content */}
        <h3 className="text-base sm:text-lg font-semibold mb-1.5 text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {tool.title}
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 line-clamp-2 leading-relaxed">
          {tool.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {tool.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Featured Badge */}
        {tool.featured && (
          <div className="absolute top-3 right-3">
            <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
              精选
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
