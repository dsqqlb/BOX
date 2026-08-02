import Link from 'next/link';
import { Tool } from '@/lib/types';

export default function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link href={`/tools/${tool.slug}`}>
      <div className="group relative overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 hover:border-blue-500/50 dark:hover:border-blue-400/50">
        {/* 背景渐变效果 */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

        {/* 内容容器 */}
        <div className="relative z-10">
          {/* Icon */}
          <div className="text-5xl sm:text-6xl mb-4 sm:mb-6 transform group-hover:scale-110 transition-transform duration-300">
            {tool.icon}
          </div>

          {/* Content */}
          <h3 className="text-xl sm:text-2xl font-bold mb-2 sm:mb-3 text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {tool.title}
          </h3>
          <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mb-4 sm:mb-6 line-clamp-2 leading-relaxed">
            {tool.description}
          </p>

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {tool.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 text-xs sm:text-sm rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Featured Badge */}
        {tool.featured && (
          <div className="absolute top-4 right-4 z-20">
            <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg">
              精选
            </span>
          </div>
        )}

        {/* 右下角装饰 */}
        <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
      </div>
    </Link>
  );
}
