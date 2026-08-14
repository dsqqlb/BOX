# 认证与授权

BOX 默认拒绝未登录访问。除 `/login` 与登录接口外，页面、业务 API、图片资源和先攻追踪器 WebSocket 都需要有效会话；工具访问还会检查账户权限。

## 初始化

1. 从 `.env.example` 创建 `.env.local`。
2. 设置至少 32 字节的随机 `BOX_SESSION_SECRET`。例如在 PowerShell 中：

   ```powershell
   $bytes = New-Object byte[] 48
   [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   [Convert]::ToBase64String($bytes)
   ```

3. 从 `data/auth-users.example.json` 创建 `data/auth-users.json`。
4. 为每个账户运行：

   ```powershell
   node server/create-password-hash.js
   ```

   将输出的完整 `scrypt$...` 字符串填入该账户的 `passwordHash`。
5. 本地 HTTP 开发设定 `BOX_COOKIE_SECURE=false`；通过 HTTPS 访问时设定为 `true`。

`.env.local` 和 `data/auth-users.json` 均为私密运行配置，不能提交到 Git。

## 账户文件

文件格式如下：

```json
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "scrypt$...",
      "permissions": ["*"]
    },
    {
      "username": "player",
      "passwordHash": "scrypt$...",
      "permissions": ["tarot-reading", "initiative-tracker"]
    }
  ]
}
```

用户名只能使用字母、数字、`.`、`_`、`-`，长度为 2 至 64 个字符。账户必须有有效的 scrypt 密码哈希和至少一项权限；示例文件中的空哈希不能用于启动服务。

## 权限

可用权限 slug：

- `claude-code-guide`
- `dnd-translator`
- `initiative-tracker`
- `initiative-tracker/display`
- `json-visualizer`
- `tarot-reading`
- `savings-tracker`
- `css-cascade`

`"*"` 授予所有工具权限。父级 `initiative-tracker` 同时授予 `/tools/initiative-tracker/display`；单独授予 `initiative-tracker/display` 时仅能访问主屏。首页能否看到卡片不是安全边界，服务端会对页面、API、图片和 `/ws` 再次检查权限。

## 会话与安全行为

- 登录成功后服务端签发 `HttpOnly`、`SameSite=Strict` 的 `box_session` Cookie；默认有效期为 12 小时，可用 `BOX_SESSION_TTL_SECONDS` 调整。
- HTTPS 生产环境默认使用 `Secure` Cookie。若本地 HTTP 未设为 `false`，浏览器不会发送 Cookie。
- 连续登录失败 5 次后，同一客户端 IP 会在 15 分钟窗口内被临时限制；服务重启会清空该内存中的计数。
- 服务会在请求时重新读取账户文件。删除账户或移除权限后，该账户已有会话也会失效或被拒绝相应工具。

修改账户文件后无需写入密码明文；生成新的 hash 后替换原值即可。
