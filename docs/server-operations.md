# 我的 BOX 服务器操作手册

这是一份可迁移的个人操作说明：换电脑时配置 SSH；换服务器时更新一份“服务器档案”和本机 SSH 别名。后面的日常命令不需要随 IP 变化而改动。

> 本文不保存服务器密码、私钥、`.env.local` 内容或数据库内容。它们不应提交到 Git，也不要发进聊天或截图。

---

## 1. 服务器档案：换服务器时先更新这里

每次换服务器，只记录和确认下面这些信息。尖括号表示要替换成新服务器实际值。

| 项目 | 当前/默认值 | 换服务器时要确认 |
| --- | --- | --- |
| SSH 别名 | `box-prod` | 可不变，推荐一直使用这个名字 |
| 服务器地址 | `<SERVER_HOST>` | 新公网 IP 或域名，例如 `203.0.113.10` |
| SSH 用户 | `ubuntu` | 新服务器的登录用户 |
| SSH 端口 | `22` | 若服务器改了 SSH 端口则更新 |
| 项目目录 | `/home/ubuntu/BOX` | 新服务器实际项目路径 |
| BOX 服务 | `box.service` | `systemctl` 中的服务名称 |
| BOX 本机端口 | `9999` | Node 应用监听端口 |
| 数据目录 | `/home/ubuntu/BOX/data/` | SQLite 和用户上传数据所在路径 |
| 私密配置 | `/home/ubuntu/BOX/.env.local` | 会话密钥与运行配置所在路径 |

**换服务器后的最小原则**：保留 SSH 别名 `box-prod`，只更新本机 `~/.ssh/config` 中的 `HostName`、`User` 和需要时的 `Port`。后文所有 `ssh box-prod ...` 命令都继续可用。

`data/` 和 `.env.local` 非常重要：更新项目、构建页面时都不能删除或覆盖它们。

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

1. 在旧服务器备份 `.env.local` 和 `data/`；
2. 在新服务器安装 Ubuntu、Node.js、Git，并放好 BOX 项目；
3. 把备份中的 `.env.local` 和 `data/` 恢复到新项目目录；
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

无论项目代码来自 Git、压缩包还是手动上传，构建流程都是：

```powershell
ssh box-prod "cd /home/ubuntu/BOX && npm install && npm run db:generate && npm run db:migrate && npm run build && sudo systemctl restart box && systemctl status box --no-pager"
```

如果新服务器项目目录不是 `/home/ubuntu/BOX`，把命令中的路径替换成服务器档案里的项目目录。

这会：安装依赖 → 生成 Prisma 客户端 → 应用数据库迁移 → 构建页面 → 重启服务。

### 正常升级时绝对不要运行

```bash
npm run db:setup
npm run db:import-json
rm -rf data/
git clean -fd
git reset --hard
```

它们可能清空账户、权限、牌组或其他用户数据。

---

## 9. 手动备份

更新代码、迁移数据库、修改服务器前，建议先备份。下方命令假设项目目录是 `/home/ubuntu/BOX`；换路径时同步修改。

```powershell
ssh box-prod 'set -e; sudo systemctl stop box; mkdir -p "$HOME/box-backups"; tar -czf "$HOME/box-backups/box-$(date +%Y%m%d-%H%M%S).tar.gz" /home/ubuntu/BOX/.env.local /home/ubuntu/BOX/data; sudo systemctl start box; ls -lh "$HOME/box-backups" | tail'
```

查看备份：

```powershell
ssh box-prod "ls -lh ~/box-backups/"
```

恢复备份是高风险操作：先停止服务、确认备份日期，再恢复 `.env.local` 和整个 `data/`；恢复后运行 `npm run db:generate`、`npm run db:migrate`，最后启动服务。

---

## 10. 简短安全事项

1. 如果服务器密码曾出现在聊天、截图或其他不安全位置，应立即更换。
2. 使用 SSH 密钥，私钥 `id_ed25519` 永远不要分享、上传或提交。
3. 长期应该用域名 + HTTPS 反向代理，BOX 只监听本机 `127.0.0.1:9999`；不要长期裸露公网 HTTP 的 `9999` 端口。
4. 确认至少两台电脑都能用 SSH 密钥登录后，再考虑关闭密码 SSH 登录和 root SSH 登录；操作前保留一个已登录的 SSH 窗口，防止把自己锁在服务器外。
5. `.env.local`、`data/box.sqlite`、整个 `data/` 和备份压缩包都属于敏感数据，应定期异地备份。
