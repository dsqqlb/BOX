import ToolCard from './ToolCard';
import { Tool } from '@/lib/types';

export default function ToolGrid({ tools }: { tools: Tool[] }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {tools.map((tool) => (
          <ToolCard key={tool.slug} tool={tool} />
        ))}
      </div>

      {tools.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📦</div>
          <p className="text-zinc-500 dark:text-zinc-400 text-lg">暂无工具</p>
          <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-2">敬请期待更多精彩内容</p>
        </div>
      )}
    </div>
  );
}
