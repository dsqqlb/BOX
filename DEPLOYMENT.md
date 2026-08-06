# BOX 项目部署指南

## ⭐ 本次升级操作清单（Cloudflare Tunnel 单端口 WebSocket 支持）

这是从"局域网直连"升级到"Cloudflare Tunnel 单域名访问"（`box.dsqqlb.top`）需要执行的**完整顺序**。按顺序做，不要跳步。每一步后面都标注了"如何验证这一步成功"，出问题时先看对应的验证结果，再决定要不要往下走。

### 第0步：确认改了什么、为什么要这么改

本次改动涉及6个文件：`.env.example`、`DEPLOYMENT.md`、`Dockerfile`、`docker-compose.yml`、`lib/useWebSocket.ts`、`nginx.conf`。核心变化：
- 之前：前端(9999端口)和WebSocket(9998端口)是两个独立入口，Cloudflare Tunnel 的一个 hostname 只能指向一个端口，两个都要暴露就得占两个hostname
- 现在：nginx 新增 `/ws` 路径反代规则，把 WebSocket 请求也转发到内部的9998端口，对外只暴露9999端口这一个入口。`box.dsqqlb.top` 只需要指向9999端口，WebSocket走 `wss://box.dsqqlb.top/ws`

没有这次改动的话，直接把 `box.dsqqlb.top` 指到9999端口，页面能打开，但WebSocket连不上（因为它试图直连一个隧道没有转发规则的地址），先攻追踪器建房间/连接遥控器都会失败。

### 第1步（本地Windows机器）：提交并推送代码

```bash
git add .env.example DEPLOYMENT.md Dockerfile docker-compose.yml lib/useWebSocket.ts nginx.conf
git commit -m "feat: support Cloudflare Tunnel single-port WebSocket via /ws proxy"
git push origin main
```

**验证**：`git log --oneline -1` 应该显示刚才这条commit；`git status` 应该显示 clean（没有未提交的改动）。

### 第2步（Mac mini）：修改 cloudflared 配置

打开 `~/.cloudflared/config.yml`，在 `ingress:` 列表里、**最后那条 `- service: http_status:404` 之前**，插入：

```yaml
  - hostname: box.dsqqlb.top
    service: http://127.0.0.1:9999
```

> ingress 规则是**从上到下按顺序匹配**的，新规则必须放在兜底的 `http_status:404` 之前，否则永远匹配不到会直接落到404。你现有的其他 hostname 规则（`ai.`、`dnd.`、`uno.` 等）保持原位不动即可，互不影响。

保存后重启隧道：
```bash
pm2 restart cf-tunnel
```

**验证**：
```bash
pm2 logs cf-tunnel --lines 30
```
日志里应该能看到 `box.dsqqlb.top` 相关的路由加载信息，没有报错（比如 YAML 格式错误、重复hostname等）。也可以跑 `cloudflared tunnel ingress validate ~/.cloudflared/config.yml`（如果你的cloudflared版本支持这个子命令）提前校验语法。

### 第3步（Mac mini）：拉取代码

```bash
cd ~/BOX
git pull origin main
```

**验证**：`git log --oneline -1` 应该显示和第1步本地看到的**同一个commit hash**。如果 pull 报冲突，说明 Mac mini 上有未提交的本地修改（比如手动改过 `docker-compose.yml`），先 `git stash` 或者手动解决冲突再继续。

### 第4步（Mac mini）：配置 `.env`

**判断你是不是第一次在这台Mac mini上部署这个项目：**

- **是第一次（`~/BOX/.env` 文件不存在）**：
  ```bash
  cp .env.example .env
  ```
  `.env.example` 里默认已经写了 `NEXT_PUBLIC_WS_PATH_MODE=true`，复制过来就直接是对的，不用改。

