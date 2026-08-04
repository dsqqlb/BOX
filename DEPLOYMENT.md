# DND先攻追踪器 - 部署指南

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

如果需要单独启动：

**只启动前端：**
```bash
npm run dev
```

**只启动WebSocket服务器：**
```bash
npm run ws-server
```

## 使用方法

### 主屏幕（服务器）
1. 打开浏览器访问：`http://localhost:9999/tools/initiative-tracker/display`
2. 会自动生成一个6位数字房间号
3. 把这个房间号分享给玩家

### 遥控器（客户端）
1. 打开浏览器访问：`http://localhost:9999/tools/initiative-tracker`
2. 输入主屏幕显示的6位房间号
3. 点击"连接房间"
4. 添加角色到备选池
5. 拖拽角色到战斗区

## Mac Mini 部署（内网穿透）

### 1. 准备工作

在Mac mini上安装Node.js（如果还没有）：
```bash
# 使用Homebrew安装
brew install node
```

### 2. 克隆/上传项目到Mac mini

```bash
# 通过git克隆
git clone <你的仓库地址>
cd BOX

# 或者通过scp上传整个项目
scp -r D:\dsqqjy\BOX username@macmini-ip:/path/to/destination
```

### 3. 安装依赖并构建

```bash
npm install
npm run build
```

### 4. 配置生产环境

编辑 `.env.local` 文件：
```bash
# 修改为你的公网地址（内网穿透后的地址）
NEXT_PUBLIC_WS_URL=ws://your-domain.com:9998
```

### 5. 内网穿透配置

推荐使用 **frp** 或 **ngrok**：

#### 使用 frp

**在Mac mini上（frpc.ini）：**
```ini
[common]
server_addr = 你的云服务器IP
server_port = 7000

[web]
type = http
local_port = 9999
custom_domains = your-domain.com

[websocket]
type = tcp
local_ip = 127.0.0.1
local_port = 9998
remote_port = 9998
```

启动frp客户端：
```bash
./frpc -c frpc.ini
```

#### 使用 ngrok

```bash
# 启动HTTP隧道（Next.js）
ngrok http 9999

# 启动TCP隧道（WebSocket）- 需要在另一个终端
ngrok tcp 9998
```

### 6. 启动生产服务

**方式1：使用PM2（推荐）**

安装PM2：
```bash
npm install -g pm2
```

创建 `ecosystem.config.js`：
```javascript
module.exports = {
  apps: [
    {
      name: 'dnd-frontend',
      script: 'npm',
      args: 'start',
      env: {
        PORT: 9999
      }
    },
    {
      name: 'dnd-websocket',
      script: 'server/websocket-server.js',
      env: {
        WS_PORT: 9998
      }
    }
  ]
};
```

启动：
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # 设置开机自启
```

**方式2：使用screen（简单）**

```bash
# 启动前端
screen -S dnd-frontend
npm start
# 按 Ctrl+A 然后 D 退出screen

# 启动WebSocket
screen -S dnd-websocket
npm run ws-server
# 按 Ctrl+A 然后 D 退出screen

# 查看运行中的screen
screen -ls

# 重新连接到screen
screen -r dnd-frontend
screen -r dnd-websocket
```

## 测试跨设备连接

1. 确保Mac mini上的服务已启动
2. 确保内网穿透已配置
3. 在Mac mini上打开主屏幕：`http://localhost:9999/tools/initiative-tracker/display`
4. 在其他设备（手机/平板/电脑）上打开遥控器：`http://your-domain.com/tools/initiative-tracker`
5. 输入房间号连接

## 故障排查

### WebSocket连接失败

1. 检查WebSocket服务器是否运行：
```bash
# Mac mini上
lsof -i :9998
# 或
netstat -an | grep 9998
```

2. 检查防火墙设置：
```bash
# 确保9998端口开放
sudo ufw allow 9998
```

3. 检查.env.local配置是否正确

### 房间连接问题

1. 查看浏览器Console（F12）是否有错误
2. 查看WebSocket服务器日志
3. 确认房间号输入正确

### 备选池丢失

备选池存储在本地localStorage，只有在：
- 清除浏览器数据
- 手动删除角色
时才会丢失。

## 端口说明

- **9999**: Next.js前端服务
- **9998**: WebSocket服务器

如需修改端口，请同时修改：
1. `package.json` 中的启动命令
2. `.env.local` 中的 `NEXT_PUBLIC_WS_URL`
3. `server/websocket-server.js` 中的 `PORT`

## 安全建议

生产环境建议：
1. 使用HTTPS和WSS（加密WebSocket）
2. 添加身份验证
3. 限制房间数量和连接数
4. 设置房间过期时间
5. 添加速率限制

## 监控

查看PM2日志：
```bash
pm2 logs dnd-frontend
pm2 logs dnd-websocket
```

查看实时状态：
```bash
pm2 monit
```
