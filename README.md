# BOX

BOX 是一个带账户登录和按工具授权的私人工具箱。它使用 Next.js 构建界面，并由 `server/index.js` 统一提供页面、认证、API 和先攻追踪器的 WebSocket 服务。

> `next.config.ts` 虽然会生成 `out/` 静态产物，但完整功能**不能**只部署到静态托管：登录、权限控制、WebSocket 房间和省钱记录 API 都需要运行 `server/index.js`。

## 本地启动

### 1. 安装依赖

```powershell
npm install
```

### 2. 配置认证

在 PowerShell 中执行：

```powershell
Copy-Item .env.example .env.local
Copy-Item data/auth-users.example.json data/auth-users.json
node server/create-password-hash.js
```

将命令输出的密码哈希填入 `data/auth-users.json` 对应账户的 `passwordHash`，并在 `.env.local` 中设置至少 32 字节的随机 `BOX_SESSION_SECRET`。本地 HTTP 开发请设置 `BOX_COOKIE_SECURE=false`。

如果使用的是 `cmd.exe`，前两条复制命令改为：

```bat
copy .env.example .env.local
copy data\auth-users.example.json data\auth-users.json
```

`data/auth-users.json` 含真实账户配置，已被 Git 忽略，不能提交。完整账户、权限和会话说明见[认证与授权](./docs/authentication.md)。

### 3. 启动

```powershell
npm run dev
```

打开 <http://localhost:9999>，使用已配置的账户登录。

### 生产运行

```powershell
npm run build
npm start
```

默认端口为 `9999`；可通过 `PORT` 环境变量修改。生产部署须保留可写的 `data/` 目录，以保存省钱记录，并安全保存 `.env.local` 与 `data/auth-users.json`。

## 工具

所有工具均须先登录；账户还必须具备相应权限。

| 工具 | 路径 | 说明 | 文档 |
| --- | --- | --- | --- |
| Claude Code 学习中心 | `/tools/claude-code-guide` | JSON 驱动的指令、技巧和常见问题参考 | [查看](./docs/claude-code-guide.md) |
| DND 语言翻译器 | `/tools/dnd-translator` | 中英文翻译、奇幻字体展示与符文图片导出 | [查看](./docs/dnd-translator.md) |
| DND 先攻追踪器（遥控器） | `/tools/initiative-tracker` | 管理角色、回合、状态与骰子 | [查看](./docs/initiative-tracker-room.md) |
| DND 先攻追踪器（主屏） | `/tools/initiative-tracker/display` | 创建/接管房间并在大屏展示战斗 | [查看](./docs/initiative-tracker-room.md) |
| JSON 星系 | `/tools/json-visualizer` | JSON 校验、格式化、压缩与 3D 浏览 | [查看](./docs/json-visualizer.md) |
| 塔罗牌占卜 | `/tools/tarot-reading` | 78 张牌与多种牌阵的互动抽牌 | [查看](./docs/tarot-reading.md) |
| 省钱网页 | `/tools/savings-tracker` | 按账户隔离的省钱记录和统计 | [查看](./docs/savings-tracker.md) |
| CSS 层叠解释器 | `/tools/css-cascade` | 解析并可视化 CSS 规则、特异性与上下文 | [查看](./docs/css-cascade.md) |

## 常用命令

```powershell
npm run dev      # 开发服务，含 Next.js 热更新
npm run build    # 生成 out/ 生产产物
npm start        # 启动生产服务
npm run lint     # 运行项目的 lint 脚本
```

## 项目结构

```text
app/                    Next.js 页面与工具路由
components/             可复用界面组件
data/                   工具数据与本地持久化数据
docs/                   项目、认证和每个工具的说明
lib/                    客户端工具逻辑与 WebSocket 工具
public/                 字体与图片等静态资源
server/                 自定义服务、认证、API 与 WebSocket
```

## 文档

文档索引和维护约定位于 [docs/README.md](./docs/README.md)。新增工具时，请同时更新 `data/tools.json`、服务端权限白名单（如需要）和对应的 `docs/<tool>.md`。
