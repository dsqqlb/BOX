import ToolCard from './ToolCard';
import ToolList from './ToolList';
import { Tool } from '@/lib/types';

interface ToolGridProps {
  tools: Tool[];
  viewMode: 'grid' | 'list';
}

export default function ToolGrid({ tools, viewMode }: ToolGridProps) {
  if (tools.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📦</div>
        <p className="text-zinc-500 dark:text-zinc-400 text-base">没有找到匹配的工具</p>
        <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-1">试试调整搜索词或切换分类</p>
      </div>
    );
  }

  if (viewMode === 'list') {
    return <ToolList tools={tools} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
      {tools.map((tool) => (
        <ToolCard key={tool.slug} tool={tool} />
      ))}
    </div>
  );
}
