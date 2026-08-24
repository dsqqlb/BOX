# DND 人物卡

路径：`/tools/dnd-character`
所需权限：`dnd-character`

DND 人物卡在浏览器中提供角色、装备、法术、状态和日志等交互编辑功能。

## 保存方式

- 浏览器仍使用 `dnd_` 前缀的 localStorage 作为即时缓存和离线回退。
- 每次人物卡数据变更后，前端会防抖发送整份快照到受保护的 `/api/dnd/save`。
- 服务端将快照按登录账户保存到 `data/box.sqlite` 的 SQLite 数据库；新账户第一次编辑并保存时会创建数据库记录，**不会生成** `data/dnd/saves/<用户名>.json`。
- 打开人物卡时，已登录账户的服务器快照会优先恢复到当前浏览器；没有服务器快照时保留本机缓存，直到下一次编辑自动上传。

## 维护与迁移

部署环境需要让服务账户读写 `data/box.sqlite`，并将该文件纳入定期备份。若有旧版 `data/dnd/saves/*.json`，在停服维护期间运行：

```powershell
npm run db:migrate-runtime-json
```

脚本会先将旧文件复制到 `data/backups/`，只导入与现有 SQLite 账户同名且值均为字符串的快照；源 JSON 不会自动删除。