- **不是第一次（`.env` 已经存在，可能已经配置了别的变量）**：
  **千万不要用 `cp` 覆盖**，会丢掉你已有的配置。改用编辑或追加：
  ```bash
  # 先看看现在.env里有什么，确认没有已经写过这行
  cat .env

  # 如果没有这一行，追加进去
  echo "NEXT_PUBLIC_WS_PATH_MODE=true" >> .env
  ```
  如果 `.env` 里已经写了 `NEXT_PUBLIC_WS_URL=xxx`（自定义WebSocket地址），**不要同时设置 `NEXT_PUBLIC_WS_PATH_MODE`**——两者只能选一个，`NEXT_PUBLIC_WS_URL` 优先级更高，设置了它 `PATH_MODE` 会被忽略。先攻追踪器场景下用 `PATH_MODE=true` 就够了，不需要 `NEXT_PUBLIC_WS_URL`。

**验证**：
```bash
cat .env | grep NEXT_PUBLIC_WS
```
应该只看到一行 `NEXT_PUBLIC_WS_PATH_MODE=true`（或者你确认要用的自定义方案）。

### 第5步（Mac mini）：重新构建并启动容器

```bash
docker compose up --build -d
```

**这一步必须带 `--build`**，因为 `NEXT_PUBLIC_WS_PATH_MODE` 是在 Next.js 构建阶段被内联进静态HTML/JS文件的环境变量，容器不重新构建，改了 `.env` 也不会生效（单纯的 `docker compose restart` 或不带 `--build` 的 `up -d` 都不够）。

第一次构建耗时较久（下载基础镜像 + npm install），一般几分钟内完成。

**验证**：
```bash
docker compose ps
```
`box-web` 和 `box-ws-server` 两个容器的 STATUS 都应该是 `Up` / `running`（healthy会稍晚一点显示，因为有启动延迟的健康检查）。

### 第6步：端到端验证

1. 浏览器打开 `https://box.dsqqlb.top`，页面应该能正常加载首页
2. 打开先攻追踪器主屏幕：`https://box.dsqqlb.top/tools/initiative-tracker/display`，应该能看到生成的房间号
3. 打开浏览器devtools（F12）→ Network 面板 → 筛选 `WS`，应该能看到一条状态为 `101 Switching Protocols` 的连接，地址是 `wss://box.dsqqlb.top/ws`
4. 手机或另一台设备打开遥控器：`https://box.dsqqlb.top/tools/initiative-tracker`，输入刚才看到的房间号连接，主屏幕应该能实时收到遥控器的操作

以上4步都通过，说明升级完全成功。任何一步失败，去下面的"故障排查"章节按对应症状查。

---

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
| `box-web` | Next.js 静态导出产物，由 nginx 托管；同时把 `/ws` 路径反代到 ws-server（Tunnel场景下WebSocket走这里） | 9999 -> 80 |
| `box-ws-server` | WebSocket 房间同步 + `/enemies` + `/player-images` 接口 | 9998（局域网直连用，Tunnel场景不直接暴露这个端口） |

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

### 3. 配置 WebSocket 地址

**局域网直连场景**（不经过任何域名/反代，纯内网用IP访问）：什么都不需要配置，前端会自动识别访问者当前用的IP，拼上 `:9998` 去连 WebSocket 服务，跳过本步骤直接进入第4步。

**用了固定域名 + 反向代理 / Cloudflare Tunnel 场景**（比如你现在用cloudflared把 `box.dsqqlb.top` 指到 Mac mini）：必须配置，见下面的专门章节。

### 3.1 Cloudflare Tunnel 部署（当前采用的方案）

**问题背景**：Cloudflare Tunnel 的 ingress 规则是"一个 hostname 对应一个源端口"。本项目跑了两个独立服务——nginx静态站点（9999端口）和WebSocket服务（9998端口）——如果直接暴露两个端口，隧道没法同时给两者都配规则（除非你专门为WebSocket再申请一个子域名）。

**解决方式**：nginx 内部做"路径分流"，把 `/ws` 开头的请求转发给WebSocket容器，`/ws` 之外的请求走静态站点。这样公网只需要一个 `box.dsqqlb.top` 对应 nginx 的9999端口，WebSocket 走同一个域名的 `/ws` 路径，不需要额外申请子域名或改隧道配置。这个反代规则已经写在 `nginx.conf` 里了，你不需要手动改。

