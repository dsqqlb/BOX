export default function Hero() {
  return (
    <div className="relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
        <div className="absolute top-20 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="text-center py-16 sm:py-20 lg:py-24 px-4">
        {/* 主标题 */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-4 sm:mb-6 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent animate-gradient">
          BOX
        </h1>

        {/* 副标题 */}
        <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl text-zinc-700 dark:text-zinc-300 mb-3 sm:mb-4 font-medium">
          我的工具箱
        </p>

        {/* 描述 */}
        <p className="text-sm sm:text-base md:text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          收集各种实用工具、学习资源和创意项目
        </p>

        {/* 装饰性分隔线 */}
        <div className="mt-8 sm:mt-12 flex justify-center">
          <div className="w-20 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
        </div>
      </div>
    </div>
  );
}
