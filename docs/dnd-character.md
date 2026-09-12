# DND 人物卡

路径：`/tools/dnd-character`
所需权限：`dnd-character`

DND 人物卡在浏览器中提供角色、装备、法术、状态和日志等交互编辑功能。

## 保存方式

人物卡的状态全部以 `dnd_` 前缀键存在浏览器 localStorage 里（值都是 JSON 字符串），
同时按账户同步到服务器的 SQLite。

**本地 → 服务器：字段级增量**

- 前端拦截所有 `dnd_*` 的读写落点（保存、撤销、导入备份），防抖 1.2 秒后只把
  **发生变化的键** POST 到受保护的 `/api/dnd/save`（`{ data: { key: 值 } }`）。
- 服务端按「一个账户 + 一个键 = 一行」存进 `DndSaveEntry` 表（`data/box.sqlite`），
  只更新本次提交上来的键，其它键完全不受影响；键的值为 `null` 表示删除该键。
- 因此不同设备改不同字段不会互相覆盖；上传体积只跟这次改动量相关，
  不再是每次都重传整包，也不会再撞上请求体上限。

**服务器 → 本地：三方比对**

- 本机另外记住「每个键最后一次成功推送的原样值」——localStorage 的
  `box-dnd-sync-acked`（**不**作为存档内容同步、不进备份）。
- 打开人物卡时逐键比对 本地 / 服务器 / acked：
  - 服务器变了、本地已同步 → 采纳服务器的；
  - 本地有还没推上去的改动 → 保留本地并推上去，同时把服务器那份写进
    `box-dnd-conflict` 留档，**不会静默丢弃**；
  - 本机没有这份数据（换浏览器或换访问地址）→ 采纳服务器的，完成首次灌入。
- 只有真的改动了本地才会刷新页面一次；未登录或接口不可用时静默保持本地。

浏览器仍用 `dnd_` 前缀的 localStorage 作为即时缓存与离线回退。新账户第一次
编辑并保存时就会创建数据库记录，**不会生成** `data/dnd/saves/<用户名>.json`。

## 维护与迁移

部署环境需要让服务账户读写 `data/box.sqlite`，并将该文件纳入定期备份。

升级到「字段级增量」版本需要做一次结构变更并搬运旧数据（幂等，可重复执行）：

```bash
npm run db:generate
npm run db:migrate
npm run db:migrate-dnd-save      # 把旧的整包 DndSave.dataJson 拆成一行一个 key
```

`db:migrate-dnd-save` 只搬运值是字符串的键，并**不删除**旧的 `DndSave` 行
（保留为迁移前快照，需要回滚时可用）。

若有更早的 `data/dnd/saves/*.json`，在停服维护期间运行：

```powershell
npm run db:migrate-runtime-json
```

脚本会先将旧文件复制到 `data/backups/`，只导入与现有 SQLite 账户同名且值均为字符串的快照；源 JSON 不会自动删除。

## 自动化测试

```bash
npm run smoke:dnd-merge   # 三方比对纯函数：本地/服务器/acked 的各种组合
npm run smoke:dnd-sync    # 端到端：字段级写入、null 删除、参数校验、权限、同源、5MB 上限
```
