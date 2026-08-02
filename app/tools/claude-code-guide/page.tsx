import Link from 'next/link';
import guideData from '@/data/claude-code-guide.json';
import CopyButton from '@/components/CopyButton';

export default function ClaudeCodeGuidePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            href="/"
            className="inline-flex items-center text-sm sm:text-base text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            返回首页
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/3 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
          <div className="absolute top-20 right-1/3 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20 text-center">
          <div className="text-6xl sm:text-7xl mb-4 sm:mb-6 animate-bounce">📚</div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Claude Code 学习中心
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-zinc-600 dark:text-zinc-400">
            你的 AI 编程助手完全指南
          </p>
          <div className="mt-6 sm:mt-8 flex justify-center">
            <div className="w-20 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20 lg:pb-24">
        {guideData.sections.map((section) => (
          <section key={section.id} id={section.id} className="mb-12 sm:mb-16 lg:mb-20">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-6 sm:mb-8 text-zinc-900 dark:text-zinc-100">
              {section.title}
            </h2>

            {/* Quick Start Content */}
            {section.content && (
              <div className="prose prose-zinc dark:prose-invert max-w-none">
                <p className="text-base sm:text-lg text-zinc-700 dark:text-zinc-300 leading-relaxed bg-zinc-50 dark:bg-zinc-900/50 p-4 sm:p-6 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  {section.content}
                </p>
              </div>
            )}

            {/* Commands Section */}
            {section.id === 'commands' && section.items && (
              <div className="space-y-4 sm:space-y-6">
                {section.items.map((item: any) => (
                  <div
                    key={item.command}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6 bg-white dark:bg-zinc-900 hover:shadow-lg transition-shadow"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                      <code className="text-base sm:text-lg font-mono font-semibold text-blue-600 dark:text-blue-400 break-all">
                        {item.command}
                      </code>
                      <div className="flex-shrink-0">
                        <CopyButton text={item.command} />
                      </div>
                    </div>
                    <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 mb-2">{item.description}</p>
                    <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mb-1">
                      <span className="font-medium">用法：</span> {item.usage}
                    </p>
                    <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-500">
                      <span className="font-medium">示例：</span> {item.example}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Tips Section */}
            {section.id === 'tips' && section.items && (
              <div className="space-y-4">
                {section.items.map((item: any, index: number) => (
                  <div
                    key={index}
                    className="border-l-4 border-blue-500 pl-4 sm:pl-6 py-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-r-lg"
                  >
                    <h3 className="font-semibold text-base sm:text-lg text-zinc-900 dark:text-zinc-100 mb-2">
                      {item.title}
                    </h3>
                    <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {item.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Advanced Section */}
            {section.id === 'advanced' && section.items && (
              <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
                {section.items.map((item: any, index: number) => (
                  <div
                    key={index}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6 bg-gradient-to-br from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-900/50 hover:shadow-lg transition-all hover:-translate-y-1"
                  >
                    <h3 className="font-semibold text-base sm:text-lg text-zinc-900 dark:text-zinc-100 mb-2 sm:mb-3">
                      {item.title}
                    </h3>
                    <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {item.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* FAQ Section */}
            {section.id === 'faq' && section.items && (
              <div className="space-y-6">
                {section.items.map((item: any, index: number) => (
                  <div key={index} className="border-b border-zinc-200 dark:border-zinc-800 pb-6 last:border-0">
                    <h3 className="font-semibold text-base sm:text-lg text-zinc-900 dark:text-zinc-100 mb-3 flex items-start">
                      <span className="text-blue-600 dark:text-blue-400 mr-2 flex-shrink-0">Q:</span>
                      <span>{item.question}</span>
                    </h3>
                    <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 pl-6 sm:pl-8 leading-relaxed">
                      <span className="text-green-600 dark:text-green-400 mr-2">A:</span>
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-16 sm:mt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 text-center">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            返回首页
          </Link>
        </div>
      </footer>
    </div>
  );
}
