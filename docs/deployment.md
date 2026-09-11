# 部署指南（Linux / Windows / macOS）

从 GitHub 克隆到真正跑起来的完整步骤，每一步都带验证方法。照着做完，你会得到一个可登录、可长期运行的 BOX 实例。

---

## 0. 先理解这个项目怎么跑

只有**一个 Node 进程、一个端口**（默认 9999），它同时负责：

| 职责 | 说明 |
| --- | --- |
| 页面 | 生产环境托管 `next build` 导出的静态产物 `out/`；开发环境挂 Next.js dev server |
| 认证 | 除 `/login` 外，所有页面、API、WebSocket 都要求登录 |
| 业务 API | 账户、工具数据、文件上传等 |
| WebSocket | `/ws`（先攻追踪器）、`/ws?kards=1`、`/ws?holdem=1`、`/ws/chat` |
| 静态站点挂载 | 按 `Host` 请求头分流到独立域名（可选功能） |

> **不要只把 `out/` 丢到静态托管**（Vercel / Netlify / GitHub Pages / 纯 Nginx）。登录、权限、WebSocket、数据库读写全都在 `server/index.js` 里，缺了它一半功能不可用。

**必须持久化的目录是 `data/`**，里面有 SQLite 数据库和所有用户上传的文件。

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | **20 LTS 或 22 LTS**（最低 18.18，Next 15 的下限）。已在 Node 24 上验证可用 |
| npm | 随 Node 附带，10 以上 |
| Git | 任意近期版本 |
| 磁盘 | 基础约 1.5 GB（含 `node_modules`）。若同步 EDH 卡库另需约 100 MB；用户上传另算 |
| 内存 | 构建阶段建议 ≥ 2 GB；运行阶段约 150–300 MB |
| 架构 | x64 / arm64 均可（Prisma 与 sharp 都有对应预编译包） |

项目未固定 Node 版本（没有 `engines` 与 `.nvmrc`），所以请自己确保用的是上面的版本。

### 1.1 安装 Node

**Linux（Debian / Ubuntu，推荐 NodeSource）**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

**Linux（任意发行版，推荐 nvm，不需要 root）**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
```

**macOS（Homebrew）**

```bash
brew install node@22 git
brew link --overwrite node@22
```

**Windows（winget，PowerShell）**

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

装完**关掉终端重新开一个**，否则 `PATH` 不生效。

### 1.2 验证

三平台通用：

```bash
node -v      # 期望 v20.x / v22.x（v18.18+ 也可）
npm -v       # 期望 10.x 或更高
git --version
```

---

## 2. 克隆项目

**Linux / macOS**

```bash
cd ~
git clone https://github.com/dsqqlb/BOX.git
cd BOX
```

**Windows（PowerShell）**

```powershell
cd $env:USERPROFILE
git clone https://github.com/dsqqlb/BOX.git
cd BOX
```

**验证**：`git log -1 --oneline` 能看到最新提交，且当前目录下有 `server/`、`app/`、`prisma/`。

> 路径里**不要带空格或中文**，某些工具链在 Windows 上会出问题。

---

## 3. 安装依赖

```bash
npm install
```

耗时几分钟。会顺带下载 Prisma 引擎与 sharp 的预编译二进制，**这一步需要联网**。

npm 可能提示若干包含安装脚本的依赖（`@prisma/client`、`prisma`、`sharp` 等），属正常现象。

**验证**：

```bash
node -e "require('@prisma/client'); require('ws'); require('yauzl'); require('pokersolver'); console.log('依赖就绪')"
```

期望输出 `依赖就绪`。

**离线/内网机器**：在有网机器上执行完 `npm install` 后，把整个 `node_modules` 一起拷过去；注意必须是**同一操作系统与 CPU 架构**，否则 Prisma 与 sharp 的二进制不兼容。

---

## 4. 创建 `.env.local`

### 4.1 从模板复制

**Linux / macOS**

```bash
cp .env.example .env.local
```

**Windows（PowerShell）**

```powershell
Copy-Item .env.example .env.local
```

### 4.2 生成会话密钥

三平台通用（用项目自带的 Node，不依赖 openssl）：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

复制整行输出。

### 4.3 编辑 `.env.local`

最小可用配置只有两项：

```dotenv
# 会话签名密钥：必须至少 32 字节。填上一步生成的随机值，不要用示例文字。
BOX_SESSION_SECRET=把上一步的输出粘贴到这里