#### 步骤

1. 在你的 `~/.cloudflared/config.yml` 里新增一条 ingress 规则，把 `box.dsqqlb.top` 指向 Mac mini 上 nginx 的9999端口（**不需要**单独给WebSocket配规则）：

```yaml
ingress:
  # ...你现有的其他规则保持不动...

  - hostname: box.dsqqlb.top
    service: http://127.0.0.1:9999

  - service: http_status:404   # 这条兜底规则必须放在最后
```

> 注意：新增的 `- hostname:` 规则要放在最后那条 `- service: http_status:404` **之前**，ingress 规则是按顺序匹配的。

2. 重启隧道使配置生效：

```bash
pm2 restart cf-tunnel
```

3. 在项目根目录配置 `.env`，开启WebSocket的"路径反代模式"：

```bash
cd ~/BOX
cp .env.example .env
```

确认 `.env` 里有这一行（`.env.example` 里默认已经是 `true`）：
```bash
NEXT_PUBLIC_WS_PATH_MODE=true
```

> 这个值会在**构建时**被打进静态文件里（决定前端连 `wss://box.dsqqlb.top/ws` 还是直连9998端口），改了之后必须重新 `docker compose up --build` 才生效。

4. 构建并启动（见下面第4步），然后用 `https://box.dsqqlb.top` 访问即可，WebSocket会自动走 `wss://box.dsqqlb.top/ws`。

#### 原理说明（可跳过）

- 浏览器加载页面时用的是 `https://box.dsqqlb.top`，`getWsUrl()`（`lib/useWebSocket.ts`）检测到 `NEXT_PUBLIC_WS_PATH_MODE=true` 后，会返回 `wss://box.dsqqlb.top/ws`，而不是 `wss://box.dsqqlb.top:9998`
- 这个 `wss://.../ws` 请求先到 Cloudflare 边缘节点，再通过隧道转发到 Mac mini 的 9999 端口（nginx）
- nginx 匹配到 `location /ws` 规则，识别出这是WebSocket升级请求（`Upgrade: websocket` 头），反向代理给容器内部的 `ws-server:9998`
- HTTP接口（`/enemies`、`/player-images`）走同样的路径，因为它们和WebSocket复用同一个Node进程/端口

### 3.2 局域网直连场景的固定域名配置（非Tunnel场景）

如果你用的不是Cloudflare Tunnel，而是别的反向代理（比如直接用nginx/Caddy转发到9999和9998两个端口，各自有独立的公网入口），可以直接用完全自定义地址：

```bash
NEXT_PUBLIC_WS_URL=wss://ws.yourdomain.com
```

这种情况下不需要设置 `NEXT_PUBLIC_WS_PATH_MODE`。

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

- 公网（配置了Cloudflare Tunnel）：`https://box.dsqqlb.top`
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

### Cloudflare Tunnel下WebSocket连不上（公网访问正常但断线/无法连接房间）

按顺序排查，每一步找到问题就停下来修，不用往后走。

**排查1：页面本身能不能打开**

```bash
curl -I https://box.dsqqlb.top
```
如果这一步就失败（超时/连接拒绝/502），说明问题出在Tunnel层，不是WebSocket的问题，先看下面的"域名完全打不开"章节。如果返回 `HTTP/2 200`，继续下一步。

**排查2：浏览器实际连的是哪个WebSocket地址**

打开浏览器devtools（F12）→ Network 面板 → 筛选 `WS`，点开先攻追踪器页面，看请求地址：

- 显示 `wss://box.dsqqlb.top/ws` → 地址是对的，问题在下游（继续排查3、4）
- 显示 `wss://box.dsqqlb.top:9998` → 说明构建时 `NEXT_PUBLIC_WS_PATH_MODE` 没生效，回到第4、5步重新配置`.env`并 `docker compose up --build -d`（注意必须带 `--build`，否则改了 `.env` 也不会重新打包进静态文件）
- 完全没有WS请求出现 → 检查是不是先攻追踪器页面的"连接房间"操作还没触发，或者JS报错导致连接逻辑没执行（看Console面板有没有红色报错）

