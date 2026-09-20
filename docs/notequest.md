# NoteQuest 地牢笔记

路径：`/tools/notequest`。这是一个把单人 PNP 桌游 **NoteQuest（核心规则书）** 搬到浏览器里的模块：一个人、一支铅笔、几个 D6 掷出地牢，只是这次地图、表格与掷骰都由程序来记。需要 `notequest` 权限。

规则数据来自项目根目录 `参考文件/1.NoteQuest_cn.pdf`（原作者 Tiago Junges，中文版译者 JungleZL），是**按表格逐条录入**的，不是概括改写。

## 功能

- **掷骰建角色**：2d6 决定种族、2d6 决定职业（HP、能力、起始武器），种族/职业给的咒语按 1d6 随机抽；3d6 拼出地牢名，第三部分决定这是六类地牢中的哪一类。
- **自动地图**：开门即探索。点地图上的门掷「开门表」（1 = 陷阱、2-3 = 锁住、4-6 = 没锁）；没锁时继续掷对应列（从楼梯 / 从走廊 / 从房间）的「地牢片段表」，生成走廊、房间或楼梯，并能看到房间尺寸。
- **地牢行动**：开锁（1 火把）、破坏房门（0 火把但怪物先手）、用钥匙、安静移动（1 火把、逐怪掷 1d6）、寻找密道（1 火把）、打开宝箱（2d6，双 1 空箱 + 陷阱）、走下楼梯（第 3 层是最终房间）。
- **战斗**：先攻由「开门是否出声」决定；武器骰 + 装备加成一击一怪，怪物回合把伤害汇总后由你选择打 HP 还是某件护甲；14 种怪物词缀（石肤、自爆、无形、不死、复苏、瘫痪、剧毒、死亡之触…）全部生效。
- **资源**：火把（上限 10，进地牢消耗 1，0 火把在地牢里等于死亡，矿工例外）、背包 10 格、5 部位护甲（各自有 HP，掉光即毁）、钥匙、财宝、金币。
- **城镇**：休息（回满 HP 与咒语）、修理护甲、买火把、出售物品（魔法物品 1d6-1 金币、猫人双倍）、把财宝掷奖励表换成物品；返回地牢后每个重新进入的空房间都会再掷一次怪物表。
- **结局**：击败最终房间的 Boss 即通关（额外 2d6 宝藏）；角色死亡或主动放弃会写进墓地（原书第 24 页那张表）。若地图走到死路（再也没有门也没有楼梯），最后一个房间会自动成为最终房间。
- **3D 骰子**：复用先攻主屏那套 3D 引擎（与 EDH 记血器同一个组件 `components/dnd/DiceRoller`）。引擎是即时结算的，骰子只是把刚才那批结果按顺序回放给你看。
- **表格速查**：任意时刻都能展开六类地牢的全部表格、核心表（种族/职业/咒语/开门/战利品）与 14 条词缀说明，不必翻规则书。

## 规则数据与扩展

所有表都在 [`resources/content/notequest/`](../resources/content/notequest/)：

| 文件 | 内容 |
| --- | --- |
| `core.json` | 种族、职业、咒语、开门表、战利品、宝箱规则、共用地牢片段/密道/护甲表、14 个词缀、战斗与城镇说明、经济常量、地牢名三段表 |
| `dungeons.json` | 六类地牢（宫殿 / 地穴 / 陵墓 / 庇护所 / 神庙 / 牢狱），每类含陷阱、房间内容、怪物、奖励（财宝·奇物·魔法物品）、Boss、武器 |
| `README.md` | 扩展指南：加地牢类型 / 种族 / 职业 / 咒语 / 词缀 / 物品的方法，以及每个 `kind`、`trigger` 由 `code/lib/notequest/engine.ts` 里哪个钩子实现 |

数据是服务端与前端共用的一份（和 `content/scratch/` 一样），改完 JSON 刷新页面即生效；已有存档保存的是自己的快照，不受影响。

引擎侧只有**新机制**才需要改代码：

- `lib/notequest/engine.ts`：纯函数状态机（`createRun` / `applyAction`），RNG 可注入；
- `lib/notequest/dice.ts`：`NdM±K` 解析与「2d6 取高」这类特殊掷骰；
- `lib/notequest/map.ts`：片段图的坐标排版；
- `lib/notequest/data.ts`：规则数据访问层。

## 数据与权限

- 存档写入 SQLite 的 `NoteQuestRun`（一局一条，含完整状态快照 `stateJson` 与摘要列）与 `NoteQuestGrave`（墓地）。
- 接口：`GET/POST /api/notequest/runs`、`GET/PATCH/DELETE /api/notequest/runs/:id`、`GET /api/notequest/graves`。全部要求登录 + `notequest` 权限，写操作要求同源。
- 服务端只做形状与体积检查（快照必须带 `version` / `hero` / `dungeon.nodes`，单条不超过 400 KiB），具体字段由前端引擎负责；摘要列由服务端从快照派生，避免客户端传错。
- 每个账户最多保留 30 条存档（超出时删除最旧的已结束存档）与 200 条墓地记录；存档按账号隔离，互相看不见。
- 同一条存档变为 `dead` 时只会写一次墓地记录；删除存档不会删除墓地记录。

## 本地验证

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run smoke:notequest                       # 存档/墓地接口端到端（含权限与隔离）
npm.cmd run verify:notequest                      # 无头 Chrome 走一遍真实路径并截图
npm.cmd --prefix code install --no-save esbuild
npm.cmd run simulate:notequest -- 60              # 纯 Node 跑 60 局随机探索，校验状态不越界
```

引擎是纯函数，所以 `simulate-notequest.mjs` 能在不开浏览器的情况下跑完开门 → 房间 → 战斗 → 掉落 → 往返城镇 → 下楼梯 → Boss → 死亡/通关的完整链路；没有装 esbuild 时它会打印提示并跳过。`verify-notequest.mjs` 需要本机有 Chrome / Edge，截图写在 `ops/checks/shots/notequest.png`。

## 升级与备份

部署更新前运行：

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
```

`resources/data/box.sqlite` 是唯一需要备份的文件（存档与墓地都在里面）；规则数据在 `resources/content/notequest/`，随代码一起发布。