# 通过 HTTPS 域名访问时设为 true；仅本机或局域网 HTTP 访问时设为 false。
BOX_COOKIE_SECURE=false
```

`BOX_COOKIE_SECURE` 决定浏览器会不会发送登录 Cookie，配错的直接后果是**能提交登录但一直跳回登录页**：

| 访问方式 | 取值 |
| --- | --- |
| `https://你的域名`（含反向代理 / Cloudflare Tunnel 终结 HTTPS） | `true` |
| `http://localhost:9999` 或 `http://192.168.x.x:9999` | `false` |
| 公网 HTTP（没有证书） | **先配好 HTTPS**，不要为此改成 `false`，否则密码与会话可被中途窃取 |

其他可选项（都有合理默认值，不改也能跑）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `9999` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；只给本机用可设 `127.0.0.1` |
| `BOX_SESSION_TTL_SECONDS` | `43200` | 登录有效期（12 小时） |
| `DATABASE_URL` | `data/box.sqlite` | 数据库位置，想放到别的持久盘时设为 `file:/srv/box-data/box.sqlite` |
| `CHAT_MAX_UPLOAD_BYTES` | 1 GiB | 局域网大厅单文件上限 |
| `BOX_SITES_HOST` / `BOX_PRIMARY_HOST` | 空 | 静态站点挂载，见第 10 节 |

**验证**：

```bash
node -e "require('./server/config'); console.log('密钥长度', Buffer.byteLength(process.env.BOX_SESSION_SECRET||''))"
```

期望输出的长度 **≥ 32**。若为 0，说明 `.env.local` 没被读到或变量名拼错了。

---

## 5. 准备第一个账户

数据库里**没有账户时服务会拒绝启动**，所以必须先准备一个。这也是唯一的引导入口——账户管理页本身就要求先以管理员身份登录。

### 5.1 复制账户模板

**Linux / macOS**

```bash
cp content/auth-users.example.json data/auth-users.json
```

**Windows（PowerShell）**

```powershell
Copy-Item content/auth-users.example.json data/auth-users.json
```

### 5.2 生成密码哈希

必须在**交互式终端**里运行（输入不会回显）：

```bash
node server/create-password-hash.js
```

按提示输入同一个密码两次，得到形如下面的一整行：

```text
scrypt$16384$8$1$xxxxxxxxxxxx$yyyyyyyyyyyy...
```

### 5.3 填写 `data/auth-users.json`

把整行哈希粘进 `passwordHash`。`"*"` 表示拥有全部工具权限：

```json
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "scrypt$16384$8$1$...$...",
      "permissions": ["*"]
    }
  ]
}
```

规则（不满足会导致下一步导入失败）：

- 用户名 2–64 字符，只能用字母、数字、`.`、`_`、`-`
- `passwordHash` 必须以 `scrypt$` 开头，**不能填明文密码**
- `permissions` 至少一项，不能是空数组
- 想加受限账户就再跑一次哈希脚本，每个账户用不同密码：

  ```json
  { "username": "player", "passwordHash": "scrypt$...", "permissions": ["tarot-reading", "initiative-tracker"] }
  ```

完整权限列表见 [认证与授权](./authentication.md)。

**验证**：

```bash
node -e "const u=require('./data/auth-users.json').users; console.log(u.length, '个账户'); u.forEach(x=>console.log(x.username, x.passwordHash.startsWith('scrypt$') ? '哈希 OK' : '❌ 哈希无效', x.permissions.join(',')))"
```

---

## 6. 初始化数据库

```bash
npm run db:setup
```

这条命令依次做四件事：

| 子步骤 | 作用 |
| --- | --- |
| `db:generate` | 生成 Prisma 客户端 |
| `db:migrate` | 创建 `data/box.sqlite` 并应用 `prisma/migrations/` 下的全部结构（当前 11 个） |
| `db:import-json` | 把 `data/auth-users.json` 的账户导入数据库；导入前自动备份到 `data/backups/` |
| `db:migrate-runtime-json` | 增量导入历史的 DND / 省钱 JSON；全新部署没有这些文件，会显示 0 条，属正常 |

