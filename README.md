# BOX

BOX 是一个带账户登录和按工具授权的私人工具箱。它使用 Next.js 构建界面，并由 `code/server/index.js` 统一提供页面、认证、API 和先攻追踪器的 WebSocket 服务。

> `next.config.ts` 虽然会生成 `code/out/` 静态产物，但完整功能**不能**只部署到静态托管：登录、权限控制、WebSocket 房间和省钱记录 API 都需要运行 `code/server/index.js`。

> 想要一份覆盖 Linux / Windows / macOS、从克隆到常驻运行（含反向代理、备份与故障排查）的完整分步指南，请看 **[部署指南](./docs/deployment.md)**。下面是精简版的新机器配置流程。

## 新机器部署与首次认证配置

以下步骤适用于将项目复制、克隆或部署到一台**没有现有私密配置**的新机器。`resources/.env.local` 和 `resources/data/auth-users.json` 不应从 Git 获取；必须在目标机器上重新创建。请在项目根目录执行。

### 1. 获取项目并安装依赖

安装受支持的 Node.js 与 npm 后，克隆或复制项目文件，在**项目根目录**执行：

```powershell
npm run install:code
```

依赖只装在 `code/`（代码类目录）里，根目录的 `package.json` 只负责把命令转发过去。

### 2. 从模板创建私密运行文件

PowerShell：

```powershell
New-Item -ItemType Directory -Force resources\data | Out-Null
Copy-Item resources\.env.example resources\.env.local
Copy-Item resources\content\auth-users.example.json resources\data\auth-users.json
```

macOS / Linux shell：

```bash
mkdir -p resources/data
cp resources/.env.example resources/.env.local
cp resources/content/auth-users.example.json resources/data/auth-users.json
```

若目标机器上已经有正在使用的 `resources/.env.local` 或 `resources/data/auth-users.json`，不要执行覆盖复制；先备份并在原文件上增量修改。两份模板文件可以提交，两个实际文件包含密钥或账户哈希，均不得提交到 Git 或发送给他人。

### 3. 配置 `resources/.env.local`

使用编辑器打开新建的 `resources/.env.local`。先在任意终端生成一个新的会话密钥：

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

将输出完整复制到 `BOX_SESSION_SECRET`。不要复用旧环境的密钥，也不要使用示例占位文字。最小配置如下：

```dotenv
# 至少 32 字节；建议使用上面的命令生成。
BOX_SESSION_SECRET=粘贴刚生成的随机值

# 已通过 HTTPS 域名访问时使用 true。
BOX_COOKIE_SECURE=true

# 可选：默认是 9999。
# PORT=9999
```

`BOX_COOKIE_SECURE` 影响浏览器是否发送登录 Cookie：

- **公网、反向代理或 Cloudflare Tunnel，且最终访问地址为 HTTPS：** 保持 `true`。
- **仅限本机 `http://localhost` 调试：** 改为 `false`。
- **不要为了公网 HTTP 临时改为 `false`。** 应先配置 HTTPS；否则账号密码和会话都有被网络窃取的风险。

可选变量 `BOX_SESSION_TTL_SECONDS` 用于指定会话秒数（默认 `43200`，即 12 小时）；`BOX_AUTH_USERS_FILE` 可把账户文件放在其他安全且可读的绝对路径。

### 4. 配置 `resources/data/auth-users.json`

`resources/content/auth-users.example.json` 只是可复制的结构示例。实际的 `resources/data/auth-users.json` 至少需要一个账户，每个账户必须有：

- `username`：2–64 个字符，只能使用字母、数字、`.`、`_`、`-`；
- `passwordHash`：由下一步脚本生成的完整 `scrypt$...` 字符串，不能填明文密码；
- `permissions`：至少一项工具权限。

管理员账户示例：

```json
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "下一步生成的完整 scrypt 哈希",
      "permissions": ["*"]
    }
  ]
}
```

`"*"` 代表全部工具。若要创建受限账户，可使用具体工具 slug，例如：

```json
{
  "username": "player",
  "passwordHash": "该账户自己的完整 scrypt 哈希",
  "permissions": ["tarot-reading", "initiative-tracker"]
}
```

当前可用权限为：`carcassonne`、`claude-code-guide`、`dnd-translator`、`edh-builder`、`edh-life`、`initiative-tracker`、`initiative-tracker/display`、`json-visualizer`、`tarot-reading`、`savings-tracker`、`css-cascade`、`dnd-character`、`conways-game-of-life`、`lan-chat`、`medicine-inventory`、`texas-holdem`、`static-sites`、`target-text`、`scratch-cards`。授予 `initiative-tracker` 会同时授予其 `/display` 主屏；单独授予 `initiative-tracker/display` 则只可访问主屏。

### 5. 为每个账户生成密码哈希

在**交互式终端**中运行以下命令；密码输入不会显示：

```powershell
node code/server/create-password-hash.js
```

按提示输入同一个密码两次（脚本要求至少 4 个字符；生产密码应使用长且唯一的密码）。命令会输出一整行类似下面的内容：

```text
scrypt$16384$8$1$...$...
```

