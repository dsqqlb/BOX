# EDH 指挥官组卡台

路径：`/tools/edh-builder`
所需权限：`edh-builder`

EDH 组卡台支持中文优先的本地卡牌检索、颜色/类别/法术力值/稀有度/力量防御力/赛制等筛选，以及指挥官槽位、卡牌详情、自由拖放桌面和按类别或法术力值归拢的视图。

## 数据与保存

- 卡牌元数据由 `npm run sync:edh-cards` 从 Scryfall 同步至 `data/edh/cards.json`；卡图继续使用 Scryfall CDN 链接。
- 牌组、卡牌数量、指挥官和自由桌面布局按登录账户保存在 `data/box.sqlite`。
- 运行时不会生成 `data/edh/decks/<用户名>.json`；旧 JSON 可在维护窗口使用 `npm run db:import-json` 导入，导入前会自动备份。

生产环境须将 `data/box.sqlite` 和 `data/edh/cards.json` 纳入备份。