期望在输出末尾看到类似 `{"success": true, "users": 1, ...}`。

> ⚠️ `db:import-json` 会**清空并替换**数据库里的用户、权限和 EDH 牌组。它只适合首次初始化或有计划的迁移，**日常升级不要跑它**（升级只需 `db:generate` + `db:migrate`，见第 12 节）。

**验证**：

```bash
node -e "const {prisma}=require('./server/db'); prisma.user.findMany({select:{username:true,permissions:{select:{permission:true}}}}).then(u=>{console.log(JSON.stringify(u,null,2)); process.exit(0);})"
```

应打印出你刚配置的账户及其权限。

---

## 7. 构建前端

```bash
npm run build
```

产出静态站点到 `out/`。生产模式下服务会从这里读页面，**没有 `out/` 会拒绝启动**。

期望结尾看到 `✓ Exporting` 与一张路由表，其中包含 `/tools/...` 的各个页面。

**验证**：

```bash
node -e "const fs=require('fs'); console.log('out 存在:', fs.existsSync('out/index.html'), '| 页面数:', fs.readdirSync('out/tools').length)"
```

---

## 8. 启动并完成首次验证

### 8.1 启动

```bash
npm start
```

`npm start` 会**先自动跑一次构建**（`prestart` 钩子），所以第一次会稍慢。已经构建过、想直接起服务可以用：

```bash
node server/index.js
```

启动成功的输出形如：

```text
🚀 BOX 服务已启动（生产模式，单端口）
   本机访问:   http://localhost:9999
   局域网访问: http://192.168.x.x:9999
   WebSocket:  ws://localhost:9999/ws
```

开发模式（带热更新，页面改动即时生效）：

```bash
npm run dev
```

### 8.2 逐项验证

**① 服务在监听、登录页匿名可访问**

Linux / macOS：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/login
```

Windows（PowerShell，注意用 `curl.exe`，否则会走 PowerShell 的别名）：

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:9999/login
```

期望 `200`。

**② 未登录时受保护资源被拦截**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/
```

期望分别是 `401` 和 `303`（重定向到登录页）。这说明认证网关生效了——**`/api/health` 也在登录之后，不能拿它当匿名健康检查**，请用 `/login` 做存活探测。

**③ 浏览器登录**

打开 `http://localhost:9999/`，会跳到登录页；用第 5 步的账户登录，应进入首页并看到有权限的工具卡片。

**④ 登录态与权限正确**

登录后在浏览器地址栏访问 `http://localhost:9999/api/auth/me`，应返回类似：

```json
{"username":"admin","allowedTools":["carcassonne","claude-code-guide", "..."],"isAdmin":true}
```

**⑤ 管理员账户页可用**

管理员访问 `http://localhost:9999/admin/accounts`，可以新建账户、改权限、重设密码。以后加账户都在这里操作，不需要再动 `auth-users.json`。

**⑥ 数据库可写**

在「省钱网页」里加一条记录，刷新页面后仍在，说明 `data/` 可写、SQLite 正常。

**⑦ WebSocket 正常**

打开「DND 先攻追踪器（主屏）」生成房间号，再用「遥控器」输入该房间号。遥控器显示已连接、主屏出现角色即为正常。这条链路验证的是 `/ws` 升级请求与鉴权。

**⑧ 局域网访问**（可选）

同一网络的手机访问启动日志里的 `http://192.168.x.x:9999`。连不上就是防火墙没放行，见 9.1。

---

## 9. 让它常驻运行

前面用的是前台运行，关掉终端就停了。下面按平台选一种。

### 9.1 先放行端口

**Linux（ufw）**

```bash
sudo ufw allow 9999/tcp
```

**Linux（firewalld）**

```bash
sudo firewall-cmd --permanent --add-port=9999/tcp && sudo firewall-cmd --reload
```

**Windows（管理员 PowerShell）**

```powershell
New-NetFirewallRule -DisplayName "BOX 9999" -Direction Inbound -LocalPort 9999 -Protocol TCP -Action Allow
```

