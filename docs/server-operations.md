# 我的 BOX 服务器操作手册

这是一份可迁移的个人操作说明：换电脑时配置 SSH；换服务器时更新一份“服务器档案”和本机 SSH 别名。后面的日常命令不需要随 IP 变化而改动。

> 本文不保存服务器密码、私钥、`resources/.env.local` 内容或数据库内容。它们不应提交到 Git，也不要发进聊天或截图。

---

## 1. 服务器档案：换服务器时先更新这里

每次换服务器，只记录和确认下面这些信息。尖括号表示要替换成新服务器实际值。

| 项目 | 当前值 | 换服务器时要确认 |
| --- | --- | --- |
| SSH 别名 | `box-prod` | 可不变，推荐一直使用这个名字 |
| 服务器地址 | `43.142.93.246` | 新公网 IP 或域名 |
| SSH 用户 | `ubuntu` | 新服务器的登录用户 |
| SSH 端口 | `22` | 若服务器改了 SSH 端口则更新 |
| SSH 私钥 | 本机 `~/.ssh/box-prod.pem`（仓库 `密钥/test.pem` 的副本） | 新服务器的密钥文件 |
| 项目目录 | `/home/ubuntu/BOX` | 新服务器实际项目路径 |
| BOX 服务 | `box.service`（`WorkingDirectory=/home/ubuntu/BOX`） | `systemctl` 中的服务名称 |
| BOX 本机端口 | `9999`，只监听 `127.0.0.1` | Node 应用监听端口 |
| 反向代理 | nginx 反代 `127.0.0.1:9999`，证书由 certbot 自动续期 | 新服务器的代理与证书 |
| 主站入口 | `https://www.dsqqlb.top` | 新域名 |
| 静态站点域名 | `https://box.dsqqlb.top` | 新域名 |
| 数据目录 | `/home/ubuntu/BOX/resources/data/` | SQLite 和用户上传数据所在路径 |
| 私密配置 | `/home/ubuntu/BOX/resources/.env.local` | 会话密钥与运行配置所在路径 |
| 部署方式 | 直接把项目目录复制到服务器，**没有**版本目录与共享软链 | 保持同一种部署方式最省事 |

**换服务器后的最小原则**：保留 SSH 别名 `box-prod`，只更新本机 `~/.ssh/config` 中的 `HostName`、`User` 和需要时的 `Port`。后文所有 `ssh box-prod ...` 命令都继续可用。

### 1.1 域名与静态站点挂载（备案已完成）

| 用途 | 域名 | 服务器 `resources/.env.local` 里的变量 |
| --- | --- | --- |
| BOX 主站（登录、工具、WebSocket） | `www.dsqqlb.top` | `BOX_PRIMARY_HOST=www.dsqqlb.top` |
| 静态站点挂载（HTML/CSS/JS 网页） | `box.dsqqlb.top` | `BOX_SITES_HOST=box.dsqqlb.top` |

- 两个域名的 A 记录都指向服务器公网 IP，nginx 反代到 `127.0.0.1:9999` 并保留原始 `Host`；同一个进程按 `Host` 分流；
- `box.dsqqlb.top` 是**站点域名**，只提供 `http://box.dsqqlb.top/<站点名>/`，根路径固定 404，不再是 BOX 入口；两个变量绝不能填成同一个域名；
- 改完这两个变量要重启服务：`sudo systemctl restart box`。启动日志会打印 `主站域名` 与 `站点域名`，写重了会直接给 ⚠️ 警告；
- nginx 配置、验证命令与 HTTPS 步骤见[部署指南](./deployment.md)第 10.1 节。

`resources/` 是唯一的资源类目录：`resources/content/`（工具定义、内置卡牌与页面资料）随代码进入 Git 与部署目录；`resources/public/`（含 `image/`）是对外静态资源；`resources/.env.local` 与 `resources/data/`（SQLite、账户文件、上传、缓存、备份和用户站点）是私密数据，整体不进入 Git。

---

## 2. 新 Windows 电脑：生成 SSH 密钥

每台新电脑都单独生成一对密钥。打开 **PowerShell**：

