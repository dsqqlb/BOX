# 快速启动指南

## 开发环境设置

### 1. 安装依赖

```bash
# 使用 npm
npm install

# 或使用 pnpm (推荐，更快)
pnpm install

# 或使用 yarn
yarn install
```

### 2. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 3. 构建生产版本

```bash
npm run build
```

静态文件会输出到 `out/` 目录。

## Mac mini 首次部署

### 1. 克隆项目

```bash
cd ~
git clone https://github.com/你的用户名/BOX.git
cd BOX
```

### 2. 安装依赖并构建

```bash
npm install
npm run build
```

### 3. 配置 Nginx

创建配置文件 `/etc/nginx/sites-available/box`:

```nginx
server {
    listen 80;
    server_name box.local;
    
    root /Users/你的用户名/BOX/out;
    index index.html;
    
    location / {
        try_files $uri $uri.html $uri/ =404;
    }
}
```

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/box /etc/nginx/sites-enabled/
sudo nginx -t
sudo nginx -s reload
```

### 4. 或使用部署脚本

```bash
chmod +x mac-mini/deploy.sh
./mac-mini/deploy.sh
```

## 后续更新

```bash
cd ~/BOX
./mac-mini/deploy.sh
```

## 故障排查

### 构建失败
- 检查 Node.js 版本 >= 18
- 删除 `node_modules` 和 `package-lock.json`，重新安装

### 页面 404
- 确认 Nginx 配置正确
- 检查 `out/` 目录是否存在
- 查看 Nginx 错误日志

### 样式丢失
- 确认 `next.config.ts` 中 `output: 'export'` 已设置
- 确认 `images.unoptimized: true` 已设置