把**完整的一行**粘贴到对应账户的 `passwordHash`。每个账户都要独立运行一次脚本并使用不同密码哈希。保存 JSON 后，请确认逗号、引号和数组格式正确；错误的 JSON、空哈希、重复用户名或空权限会使服务拒绝启动。

### 6. 初始化 SQLite 数据库并导入初始账户

账户配置完成后，执行一次：

```powershell
npm run db:setup
```

此命令会创建 `resources/data/box.sqlite`、应用受版本控制的数据库结构，并导入 `resources/data/auth-users.json`、已有 EDH 牌组、DND 人物卡快照和省钱记录。导入前会自动在 `resources/data/backups/` 建立源 JSON 备份，**不会删除原文件**。

之后运行时的账户、权限、EDH 牌组、DND 人物卡、省钱记录、局域网大厅的消息/附件元数据，以及首页的收藏、折叠分类、主题、视图偏好和最近使用记录均以 SQLite 为准；局域网聊天附件本体保存于 `resources/data/chat/uploads/`，家庭药箱图片本体保存于私有目录 `resources/data/medicine/uploads/`。新账户首次保存 DND 人物卡会直接创建 SQLite 数据，不会生成 JSON。`resources/data/auth-users.json` 仅用于新机器首次初始化或有计划的数据迁移。务必将 `resources/data/box.sqlite`、`resources/data/chat/` 与 `resources/.env.local` 一起纳入私密备份，并确保 `resources/data/` 对服务账户可写。

### 7. 构建、启动和首次验证

```powershell
npm run build
npm start
```

访问 `https://你的域名/`（或本机调试时的 `http://localhost:9999`），使用刚配置的账户登录。若服务启动时提示账户无效或会话密钥不足 32 字节，请逐项检查 `resources/.env.local` 与 SQLite 里的账户（首次导入用的是 `resources/data/auth-users.json`），不要删除认证逻辑来绕过错误。

目标机器运行时必须允许 `resources/data/` 写入 SQLite 和卡牌索引更新。应定期备份 `resources/.env.local`、`resources/data/box.sqlite` 和 `resources/data/edh/cards.json`；首次导入期也应保留 `resources/data/auth-users.json`、`resources/data/edh/decks/`、`resources/data/dnd/saves/` 与 `resources/data/savings.json` 的历史 JSON 备份。

## 本地启动

### 1. 安装依赖

```powershell
npm run install:code
```

### 2. 配置认证

在项目根目录的 PowerShell 中执行：

```powershell
New-Item -ItemType Directory -Force resources\data | Out-Null
Copy-Item resources\.env.example resources\.env.local
Copy-Item resources\content\auth-users.example.json resources\data\auth-users.json
node code/server/create-password-hash.js
```

将命令输出的密码哈希填入 `resources/data/auth-users.json` 对应账户的 `passwordHash`，并在 `resources/.env.local` 中设置至少 32 字节的随机 `BOX_SESSION_SECRET`。本地 HTTP 开发请设置 `BOX_COOKIE_SECURE=false`。账户写好后先执行一次 `npm run db:setup` 把它们导入 SQLite，再启动服务。

如果使用的是 `cmd.exe`，前两条复制命令改为：

```bat
copy resources\.env.example resources\.env.local
copy resources\content\auth-users.example.json resources\data\auth-users.json
```

`resources/data/auth-users.json` 含真实账户配置，已被 Git 忽略，不能提交。完整账户、权限和会话说明见[认证与授权](./docs/authentication.md)。

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

默认端口为 `9999`；可通过 `PORT` 环境变量修改。生产部署须保留可写且持久化的 `resources/data/` 目录，以保存 `resources/data/box.sqlite` 与 EDH 卡池；同时安全保存 `resources/.env.local`。服务器上用 systemd 常驻时应直接执行 `node code/server/index.js`（工作目录为发布目录），不要用 `npm start`，否则每次重启都会重新构建。

## 工具

所有工具均须先登录；账户还必须具备相应权限。

