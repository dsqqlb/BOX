# BOX 项目部署指南

## 架构：一个进程、一个端口（9999）

整个项目只有一个服务、一个进程、一个端口。`server/index.js` 同时负责三件事：

| 职责 | 路径 | 说明 |
|---|---|---|
| 页面 | `/`、`/tools/*` | 生产托管 `next build` 的静态导出产物(`out/`)；开发挂 Next.js dev server（含HMR热更新） |
| WebSocket | `/ws` | 先攻追踪器的房间实时同步（主屏幕 ↔ 遥控器） |
| HTTP接口 | `/api/enemies`、`/api/player-images`、`/api/health` | 实时扫描图片目录返回清单 |

前端固定连"当前页面同源的 `/ws`"（见 `lib/useWebSocket.ts`），所以**不需要任何环境变量**：

- 本地开发 `http://localhost:9999` → WebSocket 自动连 `ws://localhost:9999/ws`
- 局域网 `http://192.168.1.50:9999` → 自动连 `ws://192.168.1.50:9999/ws`
- 公网域名 `https://box.dsqqlb.top` → 自动连 `wss://box.dsqqlb.top/ws`

三种场景零配置，也不存在"改了环境变量必须重新build才生效"这类坑。

---

## 本地开发

```bash
npm install
npm run dev
```

访问 http://localhost:9999 —— 一条命令，页面、房间实时同步、图片接口全都可用，热更新照常工作。

换端口：`PORT=8080 npm run dev`

### 本地跑生产模式（验证部署产物）

```bash
npm run build   # 生成 out/ 静态产物
npm start       # 用同一个服务器托管产物，同样只占9999
```

---

## Mac Mini (M4) Docker 部署

### 1. 前置准备

在 Mac mini 上安装 Docker Desktop（或 OrbStack，M系列芯片跑得更快更省电）：
- Docker Desktop: https://www.docker.com/products/docker-desktop/
- 或者 OrbStack: https://orbstack.dev/

确认命令可用：
```bash
docker --version
docker compose version
git --version
```

### 2. 克隆项目

```bash
cd ~
git clone https://github.com/dsqqlb/BOX.git
cd BOX
```

### 3. 环境变量

**不需要配置。** 直接进入下一步即可。

`.env.example` 里列的都是可选项（改端口、改图片目录）和将来可能用到的占位配置，跑起来一个都不用设。

### 4. 构建并启动

```bash
docker compose up --build -d
```

第一次构建较慢（下载 node 基础镜像 + npm install），之后代码没变的层会走缓存。

查看状态和日志：
```bash
docker compose ps
docker compose logs -f
```

### 5. 访问

- Mac mini 本机：`http://localhost:9999`
- 局域网其他设备：`http://<Mac mini局域网IP>:9999`
  - 查IP：`ipconfig getifaddr en0`（Wi-Fi）或 `en1`（有线，具体看网络接口名）
- 公网（配置了Cloudflare Tunnel，见下一节）：`https://box.dsqqlb.top`

页面路径：
- 先攻追踪器主屏幕：`/tools/initiative-tracker/display`
- 先攻追踪器遥控器：`/tools/initiative-tracker`
- 塔罗牌占卜：`/tools/tarot-reading`

### 6. Cloudflare Tunnel（走公网域名时才需要）

在 `~/.cloudflared/config.yml` 里加一条 ingress 规则指向9999：

```yaml
ingress:
  # ...你现有的其他规则保持不动...

  - hostname: box.dsqqlb.top
    service: http://127.0.0.1:9999

  - service: http_status:404   # 这条兜底规则必须放在最后
```

要点：
- 新增的 `- hostname:` 规则必须放在最后那条 `http_status:404` **之前**，ingress 是按顺序匹配的
- **不需要**为 WebSocket 单独配规则或申请子域名——WebSocket 走的是同一个域名同一个端口的 `/ws` 路径
- Cloudflare Tunnel 默认支持 WebSocket，不需要额外开关

重启隧道生效：
```bash
pm2 restart cf-tunnel
```

### 7. 停止 / 重启

```bash
docker compose down          # 停止并移除容器
docker compose restart       # 重启（不重新构建）
docker compose up --build -d # 代码更新后重新构建并启动
```

### 加图片不需要重新构建

`docker-compose.yml` 把宿主机的 `./public/image` 挂载到容器里（只读），`/api/enemies` 和 `/api/player-images` 每次请求都实时重新扫描目录。所以新增怪物图、玩家立绘、塔罗牌图，**把文件放进 `public/image` 对应子目录、刷新页面即可**，不用 rebuild。

文件命名约定：
- 怪物图：`public/image/enemies/中文名_英文标识.png`
- 玩家立绘：`public/image/player/种族中文_种族英文/职业中文.png`

---

## GitHub Push 自动部署

两种方案，**优先推荐方案A**（不需要暴露任何额外端口）。

### 方案 A：轮询自动部署（推荐）

Mac mini 上跑一个后台脚本，定期（默认60秒）检查 GitHub `main` 分支有没有新提交，有就自动 `docker compose up --build -d`。

优点：不需要把 Mac mini 暴露到公网，纯内网也能用。
缺点：有轮询间隔延迟（默认1分钟内部署上）。

```bash
cd ~/BOX
PROJECT_DIR="$(pwd)"

# 替换占位符并复制到launchd目录
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" mac-mini/com.box.autodeploy.plist > ~/Library/LaunchAgents/com.box.autodeploy.plist

chmod +x mac-mini/deploy.sh mac-mini/auto-deploy-poll.sh

launchctl load ~/Library/LaunchAgents/com.box.autodeploy.plist
```