**macOS**：首次启动时系统会弹窗询问是否允许网络连接，点允许即可。

> 如果前面加了反向代理（第 11 节），就**不要**对公网放行 9999，只放行 80/443。

### 9.2 Linux：systemd（推荐）

```bash
sudo tee /etc/systemd/system/box.service >/dev/null <<'EOF'
[Unit]
Description=BOX 工具箱
After=network.target

[Service]
Type=simple
User=box
WorkingDirectory=/home/box/BOX
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now box
```

注意事项：

- `User` 与 `WorkingDirectory` 换成你自己的；该用户必须对 `data/` 有写权限
- 用 nvm 装的 Node 时，`ExecStart` 要写绝对路径，用 `which node` 查
- **不要**用 `ExecStart=npm start`：它会在每次重启时重新构建

**验证**：

```bash
systemctl status box --no-pager
journalctl -u box -n 30 --no-pager
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/login   # 期望 200
sudo systemctl restart box && sleep 3 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/login
```

### 9.3 macOS：launchd

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cat > ~/Library/LaunchAgents/com.box.server.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.box.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/你的用户名/BOX</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/你的用户名/Library/Logs/box.log</string>
  <key>StandardErrorPath</key><string>/Users/你的用户名/Library/Logs/box.error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.box.server.plist
```

Intel Mac 上 Homebrew 的 node 在 `/usr/local/bin/node`，Apple Silicon 在 `/opt/homebrew/bin/node`，用 `which node` 确认。

**验证**：

```bash
launchctl list | grep com.box.server
tail -n 30 ~/Library/Logs/box.log
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/login
```

停止：`launchctl unload ~/Library/LaunchAgents/com.box.server.plist`

### 9.4 Windows：NSSM 装成服务（推荐）

```powershell
winget install NSSM.NSSM
# 以管理员身份执行
nssm install BOX "C:\Program Files\nodejs\node.exe" "server\index.js"
nssm set BOX AppDirectory "C:\Users\你的用户名\BOX"
nssm set BOX AppStdout "C:\Users\你的用户名\BOX\logs\box.log"
nssm set BOX AppStderr "C:\Users\你的用户名\BOX\logs\box.error.log"
nssm set BOX Start SERVICE_AUTO_START
nssm start BOX
```

**验证**：

```powershell
Get-Service BOX
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:9999/login
Restart-Service BOX; Start-Sleep 3; curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:9999/login
```

不想装 NSSM 的话，也可以用「任务计划程序」建一个**开机时触发**、操作为 `node.exe server\index.js`、起始位置为项目目录的任务，并勾选「不管用户是否登录都要运行」。

### 9.5 跨平台：PM2

```bash
npm install -g pm2
pm2 start server/index.js --name box
pm2 save
pm2 startup        # 按它输出的命令再执行一次，实现开机自启
```

验证：`pm2 status`、`pm2 logs box --lines 30`。

---

## 10. 可选：静态资源与数据

这些不影响登录和大部分工具，按需执行。

| 内容 | 命令 | 说明 |
| --- | --- | --- |
| EDH 卡牌库 | `npm run sync:edh-cards` | 从 Scryfall 下载，约 100 MB，需联网。不同步时 EDH 组卡台的搜索会返回 503 |
| Kards 卡牌目录 | `npm run build:kards` | 仓库已带 `content/kards/cards.json`，只有自己新增卡图时才需要重跑 |
| DND 图片 | — | `public/image/` 已被 `.gitignore` 排除，但历史已跟踪的约 200 个 PNG 会随克隆带下来。要加新图就直接放进 `public/image/enemies/` 或 `public/image/player/<种族>/`，然后重新 `npm run build` |

## 10.1 可选：静态站点挂载的域名

这个工具要求站点跑在**与 BOX 主站不同的源**上（安全要求，原因见 [静态站点挂载](./static-sites.md)）。

**本地（还没有域名时）**——把 `localhost` 和 `127.0.0.1` 当两个源，不用改 hosts：

```dotenv
BOX_SITES_HOST=127.0.0.1:9999
BOX_PRIMARY_HOST=localhost:9999
```

- BOX 主站固定用 `http://localhost:9999` 打开
- 站点访问 `http://127.0.0.1:9999/站点名/`

