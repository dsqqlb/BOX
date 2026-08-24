# 认证、权限与 SQLite 持久化

BOX 默认拒绝未登录访问。除 `/login` 与登录接口外，页面、业务 API、图片资源和先攻追踪器 WebSocket 都需要有效会话；工具访问还会检查账户权限。

## 首次初始化

1. 从 `.env.example` 创建 `.env.local`，设置至少 32 字节的随机 `BOX_SESSION_SECRET`。
2. 从 `data/auth-users.example.json` 创建 `data/auth-users.json`，用 `node server/create-password-hash.js` 为每个账户生成 `scrypt$...` 密码哈希，并填写权限。
3. 执行：

   ```powershell
   npm run db:setup
   ```

   该命令会生成 Prisma 客户端、应用 `prisma/migrations/` 内的 SQLite 结构，并导入账户、EDH 牌组、DND 人物卡快照和旧省钱记录。每一种 JSON 导入都会在 `data/backups/` 创建副本；源 JSON 不会被删除。
4. 本地 HTTP 开发设定 `BOX_COOKIE_SECURE=false`；通过 HTTPS 访问时设定为 `true`。

`.env.local`、`data/auth-users.json`、`data/box.sqlite` 和 `data/backups/` 均为私密运行数据，不能提交到 Git。运行服务所用账户必须能读写 `data/`。

## 数据库运行与备份

- 默认数据库路径是 `data/box.sqlite`；可通过 `DATABASE_URL` 覆盖，例如 `file:/srv/box-data/box.sqlite`。
- 日常升级部署执行 `npm run db:generate` 和 `npm run db:migrate`，再启动服务；它们不会重新导入 JSON 或清空现有数据。
- `npm run db:import-json` 是一次性迁移工具，会先备份再**替换** SQLite 中的用户、权限和 EDH 牌组数据，仅应在停服维护时使用。
- `npm run db:migrate-runtime-json` 是 DND 和省钱 JSON 的增量导入工具：会备份源文件、按账户验证并 upsert，不清空其他 SQLite 数据。
- 定期备份 `data/box.sqlite`、`.env.local` 和 EDH 卡牌索引；恢复时应先停服务，再替换数据库文件。运行时不会创建 `data/savings.json` 或 `data/dnd/saves/<用户名>.json`。

## 初始账户导入文件

`data/auth-users.json` 的格式如下，仅用于首次初始化或计划中的重导入：

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

用户名只能使用字母、数字、`.`、`_`、`-`，长度为 2 至 64 个字符。账户必须有有效的 scrypt 密码哈希和至少一项权限。运行时认证直接查询 SQLite；修改 JSON 不会实时改变正在运行的账户。

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
- `edh-builder`
- `dnd-character`

`"*"` 授予所有工具权限。父级 `initiative-tracker` 同时授予 `/tools/initiative-tracker/display`；单独授予 `initiative-tracker/display` 时仅能访问主屏。

## 会话与安全行为

- 登录成功后服务端签发 `HttpOnly`、`SameSite=Strict` 的 `box_session` Cookie；默认有效期为 12 小时，可用 `BOX_SESSION_TTL_SECONDS` 调整。
- 会话内容和 HMAC 签名格式保持不变；成功导入原账户后，未过期的既有会话可以继续使用。
- HTTPS 生产环境默认使用 `Secure` Cookie。若本地 HTTP 未设为 `false`，浏览器不会发送 Cookie。
- 连续登录失败 5 次后，同一客户端 IP 会在 15 分钟窗口内被临时限制；服务重启会清空该内存中的计数。
- 删除 SQLite 中的账户或移除权限后，该账户的既有会话会在下一次请求时失效或被拒绝对应工具。
