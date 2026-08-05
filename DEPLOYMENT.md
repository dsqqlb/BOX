# BOX 项目部署指南

## 本地开发

### 1. 安装依赖
```bash
npm install
```

### 2. 启动完整服务（Next.js + WebSocket）
```bash
npm run dev:full
```

这会同时启动：
- Next.js前端：http://localhost:9999
- WebSocket服务器：ws://localhost:9998

### 3. 分别启动（可选）

```bash
npm run dev        # 只启动前端
npm run ws-server   # 只启动WebSocket服务器
```

---

## Mac Mini (M4) Docker 部署

整体架构：两个独立容器，用 `docker-compose` 编排。

| 容器 | 说明 | 端口 |
|---|---|---|
| `box-web` | Next.js 静态导出产物，由 nginx 托管 | 9999 -> 80 |
| `box-ws-server` | WebSocket 房间同步 + 怪物图片清单接口 | 9998 |

两个容器共享同一份 `public/image` 目录（通过 volume 挂载，只读），以后新增/修改塔罗牌图片、怪物图片，**直接把文件放进对应文件夹即可生效，不需要重新构建镜像**。

### 1. 前置准备

在 Mac mini 上安装 Docker Desktop（或 OrbStack，M系列芯片跑得更快更省电）：
- Docker Desktop: https://www.docker.com/products/docker-desktop/
- 或者 OrbStack: https://orbstack.dev/

安装完成后确认命令可用：
```bash
docker --version
docker compose version
git --version
```

### 2. 克隆项目到 Mac mini

```bash
cd ~
git clone https://github.com/dsqqlb/BOX.git
cd BOX
```

### 3. （可选）配置固定的 WebSocket 地址

默认情况下**什么都不需要配置**：前端代码会自动识别访问者当前用的地址（IP或域名），拼上 `:9998` 去连 WebSocket 服务。局域网内其他设备（手机、平板、电脑）直接用 Mac mini 的局域网IP访问即可正常工作。

只有当你有一个**固定域名 + 反向代理**（比如接了 Cloudflare Tunnel、走 HTTPS）的场景，才需要固定地址。此时新建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env`，加入：
```bash
NEXT_PUBLIC_WS_URL=wss://ws.yourdomain.com
```

> 注意：这个值会在**构建时**被打进静态文件里，改了之后需要重新 `docker compose up --build` 才生效。

### 4. 构建并启动

```bash
docker compose up --build -d
```

第一次构建会比较慢（要下载 node/nginx 基础镜像 + npm install），之后代码没变的层会走缓存，速度会快很多。

查看运行状态：
```bash
docker compose ps
docker compose logs -f          # 看全部日志
docker compose logs -f ws-server  # 只看WebSocket服务日志
```

### 5. 访问

- Mac mini 本机：`http://localhost:9999`
- 局域网其他设备：`http://<Mac mini的局域网IP>:9999`（比如 `http://192.168.1.50:9999`）
  - 查Mac mini的局域网IP：`ipconfig getifaddr en0`（Wi-Fi）或 `en1`（有线，具体看你的网络接口名）

先攻追踪器主屏幕：`/tools/initiative-tracker/display`
先攻追踪器遥控器：`/tools/initiative-tracker`
塔罗牌占卜：`/tools/tarot-reading`

### 6. 停止 / 重启

```bash
docker compose down          # 停止并移除容器
docker compose restart       # 重启（不重新构建）
docker compose up --build -d # 重新构建并启动（代码更新后用这个）
```

---

## GitHub Push 自动部署

提供两种方案，**优先推荐方案A**（更简单、不需要暴露任何端口到公网）。

### 方案 A：轮询自动部署（推荐）

原理：Mac mini 上跑一个后台脚本，定期（默认60秒）检查 GitHub 上 `main` 分支有没有新提交，有就自动执行 `docker compose up --build -d`。

**优点**：不需要把 Mac mini 暴露到公网，纯内网也能用。
**缺点**：有轮询间隔的延迟（可接受，默认1分钟内会部署上）。

#### 安装步骤

1. 把 `mac-mini/com.box.autodeploy.plist` 里的路径占位符替换成项目实际路径，并复制到 launchd 的目录：

```bash
cd ~/BOX
PROJECT_DIR="$(pwd)"

# 替换占位符并复制到launchd目录
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" mac-mini/com.box.autodeploy.plist > ~/Library/LaunchAgents/com.box.autodeploy.plist

# 确保脚本有执行权限
chmod +x mac-mini/deploy.sh mac-mini/auto-deploy-poll.sh

# 加载并启动这个后台服务
launchctl load ~/Library/LaunchAgents/com.box.autodeploy.plist
```

2. 验证是否在运行：

```bash
launchctl list | grep com.box.autodeploy
tail -f mac-mini/autodeploy.log        # 看轮询日志
```

3. 之后每次你在本地 `git push` 到 `main` 分支，Mac mini 会在1分钟内自动检测到并重新部署。

#### 管理命令

