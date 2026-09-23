-- 彻底移除 Kards 二战卡牌模块：牌组表连同它的索引一起删掉。
-- （历史迁移 20260829000000_add_kards_deck 已经一并从仓库里删除，这里只负责把库里已经建好的东西拆掉。）
DROP TABLE IF EXISTS "KardsDeck";