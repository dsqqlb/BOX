import Hero from '@/components/home/Hero';
import ToolShell from '@/components/home/ToolShell';

export default function Home() {
  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <Hero />
      <ToolShell />

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-12 sm:mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            BOX - 我的工具箱 © 2026
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5">
            持续更新中...
          </p>
        </div>
      </footer>
    </main>
  );
}
