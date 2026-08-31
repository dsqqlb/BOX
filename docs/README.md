# BOX 文档索引

本目录存放当前功能的使用与维护说明。根目录的 [README](../README.md) 提供项目概览和本地启动步骤。

## 认证与运行

- [认证与授权](./authentication.md)：SQLite 账户、密码哈希、工具权限、管理员账户管理与 Cookie。

完整应用运行时必须使用 `server/index.js`：它负责认证、受保护 API、WebSocket 和生产静态文件托管。不要把 `out/` 单独部署为完整应用。

## 工具说明

| 工具 | 路径 | 说明文档 |
| --- | --- | --- |
| Claude Code 学习中心 | `/tools/claude-code-guide` | [claude-code-guide.md](./claude-code-guide.md) |
| DND 语言翻译器 | `/tools/dnd-translator` | [dnd-translator.md](./dnd-translator.md) |
| 康威生命游戏 | `/tools/conways-game-of-life` | [conways-game-of-life.md](./conways-game-of-life.md) |
| 目标大屏 | `/tools/target-text` | [target-text.md](./target-text.md) |
| DND 人物卡 | `/tools/dnd-character` | [dnd-character.md](./dnd-character.md) |
| DND 先攻追踪器（遥控器/主屏） | `/tools/initiative-tracker`、`/tools/initiative-tracker/display` | [initiative-tracker-room.md](./initiative-tracker-room.md) |
| Kards 二战卡牌 | `/tools/kards` | [kards.md](./kards.md) |
| JSON 星系 | `/tools/json-visualizer` | [json-visualizer.md](./json-visualizer.md) |
| EDH 指挥官组卡台 | `/tools/edh-builder` | [edh-builder.md](./edh-builder.md) |
| 塔罗牌占卜 | `/tools/tarot-reading` | [tarot-reading.md](./tarot-reading.md) |
| 省钱网页 | `/tools/savings-tracker` | [savings-tracker.md](./savings-tracker.md) |
| CSS 层叠解释器 | `/tools/css-cascade` | [css-cascade.md](./css-cascade.md) |

## 文档维护约定

每个 `data/tools.json` 中注册的工具都必须有一份对应的 Markdown 说明。功能、路由、权限或持久化方式变化时，应在同一改动中更新对应文档；不要在文档中保留未实现的功能或过时的传输方式。