| 工具 | 路径 | 说明 | 文档 |
| --- | --- | --- | --- |
| Claude Code 学习中心 | `/tools/claude-code-guide` | JSON 驱动的指令、技巧和常见问题参考 | [查看](./docs/claude-code-guide.md) |
| DND 语言翻译器 | `/tools/dnd-translator` | 中英文翻译、奇幻字体展示与符文图片导出 | [查看](./docs/dnd-translator.md) |
| 卡卡颂计分台 | `/tools/carcassonne` | 双人卡卡颂计分、物品结算与 SQLite 存档 | [查看](./docs/carcassonne.md) |
| 康威生命游戏 | `/tools/conways-game-of-life` | 可绘制、演化、保存快照的赛博元胞自动机实验室 | [查看](./docs/conways-game-of-life.md) |
| 目标大屏 | `/tools/target-text` | 将一句关键文字以全屏、滚动、闪烁或倒计时形式投屏展示 | [查看](./docs/target-text.md) |
| 局域网大厅 | `/tools/lan-chat` | 局域网公共聊天与文件互发：历史消息、图片视频预览、回复、@ 提及与实时在线状态 | [查看](./docs/lan-chat.md) |
| DND 人物卡 | `/tools/dnd-character` | 按账户保存角色、装备、法术与日志快照 | [查看](./docs/dnd-character.md) |
| DND 先攻追踪器（遥控器） | `/tools/initiative-tracker` | 管理角色、回合、状态与骰子 | [查看](./docs/initiative-tracker-room.md) |
| DND 先攻追踪器（主屏） | `/tools/initiative-tracker/display` | 创建/接管房间并在大屏展示战斗 | [查看](./docs/initiative-tracker-room.md) |
| JSON 星系 | `/tools/json-visualizer` | JSON 校验、格式化、压缩与 3D 浏览 | [查看](./docs/json-visualizer.md) |
| EDH 指挥官组卡台 | `/tools/edh-builder` | 中文优先高级检索、拖放组牌与账户隔离的牌组 | [查看](./docs/edh-builder.md) |
| 塔罗牌占卜 | `/tools/tarot-reading` | 78 张牌与多种牌阵的互动抽牌 | [查看](./docs/tarot-reading.md) |
| 省钱网页 | `/tools/savings-tracker` | 按账户隔离的省钱记录和统计 | [查看](./docs/savings-tracker.md) |
| 家庭药箱 | `/tools/medicine-inventory` | 共享记录家庭药品库存、批次效期、用药流水与药品图片，及时发现临期和低库存药品 | [查看](./docs/medicine-inventory.md) |
| CSS 层叠解释器 | `/tools/css-cascade` | 解析并可视化 CSS 规则、特异性与上下文 | [查看](./docs/css-cascade.md) |
| 万智牌 EDH 记血器 | `/tools/edh-life` | 2~4 人指挥官记血、六种计数器、3D 骰子与硬币、对局与时长存 SQLite | [查看](./docs/edh-life.md) |
| 德州扑克 | `/tools/texas-holdem` | 房间号联机对战、可加机器人陪玩、筹码与账户绑定，服务端权威发牌与边池结算 | [查看](./docs/texas-holdem.md) |
| 刮刮乐小店 | `/tools/scratch-cards` | 商店买票、桌上随手摆、刮开涂层玩四种奖、兑奖机换钱与碎纸机换纸屑 | [查看](./docs/scratch-cards.md) |
| 静态站点挂载 | `/tools/static-sites` | 上传 HTML/CSS/JS 文件夹或 zip 即上线，通过独立站点域名对外访问 | [查看](./docs/static-sites.md) |

## 常用命令

以下命令都在**项目根目录**执行，根目录的 `package.json` 会转发到 `code/`：

```powershell
npm run install:code   # 安装依赖（只在 code/ 里安装）
npm run dev            # 开发服务，含 Next.js 热更新
npm run build          # 生成 code/out 生产产物
npm start              # 启动生产服务（会先构建一次）
npm run db:generate    # 生成 Prisma 客户端
npm run db:migrate     # 创建/升级 resources/data/box.sqlite
npm run db:setup       # 首次初始化：建库 + 导入旧 JSON 数据
npm run lint           # 运行项目的 lint 脚本
```

## 项目结构

项目按用途分成四类，目录名是英文，方便在服务器之间整目录上传下载：

```text
code/          代码类：Next.js 页面（app/、components/、lib/）、服务端（server/）、
               Prisma（prisma/）、独立静态应用（dnd-app/）、依赖（node_modules/）与
               构建产物（out/）
resources/     资源类：所有会被搬来搬去的数据和素材
  content/     受版本控制的资源：工具定义、内置卡牌、页面资料与配置模板
  data/        Git 忽略的运行时数据：SQLite、账户文件、上传、缓存与用户站点
  public/      字体与图片等静态资源（image/ 约 65 MB，首次部署用 -IncludeImages 或在服务器上单独同步）
  .env.local   私密配置（含会话密钥），不提交、不打包
docs/          文档类：项目、认证和每个工具的说明
ops/           命令行类：scripts/（数据库与维护脚本）、release/（把项目目录完整复制到
               服务器的打包与部署脚本）、checks/、logs/、RUN.bat（本地启动脚本，不入库）
package.json   根命令转发：在这里执行 npm run dev / build / db:* 即可
```

部署到服务器时，只把项目目录整体复制一份过去：`code/`、`docs/`、`ops/`、`resources/content/` 与 `resources/public/` 被新版本覆盖，`resources/.env.local`、`resources/data/`、`resources/public/image/` 和 `code/node_modules/` 在服务器上就地保留。服务器上**没有**多版本目录，升级就是「覆盖代码 + 重新构建 + 重启服务」，工具是 `ops/release/upload-project.ps1` 与 `ops/release/deploy-project.sh`。完整流程见[部署指南](./docs/deployment.md)与[服务器运维](./docs/server-operations.md)。

## 文档

文档索引和维护约定位于 [docs/README.md](./docs/README.md)。新增工具时，请同时更新 `resources/content/tools.json`、服务端权限白名单（如需要）和对应的 `docs/<tool>.md`。
