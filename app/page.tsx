import Hero from '@/components/home/Hero';
import ToolGrid from '@/components/home/ToolGrid';
import { getAllTools } from '@/lib/tools';

export default function Home() {
  const tools = getAllTools();

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900">
      <Hero />
      <ToolGrid tools={tools} />

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-16 sm:mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            BOX - 我的工具箱 © 2026
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
            持续更新中...
          </p>
        </div>
      </footer>
    </main>
  );
}