**生产**：

```dotenv
BOX_SITES_HOST=pages.example.com
BOX_PRIMARY_HOST=box.example.com
```

把 `pages.example.com` 的 DNS 指到同一台服务器即可，同一个进程会按 `Host` 请求头分流。

---

## 11. 反向代理与 HTTPS

公网使用**务必**套 HTTPS，然后把 `.env.local` 里的 `BOX_COOKIE_SECURE` 设为 `true`。

三个必须做对的点，缺一个就会出问题：

1. **转发 WebSocket 升级**（`Upgrade` / `Connection` 头），否则先攻追踪器、聊天、德州扑克全都连不上
2. **传递 `X-Forwarded-Proto`**，否则服务端判断不出前端是 HTTPS，Secure Cookie 不会下发
3. **保留原始 `Host` 头**，否则静态站点挂载的域名分流会失效
4. **放开上传体积限制**，Nginx 默认只有 1 MB，会把聊天附件和 zip 上传直接掐掉

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name box.example.com pages.example.com;

    ssl_certificate     /etc/letsencrypt/live/box.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/box.example.com/privkey.pem;

    # 聊天附件默认上限 1 GiB，静态站点 zip 200 MiB；按需调整
    client_max_body_size 1g;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:9999;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

### Caddy（自动申请证书，最省事）

```caddyfile
box.example.com, pages.example.com {
    reverse_proxy 127.0.0.1:9999 {
        header_up X-Forwarded-Proto {scheme}
    }
    request_body {
        max_size 1GB
    }
}
```

Caddy 默认就会转发 WebSocket 并保留 `Host`，不用额外配置。

### Cloudflare Tunnel（没有公网 IP 时）

```bash
cloudflared tunnel --url http://localhost:9999
```

Cloudflare 免费版对上传有 100 MB 限制，大文件会失败；HTTPS 由 Cloudflare 终结，所以同样把 `BOX_COOKIE_SECURE` 设为 `true`。

**验证**（把域名换成你自己的）：

```bash
curl -sI https://box.example.com/login | head -n 1        # 期望 HTTP/2 200
curl -s -o /dev/null -w "%{http_code}\n" https://box.example.com/api/health   # 期望 401
```

再用浏览器登录一次；能正常登录且刷新后不掉登录态，说明 `X-Forwarded-Proto` 和 Cookie 配置都对了。

---

## 12. 升级到新版本

```bash
# 1. 停服（按你用的方式）
sudo systemctl stop box          # 或 pm2 stop box / Stop-Service BOX / launchctl unload ...

# 2. 备份（见第 13 节）

# 3. 拉取代码
git pull

# 4. 更新依赖
npm install

# 5. 只做结构迁移，绝不要跑 db:import-json
npm run db:generate
npm run db:migrate

# 6. 重新构建
npm run build

# 7. 启动
sudo systemctl start box
```

升级后重复第 8.2 节的验证。

关于登录态：只要 `BOX_SESSION_SECRET` 不变，**升级不会让用户掉登录**。会话只在这三种情况下失效——密钥被更换、管理员重设了该账户的密码、或会话超过有效期。

---

## 13. 备份与恢复

必须备份的内容：

| 路径 | 内容 | 丢了会怎样 |
| --- | --- | --- |
| `.env.local` | 会话密钥等配置 | 换了密钥所有人都要重新登录 |
| `data/box.sqlite` | 账户、权限、全部工具数据 | 一切用户数据丢失 |
| `data/chat/` | 局域网大厅的附件本体 | 聊天记录里的文件全部损坏 |
| `data/medicine/` | 家庭药箱照片 | 照片丢失 |
| `data/initiative-scenes/` | DND 场景媒体 | 媒体丢失 |
| `data/sites/` | 挂载的静态站点文件 | 站点内容丢失 |
| `data/edh/cards.json` | EDH 卡牌索引 | 可用 `npm run sync:edh-cards` 重新生成 |

**关键点**：数据库和上面这些文件目录必须取**同一时点**的备份。只备份 `.sqlite` 而不备份 `data/chat/`，恢复后数据库里有附件记录但文件不存在。

