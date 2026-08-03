# BOX - 项目文档

## 📦 项目概述

BOX 是一个基于 Next.js 15 构建的工具集合平台，用于展示和分享各种实用工具。

## 🚀 快速开始

### 开发环境

```bash
# 克隆项目
git clone <repo-url>
cd BOX

# 安装依赖
npm install

# 启动开发服务器（端口 9999）
npm run dev
```

访问 http://localhost:9999

### 生产构建

```bash
npm run build
```

静态文件输出到 `out/` 目录。

## 📁 项目结构

```
BOX/
├── app/                      # Next.js App Router
│   ├── page.tsx              # 首页
│   ├── layout.tsx            # 全局布局
│   ├── globals.css           # 全局样式（含字体声明）
│   └── tools/                # 工具页面
│       ├── claude-code-guide/  # Claude Code 学习中心
│       ├── dice-roller/        # CSS 骰子模拟器
│       └── dnd-translator/     # DND 语言翻译器
├── components/               # React 组件
│   └── home/                 # 首页组件
├── data/                     # 数据配置
│   └── tools.json            # 工具元数据
├── lib/                      # 工具函数
│   ├── types.ts              # TypeScript 类型
│   ├── tools.ts              # 工具数据操作
│   └── translate.ts          # MyMemory 翻译 API
├── public/                   # 静态资源
│   └── fonts/                # 字体文件（DND 语言字体）
└── docs/                     # 项目文档
    ├── README.md             # 项目总览（本文件）
    ├── claude-code-guide.md  # Claude Code 学习中心文档
    ├── dice-roller.md        # 骰子模拟器文档
    └── dnd-translator.md     # DND 翻译器文档
```

## 🛠️ 现有工具

### 1. Claude Code 学习中心
- 路径：`/tools/claude-code-guide`
- 功能：Claude Code 使用指南、指令说明、技巧分享
- 文档：[claude-code-guide.md](./claude-code-guide.md)

### 2. CSS 骰子模拟器
- 路径：`/tools/dice-roller`
- 功能：D4/D6/D8/D10/D12/D20/D100 骰子模拟
- 技术：纯 CSS clip-path 实现，无 3D 库
- 文档：[dice-roller.md](./dice-roller.md)

### 3. DND 语言翻译器
- 路径：`/tools/dnd-translator`
- 功能：中英文互译 + DND 语言符文显示
- 支持：多语言同时显示（矮人语、卷轴·Magi 等）
- 文档：[dnd-translator.md](./dnd-translator.md)

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
  "createdAt": "2026-08-03"
}
```

### 3. 创建工具文档（可选）

在 `docs/` 目录下创建 `your-tool.md`，记录工具的配置、使用方法等。

### 4. 提交代码

```bash
git add .
git commit -m "feat: 新增 your-tool 工具"
git push
```

## 🧰 技术栈

- **框架**: Next.js 15.1.7 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **翻译 API**: MyMemory (免费 500 次/日)
- **部署**: 静态导出 (`output: 'export'`)
- **包管理**: npm

## 📝 开发规范

- TypeScript 严格模式
- 组件使用函数式写法
- 样式优先使用 Tailwind CSS
- 提交遵循 Conventional Commits

## 🔧 常用命令

```bash
npm run dev          # 启动开发服务器（端口 9999）
npm run build        # 构建生产版本
npm run start        # 启动生产服务器
```

## 📄 License

MIT