**排查3：容器内部这条链路是否本身就是通的（排除Tunnel/DNS因素）**

```bash
# 3a. web容器能不能连到ws-server容器（Docker内部网络）
docker compose exec web wget -qO- http://ws-server:9998/enemies
# 期望：输出一段JSON数组（怪物列表），哪怕是空数组 [] 也算正常
# 如果报 "Connection refused" / "bad address" → ws-server容器本身没起来或者网络配置有问题，看下面"容器起不来"

# 3b. nginx的/ws反代规则本身有没有生效（在Mac mini本机测，不经过Tunnel）
curl -I http://127.0.0.1:9999/ws/enemies
# 期望：HTTP 200，Content-Type是json
# 如果404 → nginx.conf里的 location /ws 规则没有生效，确认镜像是用最新nginx.conf构建的：
#   docker compose exec web cat /etc/nginx/conf.d/default.conf | grep -A3 "location /ws"
#   如果这里看不到/ws相关内容，说明用的是旧镜像，重新 docker compose up --build -d
```

**排查4：Tunnel有没有把请求正确转发到9999端口**

```bash
# 确认cloudflared配置文件里box.dsqqlb.top这条规则指向的端口
grep -A1 "box.dsqqlb.top" ~/.cloudflared/config.yml
# 期望输出: service: http://127.0.0.1:9999

# 确认这条规则的位置在兜底的404规则之前（ingress按顺序匹配，位置错了会被吞掉）
cat ~/.cloudflared/config.yml
# 人工确认: box.dsqqlb.top这一条排在 "- service: http_status:404" 上面

# 确认隧道进程本身在跑，而且加载的是最新配置（改配置后必须重启才生效）
pm2 list
pm2 logs cf-tunnel --lines 50
```

**排查5：WebSocket握手是否被Cloudflare或nginx中途掐断（长连接超时）**

如果连接能建立但几十秒后自动断开，通常是超时配置问题：
```bash
# 确认nginx.conf里/ws这段有设置较长的超时（当前配置是3600s，一般够用）
docker compose exec web cat /etc/nginx/conf.d/default.conf | grep -A2 "proxy_read_timeout\|proxy_send_timeout"
```
Cloudflare Tunnel本身对WebSocket连接时长没有强制限制，如果频繁断线，优先怀疑是nginx超时或者Mac mini网络本身不稳定（进程休眠、Wi-Fi断线等）。

### 域名完全打不开（`curl -I https://box.dsqqlb.top` 就失败）

```bash
# 1. 确认容器在跑
docker compose ps

# 2. 确认9999端口本机能访问（排除Tunnel问题，缩小范围）
curl -I http://127.0.0.1:9999

# 3. 确认隧道进程状态
pm2 list
pm2 logs cf-tunnel --lines 50

# 4. 确认DNS记录：box.dsqqlb.top 应该是一条指向Cloudflare的CNAME，
#    这个通常在创建tunnel时应该已经自动配置，如果是新加的hostname、
#    第一次用可能需要去Cloudflare Dashboard的DNS设置里确认这条记录存在
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
1. 用 Cloudflare Tunnel 之类的方案接入 HTTPS/WSS，不要直接裸奔 HTTP/WS（当前 `box.dsqqlb.top` 已经是这种方式，Cloudflare边缘节点负责HTTPS终结，隧道到Mac mini内部走的是明文HTTP，这个是Tunnel的标准做法，是安全的）
2. GitHub Webhook 一定要设置 `WEBHOOK_SECRET`，否则任何人都能触发部署
3. 给房间号/遥控器加基础的身份校验（当前版本没有做鉴权，房间号即权限）
4. 限制房间数量和连接数，防止被刷爆内存
