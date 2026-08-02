# BOX - 我的工具箱

一个展示各种实用工具和学习资源的个人项目平台。

## 🚀 快速开始

### 开发环境

```bash
# 克隆项目
git clone https://github.com/你的用户名/BOX.git
cd BOX

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

访问 http://localhost:3000 查看效果。

### 部署到 Mac mini

```bash
# 在 Mac mini 上执行
cd ~/BOX
chmod +x mac-mini/deploy.sh
./mac-mini/deploy.sh
```

部署脚本会自动：
1. 拉取最新代码
2. 安装依赖
3. 构建静态文件到 `out/` 目录

然后配置 Nginx 或 Caddy 托管 `out/` 目录即可。

## 📁 项目结构

```
BOX/
├── app/                      # Next.js App Router
│   ├── page.tsx              # 首页
│   ├── layout.tsx            # 全局布局
│   └── tools/                # 工具页面
│       └── claude-code-guide/  # Claude Code 学习中心
├── components/               # React 组件
│   └── home/                 # 首页组件
│       ├── Hero.tsx          # Hero 区域
│       ├── ToolCard.tsx      # 工具卡片
│       └── ToolGrid.tsx      # 工具网格
├── data/                     # 数据文件
│   ├── tools.json            # 工具列表
│   └── claude-code-guide.json  # 学习内容
├── lib/                      # 工具函数
│   ├── types.ts              # TypeScript 类型
│   └── tools.ts              # 工具数据操作
├── mac-mini/                 # 部署相关
│   └── deploy.sh             # 一键部署脚本
└── public/                   # 静态资源
```

## 🎨 当前工具

- **📚 Claude Code 学习中心**: 全面的 Claude Code 使用指南，包含指令、技巧和最佳实践

## ✨ 添加新工具

### 1. 创建工具页面

```bash
mkdir -p app/tools/your-tool
```

在 `app/tools/your-tool/page.tsx` 创建页面组件。

### 2. 添加工具元数据

编辑 `data/tools.json`，添加新条目：

```json
{
  "slug": "your-tool",
  "title": "你的工具名称",
  "description": "工具描述",
  "category": "utility",
  "tags": ["tag1", "tag2"],
  "icon": "🔧",
  "featured": false,
  "createdAt": "2026-08-02"
}
```

### 3. 提交代码

```bash
git add .
git commit -m "feat: add your-tool"
git push origin main
```

### 4. 部署

在 Mac mini 上运行 `./mac-mini/deploy.sh` 即可。

## 🔮 未来扩展方向

### 前端增强
- 更多实用工具（JSON 格式化、图片处理、文本工具等）
- 交互式可视化（数据图表、动画演示）
- WebGL/Three.js 实验项目
- 小游戏开发

### 后端集成（按需添加）

当某个工具需要后端功能时，可以选择以下方案：

#### 方案 1：Next.js API Routes（推荐入门）
```typescript
// app/api/your-endpoint/route.ts
export async function POST(req: Request) {
  // 处理逻辑
  return Response.json({ result: "..." });
}
```

适合场景：
- 调用第三方 API（Claude API、OpenAI 等）
- 简单的数据处理
- 轻量级后端需求

#### 方案 2：PocketBase（推荐中等复杂度）
- 单文件数据库 + REST API
- 自带管理后台
- 适合需要数据持久化的场景

#### 方案 3：PostgreSQL + Prisma（推荐复杂应用）
- 传统关系型数据库
- 类型安全的 ORM
- 适合数据结构复杂、需要高级查询的场景

#### 方案 4：Serverless（推荐全球部署）
- Cloudflare Workers + D1
- Vercel Functions
- 适合需要全球低延迟的场景

### 技术栈演进路径

```
当前状态：纯静态站点
    ↓
阶段 1：单个工具需要 API
    → 添加 Next.js API Routes
    ↓
阶段 2：多个工具需要数据持久化
    → 接入 PocketBase 或 PostgreSQL
    ↓
阶段 3：需要用户系统
    → 添加 NextAuth.js 认证
    ↓
阶段 4：需要全球访问
    → 迁移到 Cloudflare Workers + D1
```

### 部署架构演进

**当前（纯静态）**
```
Mac mini:
└── Nginx/Caddy → out/ 静态文件
```

**加入 API 后**
```
Mac mini:
├── Nginx/Caddy（反向代理）
│   ├── / → Next.js (端口 3000)
│   └── /api/* → Next.js API Routes
└── Cloudflare Tunnel（内网穿透）
```

**加入数据库后**
```
Mac mini:
├── Nginx/Caddy
├── Next.js (Node 服务)
├── PocketBase/PostgreSQL（数据库）
└── Cloudflare Tunnel
```

## 🛠️ 技术栈

- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **部署**: 静态导出 (`output: 'export'`)
- **包管理**: pnpm

## 📝 开发规范

- 使用 TypeScript 严格模式
- 组件使用函数式写法
- 样式使用 Tailwind CSS
- 代码提交遵循 Conventional Commits

## 🌐 内网穿透（可选）

如果需要从外网访问 Mac mini 上的站点，推荐使用 Cloudflare Tunnel：

```bash
# 安装
brew install cloudflared

# 登录
cloudflared tunnel login

# 创建隧道
cloudflared tunnel create box

# 配置路由
cloudflared tunnel route dns box box.yourdomain.com

# 运行
cloudflared tunnel run box
```

配置文件示例 `~/.cloudflared/config.yml`:
```yaml
tunnel: <tunnel-id>
credentials-file: /Users/xxx/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: box.yourdomain.com
    service: http://localhost:80
  - service: http_status:404
```

## 📄 License

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