```powershell
ssh-keygen -t ed25519 -a 100 -C "box-$(hostname)"
```

出现提示时：

1. `Enter file in which to save the key`：直接按回车，使用默认位置。
2. `Enter passphrase`：建议设置一个本机口令；即使私钥文件被复制走，也不能直接使用。
3. 再输入一次同样的口令。

默认会生成：

```text
C:\Users\你的Windows用户名\.ssh\id_ed25519      # 私钥，绝不能分享
C:\Users\你的Windows用户名\.ssh\id_ed25519.pub  # 公钥，可以放到服务器
```

确认文件存在：

```powershell
Get-ChildItem "$env:USERPROFILE\.ssh\id_ed25519*"
```

---

## 3. 先配置 SSH 别名

先让这台新电脑知道 `box-prod` 指向哪台服务器。

### 3.1 创建或打开配置文件

```powershell
notepad "$env:USERPROFILE\.ssh\config"
```

没有文件时选择创建即可。

### 3.2 粘贴并填写服务器档案中的值

```sshconfig
Host box-prod
  HostName <SERVER_HOST>
  User ubuntu
  Port 22
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

把 `<SERVER_HOST>` 换成当前服务器 IP 或域名。例如新服务器地址是 `203.0.113.10`，就写：

```sshconfig
HostName 203.0.113.10
```

以后所有服务器命令都使用：

```powershell
ssh box-prod
```

退出服务器交互终端：

```bash
exit
```

---

## 4. 把新电脑的公钥加入服务器

这是每台新电脑只需要做一次的步骤。先确认 `box-prod` 的地址、用户和端口已经填写正确。

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh box-prod "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

此时 PowerShell 会要求输入服务器账户密码：

- 输入时不会显示任何字符，这是正常的；
- 密码只在本机终端中输入，不要复制到文档、聊天或代码里；
- 如果服务器已经禁用了密码 SSH 登录，需要从已有可登录的电脑执行添加公钥操作。

验证密钥登录：

```powershell
ssh -o BatchMode=yes box-prod "whoami; hostname; uptime"
```

成功后，后续通常无需服务器密码；若设置过私钥口令，只会要求输入该**本机私钥口令**。

---

## 5. 换服务器时怎么做

换服务器不是只换 IP，而是一次迁移。建议按顺序进行：

1. 在旧服务器备份 `resources/.env.local`、`resources/data/` 和 `resources/public/image/`；
2. 在新服务器安装 Ubuntu、Node.js、Git，并放好 BOX 项目；
3. 把备份中的 `resources/.env.local`、`resources/data/` 和 `resources/public/image/` 恢复到新项目目录；
4. 在新服务器执行：`npm install`、`npm run db:generate`、`npm run db:migrate`、`npm run build`；
5. 配置并启动 `box.service`；
6. 先用新服务器的地址测试登录和数据是否完整；
7. 在新电脑的 `~/.ssh/config` 中，把 `box-prod` 的 `HostName` 改成新地址；
8. 测试 `ssh -o BatchMode=yes box-prod "whoami; hostname"`；
9. 确认新服务器完全正常后，最后才关闭旧服务器。

### 换服务器后的快速核对

```powershell
ssh box-prod "whoami; hostname; node -v; npm -v; systemctl status box --no-pager; curl -I http://127.0.0.1:9999/; df -h /"
```

正常时 `systemctl` 应显示 `active (running)`；本机 `curl` 返回 `303` 也正常，表示未登录时跳转到登录页。

---

## 6. 日常查看服务器状态

### 查看 BOX 是否正常运行

```powershell
ssh box-prod "systemctl status box --no-pager"
```

正常状态应有：

```text
Active: active (running)
```

### 查看最近日志

```powershell
ssh box-prod "journalctl -u box -n 100 --no-pager"
```

### 实时查看日志

```powershell
ssh box-prod "journalctl -u box -f"
```

按 `Ctrl+C` 退出实时日志；不会停止 BOX 服务。

### 检查网页服务和服务器资源

```powershell
ssh box-prod "curl -I http://127.0.0.1:9999/; echo '---'; uptime; free -h; df -h /"
```

### 看端口是否在监听

```powershell
ssh box-prod "ss -ltn | grep -E ':(22|80|443|9999)\\b'"
```

---

## 7. 启动、停止与重启 BOX

> 重启会让正在使用网站的人短暂断开。先确认没有重要上传、对局或操作。

```powershell
# 查看状态
ssh box-prod "sudo systemctl status box --no-pager"