验证与管理：
```bash
launchctl list | grep com.box.autodeploy      # 确认在跑
tail -f mac-mini/autodeploy.log                # 看轮询日志

# 停止
launchctl unload ~/Library/LaunchAgents/com.box.autodeploy.plist

# 手动触发一次部署
./mac-mini/deploy.sh
```

### 方案 B：GitHub Webhook 即时部署

GitHub 在你 push 后主动通知 Mac mini，几秒内触发部署。**前提**是 Mac mini 能被 GitHub 访问到（内网穿透或公网IP）。没有这个前提就用方案A。

```bash
cd ~/BOX
WEBHOOK_SECRET="设置一个随机密钥" WEBHOOK_PORT=9000 node mac-mini/webhook-server.js
```

把 9000 端口通过内网穿透暴露出去，然后在 GitHub 仓库 Settings -> Webhooks -> Add webhook：
- Payload URL: `https://webhook.yourdomain.com/webhook`
- Content type: `application/json`
- Secret: 和 `WEBHOOK_SECRET` 一致
- 事件: "Just the push event"

服务只在检测到是 `main` 分支时才触发部署。

---

## 故障排查

### 快速自检

```bash
# 1. 容器在跑吗
docker compose ps

# 2. 服务健康吗（这个接口会返回当前房间数）
curl http://127.0.0.1:9999/api/health
# 期望: {"ok":true,"dev":false,"rooms":0}

# 3. 图片接口正常吗
curl http://127.0.0.1:9999/api/enemies
# 期望: 一段JSON数组（空数组 [] 也算正常，说明目录里没图）

# 4. WebSocket能连吗（在项目目录下）
node test-ws.js
```

### 容器起不来

```bash
docker compose logs            # 看报错
lsof -i :9999                  # 9999被别的程序占了吗
```

### WebSocket连不上

因为页面和WebSocket是同一个端口同一个进程，**只要页面能打开，WebSocket理论上就能连**。如果连不上，按顺序查：

**1. 浏览器实际连的是什么地址**

F12 → Network → 筛选 `WS`，看请求地址是否为 `wss://<你的域名>/ws` 或 `ws://<IP>:9999/ws`。
- 地址对但连不上 → 往下看第2步
- 完全没有WS请求 → 看 Console 有没有JS报错，或者是否还没点"连接房间"

**2. 中间层有没有吞掉 WebSocket 升级请求**

只有走反向代理/隧道时才可能出现。先绕过中间层在本机直测：
```bash
# 在 Mac mini 本机测，不经过 Tunnel
node test-ws.js
```
- 本机能连、公网连不上 → 问题在 Cloudflare Tunnel 或中间的反代，确认隧道配置指向 `http://127.0.0.1:9999`
- 本机也连不上 → 容器/服务本身的问题，看 `docker compose logs`

**3. Tunnel 配置检查**（仅公网场景）

```bash
grep -A1 "box.dsqqlb.top" ~/.cloudflared/config.yml
# 期望: service: http://127.0.0.1:9999

cat ~/.cloudflared/config.yml
# 人工确认: box.dsqqlb.top 这条排在 "- service: http_status:404" 上面

pm2 list
pm2 logs cf-tunnel --lines 50
```

### 域名完全打不开

```bash
docker compose ps                      # 容器在跑吗
curl -I http://127.0.0.1:9999          # 本机能访问吗（排除Tunnel因素）
pm2 list && pm2 logs cf-tunnel --lines 50   # 隧道状态
# DNS：域名应该是一条指向Cloudflare的CNAME，新加的hostname第一次用可能要去
# Cloudflare Dashboard 的 DNS 设置里确认这条记录存在
```

### 图片显示不出来

```bash
# 确认挂载生效、文件在容器里能看到
docker compose exec box ls /app/out/image/enemies

# 确认接口能扫到
curl http://127.0.0.1:9999/api/enemies
```
如果接口返回空数组但宿主机目录里有文件，检查 `docker-compose.yml` 的 volume 路径和文件命名是否符合约定。

### 自动部署没生效

```bash
launchctl list | grep com.box.autodeploy
tail -50 mac-mini/autodeploy.log
tail -50 mac-mini/autodeploy.error.log
./mac-mini/deploy.sh              # 手动跑一次看报错
```

### 房间/备选池数据丢失

- **战斗中的角色数据**：存在服务进程内存里，容器重启（包括自动部署触发的重建）会清空。这是当前架构的已知限制，需要持久化的话后续可以把房间状态落盘。
- **遥控器的备选池、压暗强度滑块**：存在浏览器 localStorage，只有清浏览器数据才会丢，跟服务端部署无关。

---

## 端口说明

| 端口 | 用途 | 暴露范围 |
|---|---|---|
| 9999 | 全部：页面 + WebSocket(`/ws`) + 接口(`/api/*`) | 宿主机 / 局域网 / 公网(经Tunnel) |
| 9000 | （可选）GitHub Webhook 接收服务，仅自动部署方案B需要 | 需要时自行暴露 |

改端口只需改一处：`docker-compose.yml` 的 `ports`（以及容器内的 `PORT` 环境变量，保持两边一致）。本地开发用 `PORT=8080 npm run dev`。

## 安全建议

1. 公网访问用 Cloudflare Tunnel 接 HTTPS/WSS，不要裸奔 HTTP/WS（Cloudflare 边缘负责 HTTPS 终结，隧道到 Mac mini 内部走明文 HTTP，这是 Tunnel 的标准做法）
2. GitHub Webhook 一定要设 `WEBHOOK_SECRET`，否则任何人都能触发部署
3. **当前版本没有任何鉴权，房间号即权限**——知道6位房间号的人就能连进来操作战斗数据。朋友间用没问题，要公开就得补鉴权
4. 房间数量和连接数目前也没有限制，公开暴露的话建议加上限，防止被刷爆内存