**Linux / macOS 简易备份**

```bash
sudo systemctl stop box
tar -czf ~/box-backup-$(date +%Y%m%d).tar.gz .env.local data/
sudo systemctl start box
```

**Windows（PowerShell）**

```powershell
Stop-Service BOX
Compress-Archive -Path .env.local, data -DestinationPath "$env:USERPROFILE\box-backup-$(Get-Date -Format yyyyMMdd).zip"
Start-Service BOX
```

**恢复**：停服 → 把 `.env.local` 与整个 `data/` 覆盖回去 → `npm run db:generate && npm run db:migrate` → 启动。

---

## 14. 故障排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 启动报「必须设置至少 32 字节的 BOX_SESSION_SECRET」 | 没建 `.env.local` 或密钥太短 | 回到第 4 节重新生成 |
| 启动报「SQLite 数据库中必须至少包含一个账户」 | 没执行账户导入 | 完成第 5、6 节 |
| 启动报「找不到静态产物目录」 | 没构建 | `npm run build` |
| `db:setup` 报「找不到账户文件」 | 没复制 `auth-users.json` | 见 5.1 |
| `db:setup` 报「密码哈希或权限无效」 | `passwordHash` 是空的/明文，或 `permissions` 为空数组 | 见 5.2、5.3 |
| 能提交登录但一直跳回登录页 | `BOX_COOKIE_SECURE` 与实际访问协议不符 | HTTP 访问设 `false`，HTTPS 设 `true` |
| 连续输错密码后登录不了 | 同一 IP 失败 5 次触发 15 分钟限流 | 等 15 分钟，或重启服务清空内存计数 |
| 先攻追踪器/聊天连不上，控制台报 WebSocket 失败 | 反向代理没转发 `Upgrade` | 见第 11 节 |
| 上传大文件失败（413） | 反向代理的 body 限制 | 调 `client_max_body_size` / `max_size` |
| EDH 搜索返回 503 | 卡牌库未同步 | `npm run sync:edh-cards` |
| `EACCES` / `SQLITE_READONLY` | 运行服务的用户对 `data/` 没有写权限 | `sudo chown -R box:box data/` |
| 端口被占用 `EADDRINUSE` | 9999 已被别的进程占用 | 改 `PORT`，或用 `lsof -i:9999` / `netstat -ano \| findstr 9999` 找出占用者 |
| 静态站点访问 404 | `BOX_SITES_HOST` 没配或 `Host` 头没保留 | 见 10.1 与第 11 节 |
| 管理页写操作报「请求来源无效」 | 用了和配置不一致的地址访问（例如混用 `localhost` 与 `127.0.0.1`） | 固定用同一个地址访问主站 |

查看日志：

```bash
journalctl -u box -f                      # Linux systemd
pm2 logs box                              # PM2
tail -f ~/Library/Logs/box.log            # macOS
Get-Content .\logs\box.log -Wait          # Windows
```

---

## 15. 上线前安全清单

- [ ] `BOX_SESSION_SECRET` 是新生成的随机值，没有复用其他环境的
- [ ] 公网访问已启用 HTTPS，且 `BOX_COOKIE_SECURE=true`
- [ ] `.env.local`、`data/auth-users.json`、`data/box.sqlite` 都**没有**提交到 Git（仓库已默认忽略，确认一下 `git status`）
- [ ] 每个账户使用独立的强密码；只给需要的工具权限，不要滥用 `"*"`
- [ ] 管理员账户数量最少化
- [ ] 反向代理只对外暴露 80/443，应用端口 9999 不对公网开放
- [ ] 备份任务已配置，并且**真的恢复过一次**验证可用
- [ ] 静态站点挂载确认用的是独立域名，且清楚哪些站点是公开的
- [ ] `data/` 所在磁盘有足够剩余空间（用户上传会持续增长）

---

## 相关文档

- [认证与授权](./authentication.md)：账户、权限 slug、管理员账户管理
- [静态站点挂载](./static-sites.md)：独立域名、公开/仅登录可见、上传与配置
- [文档索引](./README.md)：各工具的说明文档