# 重启（最常用）
ssh box-prod "sudo systemctl restart box"

# 启动
ssh box-prod "sudo systemctl start box"

# 停止
ssh box-prod "sudo systemctl stop box"
```

重启后验证：

```powershell
ssh box-prod "systemctl status box --no-pager; curl -I http://127.0.0.1:9999/"
```

---

## 8. 部署新版本前必须知道的事

日常升级用 `ops/release/` 下的两个脚本（见第 11 节），它们会依次完成下面这些步骤。手动把新代码放到服务器上时，构建流程是：

```powershell
ssh box-prod "cd /home/ubuntu/BOX && npm run ci:code && npm run db:generate && npm run db:migrate && npm run build && sudo systemctl restart box && systemctl status box --no-pager"
```

如果新服务器项目目录不是 `/home/ubuntu/BOX`，把命令中的路径替换成服务器档案里的项目目录。

这会：安装依赖 → 生成 Prisma 客户端 → 应用数据库迁移 → 构建页面 → 重启服务。

### 正常升级时绝对不要运行

```bash
npm run db:setup
npm run db:import-json
rm -rf resources/data/
git clean -fd
git reset --hard
```

它们可能清空账户、权限、牌组或其他用户数据。

---

## 9. 手动备份

更新代码、迁移数据库、修改服务器前，建议先备份。下方命令假设项目目录是 `/home/ubuntu/BOX`；换路径时同步修改。

```powershell
ssh box-prod 'set -e; sudo systemctl stop box; mkdir -p "$HOME/box-backups"; tar -czf "$HOME/box-backups/box-$(date +%Y%m%d-%H%M%S).tar.gz" -C /home/ubuntu/BOX resources/.env.local resources/data; sudo systemctl start box; ls -lh "$HOME/box-backups" | tail'
```

查看备份：

```powershell
ssh box-prod "ls -lh ~/box-backups/"
```

恢复备份是高风险操作：先停止服务、确认备份日期，再恢复 `resources/.env.local` 和整个 `resources/data/`；恢复后运行 `npm run db:generate`、`npm run db:migrate`，最后启动服务。

---

## 10. 简短安全事项

1. 如果服务器密码曾出现在聊天、截图或其他不安全位置，应立即更换。
2. 使用 SSH 密钥，私钥 `id_ed25519` 永远不要分享、上传或提交。
3. 长期应该用域名 + HTTPS 反向代理，BOX 只监听本机 `127.0.0.1:9999`；不要长期裸露公网 HTTP 的 `9999` 端口。
4. 确认至少两台电脑都能用 SSH 密钥登录后，再考虑关闭密码 SSH 登录和 root SSH 登录；操作前保留一个已登录的 SSH 窗口，防止把自己锁在服务器外。
5. `resources/.env.local`、`resources/data/box.sqlite`、整个 `resources/data/` 和备份压缩包都属于敏感数据，应定期异地备份。


---

## 11. 把项目复制到服务器（无版本目录）

服务器不需要访问 GitHub 或其他 Git 平台：本地 Git 是源码与提交历史的唯一来源，改动通过 SSH/SCP 以「整个项目目录」的形式复制过去，因此服务器完全不需要 Git 网络。

服务器上只有一个项目目录（当前是 `/home/ubuntu/BOX`），没有版本目录、没有共享软链：升级就是覆盖代码 + 重新构建 + 重启服务；`resources/.env.local`、`resources/data/`、`resources/public/image/` 与 `code/node_modules/` 不在压缩包里，因此永远不会被覆盖。

### 11.1 服务器目录结构

完成初始化后，服务器上就是标准的单项目目录结构：

```text
/home/ubuntu/
├─ BOX/                         # 唯一的项目目录，也是 systemd 的工作目录
│  ├─ code/                     # 代码与构建产物（node_modules、.next、out 都在这里）
│  ├─ resources/                # content/、public/（含 image/）；.env.local 与 data/ 是私密数据
│  ├─ docs/  ops/  package.json
│  └─ README.md
├─ box-upload/                  # 上传的 tar.gz 与 deploy-project.sh，可定期清理
└─ box-backups/                 # 每次部署前自动生成的 resources 数据备份
```

- 项目目录只有一份，没有 release 目录、没有 `current` 软链；
- systemd 的 `WorkingDirectory` 是 `/home/ubuntu/BOX`，`ExecStart` 直接用 `/usr/bin/node code/server/index.js`（不走 `npm start`，避免每次重启都触发构建）；
- nginx 反代 `127.0.0.1:9999`，证书由 certbot 自动续期（`certbot renew` 已由 systemd 定时器接管）；
- 备份只包含 `resources/.env.local` 与 `resources/data/`；`code/`、`code/node_modules/` 与图片都能重新生成，不进备份。

### 11.2 全新服务器第一次部署

1. 按[部署指南](./deployment.md)第 1–3 节装好 Node.js 并放上项目目录（`git clone`、复制或解压都行）；
2. 按第 4–6 节创建 `resources/.env.local`、`resources/data/auth-users.json`，并执行 `npm run db:setup` 初始化 SQLite；
3. 按第 9.2 节写好 `box.service` 并 `systemctl enable --now box`；
4. 图片按需同步：`.\ops\release\upload-project.ps1 -Server box-prod -IncludeImages`，或在服务器上把 `resources/public/image/` 单独 scp/解压到 `/home/ubuntu/BOX/resources/public/image/`；
5. 按第 11 节配置 nginx 与 HTTPS。

### 11.3 每次升级：本机打包上传，服务器就地覆盖

```powershell
# 本机：构建 + 打包整个项目 + 上传到 ~/box-upload/（不会动线上服务）
.\ops\release\upload-project.ps1 -Server box-prod
```

```powershell
# 服务器：覆盖代码 → 备份数据 → 装依赖 → 构建 → 结构迁移 → 重启 → 健康检查
ssh box-prod "~/box-upload/deploy-project.sh ~/box-upload/box-project-<脚本输出的文件名>"
```

常用选项：

| 选项 | 作用 |
| --- | --- |
| `--skip-install` | 跳过 `npm ci`（依赖没变时快很多） |
| `--skip-build` | 跳过 `npm run build`（用压缩包里已有的 `code/out`） |
| `--clean` | 覆盖前清空会被替换的目录（保留 `node_modules` 与 `resources/public/image`），不留旧版本残留文件 |
| `--project=<目录>` | 指定项目目录，默认 `$HOME/BOX` |
| `--no-backup` | 跳过部署前的数据备份（不建议） |

脚本会把 `resources/.env.local` 与 `resources/data/` 备份到 `~/box-backups/box-before-deploy-<时间戳>.tar.gz`；升级永远只做 `db:generate` + `db:migrate`（结构迁移），**不要**跑 `db:import-json` 或 `db:setup`。

### 11.4 回滚

没有版本目录，回滚靠「数据备份 + 在本机切回旧提交再复制一次」：

1. 数据备份在 `~/box-backups/`：`sudo systemctl stop box` 后把备份里的 `resources/.env.local`、`resources/data` 解回 `/home/ubuntu/BOX/resources/`，再启动服务；
2. 代码回退：在本机 `git checkout <旧提交>`，再执行 11.3 的两条命令。数据库 migration 是向前执行的，不会自动回退，回退代码前先确认旧代码兼容当前数据库结构。

### 11.5 发布脚本的位置

| 文件 | 作用 |
| --- | --- |
| `ops/release/upload-project.ps1` | Windows：本机构建、打包整个项目、SCP 上传压缩包与部署脚本 |
| `ops/release/deploy-project.sh` | Ubuntu：就地覆盖代码、备份数据、`npm ci`、构建、`db:migrate`、重启与健康检查 |

两个脚本都不会读取或上传私钥；压缩包里也不会出现 `resources/.env.local`、`resources/data/` 与 `resources/public/image/`（最后一项只有显式加 `-IncludeImages` 才上传）。
