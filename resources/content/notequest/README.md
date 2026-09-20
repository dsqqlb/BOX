# NoteQuest 规则数据（可自由扩展）

这个目录里的 JSON 是 **服务端与前端共用的一份规则数据**（和 `content/scratch/` 的做法一致）。
引擎在 `code/lib/notequest/`：`data.ts` 负责加载与查表，`engine.ts` 负责状态机与效果钩子，`dice.ts` 负责掷骰表达式。

## 文件

| 文件 | 内容 |
| --- | --- |
| `core.json` | 种族、职业、咒语、开门表、战利品、宝箱规则、共用地牢片段/密道/护甲表、14 个怪物词缀、战斗与城镇/地牢行动说明、经济常量（`rules`） |
| `dungeons.json` | 六类地牢（宫殿 / 地穴 / 陵墓 / 庇护所 / 神庙 / 牢狱），每类含陷阱、房间内容、怪物、奖励（财宝·奇物·魔法物品）、Boss、武器 |

## 表怎么查

所有表条目都写成 `{}` 或 `{ rollMin, rollMax }`，查表函数 `pickByRoll(list, value)` 两种都认。
文本里的 `1d6`、`2d6`、`2d6×10` 等写法只用于展示；真正结算的数字放在结构化字段里（`damage`、`hp`、`count`、`countDice`、`dice`）。

## 扩展方式

1. **加一类地牢**：在 `dungeons.json` 的 `types` 里复制一整个条目，改 `id`/`name`/`intro` 与各表内容即可。
   地牢片段表、密道表、护甲表默认共用 `core.json` 里的那几张；要特化就在条目里写自己的 `segments` / `secretPassages` / `armors`。
   图标：条目里的 `icon` 对应 `code/components/notequest/Icon.tsx` 中的图标名，缺省会自动回退到通用图标。
2. **加种族 / 职业 / 咒语**：直接往 `core.json` 的数组里加条目。
   - `ability.kind` 是引擎挂钩子的名字，已有实现见 `engine.ts` 的 `applyAbility`：`none`、`grantSpells`、`grantRandomSpells`、`rollAdvantageOn`、`doubleSellPrice`、`freeAttack`、`damageBonusVsAffix`、`repairArmorWithTorch`、`coinPerKill`、`openDoorFree`、`torchOnDoorSmash`、`leaveWhenOutOfTorches`、`healFullOnDevour`。
   - 想加全新机制：在 `engine.ts` 里加一个 `kind` 分支，并在本表里登记。
3. **加怪物词缀**：`core.json` 的 `monsterAffixes`。`trigger` 是引擎识别的时机：
   `ignoreDamageAtOrBelow`、`ignoreDamageOnEvenRoll`、`doubleDamageOnRoll6`、`reviveOnDeathRoll1`、`pierceArmor`、`grantLoot`、`onPlayerAttackRoll1`（配合 `effect`：`explode`、`nextDamage`、`nextDamageDice`、`summon`、`nextAttackKills`、`heal`、`nextAttackParalyze`）。
4. **改经济与上限**：`core.json` 的 `rules`（起始火把、背包上限、休息/修理价格、层数等）。
5. **补原书空格**：陵墓陷阱表第 3 格在原书里没有文字，数据里 `kind: "blank"`，想补就改那一条的 `text` 与 `kind`。

改完数据不需要动数据库：新开的存档会立刻用上新表；已有存档保存的是自己的快照，不受影响。