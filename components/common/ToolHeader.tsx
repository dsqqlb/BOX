import Link from 'next/link';

interface ToolHeaderProps {
  showBackButton?: boolean;
  className?: string;
  textClassName?: string;
}

export default function ToolHeader({
  showBackButton = true,
  className = '',
  textClassName = 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
}: ToolHeaderProps) {
  return (
    <header className={`sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        {showBackButton && (
          <Link
            href="/"
            className={`inline-flex items-center text-sm font-medium transition-colors group ${textClassName}`}
          >
            <span className="mr-1.5 group-hover:-translate-x-1 transition-transform">←</span>
            返回首页
          </Link>
        )}
      </div>
    </header>
  );
}
