# BOX - 工具箱 🧰

一个基于 Next.js 15 构建的个人工具集合平台，用于展示和分享各种实用工具。

[![Next.js](https://img.shields.io/badge/Next.js-15.1.7-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## 🎯 项目特色

- 🚀 **现代化技术栈** - Next.js 15 + TypeScript + Tailwind CSS
- 🎨 **精美设计** - 每个工具都有独特的视觉风格
- 📱 **响应式布局** - 完美适配桌面、平板、手机
- 🌙 **暗黑模式** - 自动适配系统主题
- ⚡ **静态导出** - 可部署到任何静态托管平台
- 💾 **数据持久化** - localStorage 自动保存用户配置

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:9999](http://localhost:9999)

### 生产构建

```bash
npm run build
```

静态文件将输出到 `out/` 目录。

## 🛠️ 现有工具

### 📚 Claude Code 学习中心
Claude Code 使用指南、指令说明、技巧分享和最佳实践。

**路径**: `/tools/claude-code-guide`  
**特性**: 
- 完整的使用指南
- 常用指令速查
- 技巧和最佳实践
- FAQ 常见问题

### 🏰 DND 语言翻译器
龙与地下城多语言翻译器，支持中英文互译并显示奇幻世界符文。

**路径**: `/tools/dnd-translator`  
**特性**:
- 中英文双向翻译（MyMemory API）
- 多种 DND 奇幻语言符文显示
  - Davek（矮人语）
  - Magi（卷轴语）
  - Elvish（精灵语）
- 自定义符文导出（颜色、字号、背景、边距）
- localStorage 持久化配置

### 🌌 JSON 星系
将 JSON 数据可视化为华丽的 3D 星系，支持格式化、压缩和交互式探索。

**路径**: `/tools/json-visualizer`  
**特性**:
- JSON 格式化和验证
- 3D 可视化渲染（Three.js）
- 交互式节点探索
- 数据压缩和美化
- 支持大型 JSON 文件

## 📁 项目结构

```
BOX/
├── app/                      # Next.js App Router
│   ├── page.tsx              # 首页
│   ├── layout.tsx            # 全局布局
│   ├── globals.css           # 全局样式（含自定义字体）
│   └── tools/                # 工具页面
│       ├── claude-code-guide/
│       ├── dnd-translator/
│       └── json-visualizer/
├── components/               # React 组件
│   ├── common/               # 通用组件
│   ├── home/                 # 首页组件
│   └── dnd/                  # DND 翻译器组件
├── data/                     # 数据配置
│   └── tools.json            # 工具元数据
├── lib/                      # 工具函数
│   ├── types.ts              # TypeScript 类型
│   ├── tools.ts              # 工具数据操作
│   └── translate.ts          # 翻译 API
├── public/                   # 静态资源
│   └── fonts/                # 字体文件（DND 语言字体）
├── docs/                     # 项目文档
│   ├── README.md             # 项目总览
│   ├── claude-code-guide.md
│   ├── dnd-translator.md
│   └── json-visualizer.md
├── mac-mini/                 # 部署脚本
│   └── deploy.sh
├── .env.example              # 环境变量模板
├── next.config.ts            # Next.js 配置
├── tailwind.config.ts        # Tailwind CSS 配置
└── tsconfig.json             # TypeScript 配置
```

## ✨ 添加新工具

### 1. 创建工具页面

```bash
mkdir -p app/tools/your-tool
```

创建 `app/tools/your-tool/page.tsx`：

```tsx
export default function YourToolPage() {
  return (
    <div>
      <h1>你的工具</h1>
    </div>
  );
}
```

### 2. 添加工具元数据

编辑 `data/tools.json`：

```json
{
  "slug": "your-tool",
  "title": "你的工具",
  "description": "工具描述",
  "category": "utility",
  "tags": ["tag1", "tag2"],
  "icon": "🔧",
  "featured": false,
  "createdAt": "2026-08-04"
}
```

### 3. 创建工具文档（可选）

在 `docs/` 目录下创建 `your-tool.md`。

详细步骤请查看 [`docs/README.md`](./docs/README.md)。

## 🧰 技术栈

- **框架**: [Next.js 15.1.7](https://nextjs.org/) (App Router)
- **语言**: [TypeScript 5](https://www.typescriptlang.org/)
- **样式**: [Tailwind CSS 3.4](https://tailwindcss.com/)
- **3D 渲染**: [Three.js](https://threejs.org/)
  - [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber)
  - [@react-three/drei](https://github.com/pmndrs/drei)
  - [@react-three/cannon](https://github.com/pmndrs/use-cannon) (物理引擎)
- **工具库**: 
  - [html2canvas](https://html2canvas.hertzen.com/) (截图导出)
- **翻译 API**: [MyMemory](https://mymemory.translated.net/) (免费 500 次/日)
- **部署**: 静态导出 (`output: 'export'`)

## 🎨 设计风格

- **首页**: 简洁现代，黑白灰主色调，支持暗黑模式
- **DND 翻译器**: 浓郁奇幻风，渐变背景 + 复古边框 + 自定义字体
- **JSON 星系**: 科技感宇宙风，深色星空 + 3D 节点 + 粒子效果

## 📝 开发规范

- TypeScript 严格模式
- 组件使用函数式写法
- 样式优先使用 Tailwind CSS
- 提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)

## 🔧 常用命令

```bash
npm run dev          # 启动开发服务器（端口 9999）
npm run build        # 构建生产版本
npm run start        # 启动生产服务器（端口 9999）
npm run lint         # 代码检查
```

## 🌐 部署

项目配置为静态导出，可部署到：

- **Vercel**: 一键部署（推荐）
- **Netlify**: 拖拽 `out/` 目录
- **GitHub Pages**: 上传 `out/` 到 gh-pages 分支
- **自托管**: 任何静态文件服务器（Nginx、Apache 等）

### Vercel 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel
```

### 手动部署

```bash
# 构建
npm run build

# out/ 目录即为静态文件
# 上传到你的服务器或静态托管平台
```

## 📚 文档

详细文档请查看 [`docs/`](./docs/) 目录：

- [项目总览](./docs/README.md)
- [Claude Code 学习中心](./docs/claude-code-guide.md)
- [DND 语言翻译器](./docs/dnd-translator.md)
- [JSON 星系可视化](./docs/json-visualizer.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

[MIT](./LICENSE)

---

**Made with ❤️ using Next.js**