```bash
# 停止自动部署服务
launchctl unload ~/Library/LaunchAgents/com.box.autodeploy.plist

# 重新启动（比如改了轮询间隔之后）
launchctl unload ~/Library/LaunchAgents/com.box.autodeploy.plist
launchctl load ~/Library/LaunchAgents/com.box.autodeploy.plist

# 手动触发一次部署（不用等轮询）
./mac-mini/deploy.sh
```

### 方案 B：GitHub Webhook 即时部署

原理：GitHub 在你 push 后主动发一个 HTTP 请求通知 Mac mini，几秒内触发部署，比轮询更即时。

**前提**：Mac mini 需要能被 GitHub 访问到，也就是你已经配置了内网穿透（Cloudflare Tunnel / frp / ngrok）或者有公网IP+端口转发。如果没有这个前提，请用方案A。

#### 安装步骤

1. 在 Mac mini 上启动 webhook 接收服务（建议同样用 launchd 或 pm2 常驻）：

```bash
cd ~/BOX
WEBHOOK_SECRET="设置一个随机密钥" WEBHOOK_PORT=9000 node mac-mini/webhook-server.js
```

2. 把这个 9000 端口通过你的内网穿透方案暴露出去，得到一个公开可访问的地址，例如 `https://webhook.yourdomain.com`。

3. 在 GitHub 仓库页面：Settings -> Webhooks -> Add webhook
   - Payload URL: `https://webhook.yourdomain.com/webhook`
   - Content type: `application/json`
   - Secret: 和上面设置的 `WEBHOOK_SECRET` 保持一致
   - 事件: 选择 "Just the push event"

4. 之后每次 push 到任意分支，GitHub 会通知 webhook 服务；服务只在检测到是 `main` 分支时才触发部署。

> 想让 webhook-server.js 开机自启，可以参考方案A里的 launchd 配置方式，把 `ProgramArguments` 换成 `node mac-mini/webhook-server.js`，并把 `WEBHOOK_SECRET`/`WEBHOOK_PORT` 加进 `EnvironmentVariables`。

---

## 测试跨设备连接

1. 确保 Mac mini 上 `docker compose ps` 显示两个容器都是 `running`/`healthy`
2. 在 Mac mini 上打开主屏幕：`http://localhost:9999/tools/initiative-tracker/display`
3. 在其他设备（手机/平板/电脑，需要和Mac mini在同一局域网）上打开遥控器：`http://<Mac mini局域网IP>:9999/tools/initiative-tracker`
4. 输入房间号连接

## 故障排查

### 容器起不来 / WebSocket连不上

```bash
docker compose ps                    # 看容器状态是否 healthy
docker compose logs ws-server        # 看WebSocket服务的报错
docker compose logs web               # 看nginx的报错

# 检查端口有没有被本机其他程序占用
lsof -i :9999
lsof -i :9998
```

### 图片显示不出来（怪物图/塔罗牌图/角色立绘）

确认 `public/image` 目录在宿主机上确实存在对应文件，并且 volume 挂载生效：
```bash
docker compose exec web ls /usr/share/nginx/html/image/enemies
docker compose exec ws-server ls /public/image/enemies
```

### 自动部署没有生效

```bash
# 方案A（轮询）
launchctl list | grep com.box.autodeploy   # 确认服务在跑
tail -50 mac-mini/autodeploy.log            # 看轮询日志，确认有没有检测到新commit
tail -50 mac-mini/autodeploy.error.log      # 看有没有报错

# 手动跑一次部署脚本，看具体报错
./mac-mini/deploy.sh
```

### 房间/备选池数据丢失

- **战斗中的角色数据**：存在 WebSocket 服务的内存里，容器重启（比如自动部署触发的重新构建）会清空。这是当前架构的已知限制，如果需要持久化，后续可以考虑把房间状态存到文件或轻量数据库里。
- **遥控器的备选池**：存在浏览器 localStorage，只有清除浏览器数据或手动删除角色才会丢失，跟服务器部署无关。

## 端口说明

| 端口 | 用途 |
|---|---|
| 9999 | 前端（nginx托管的静态站点），映射到容器内的80 |
| 9998 | WebSocket服务器（房间同步 + 怪物图片清单接口） |
| 9000 | （可选）GitHub Webhook 接收服务，仅方案B需要 |

如需修改端口，同时改：
1. `docker-compose.yml` 里对应服务的 `ports`
2. 如果改了9998，`server/websocket-server.js` 里的 `WS_PORT` 环境变量默认值，以及 `lib/useWebSocket.ts` 的 `getWsUrl()` 默认端口参数

## 安全建议

生产环境（尤其是暴露到公网时）建议：
1. 用 Cloudflare Tunnel 之类的方案接入 HTTPS/WSS，不要直接裸奔 HTTP/WS
2. GitHub Webhook 一定要设置 `WEBHOOK_SECRET`，否则任何人都能触发部署
3. 给房间号/遥控器加基础的身份校验（当前版本没有做鉴权，房间号即权限）
4. 限制房间数量和连接数，防止被刷爆内存
