-- 彻底移除 NoteQuest 地牢笔记模块：四张表连同它们的索引一起删掉。
-- （历史迁移 20260921000000_add_notequest / 20260922000000_add_notequest_pool /
--   20260923000000_add_notequest_slots 已经一并从仓库里删除，这里只负责把库里已经建好的东西拆掉。）
DROP TABLE IF EXISTS "NoteQuestGrave";
DROP TABLE IF EXISTS "NoteQuestRun";
DROP TABLE IF EXISTS "NoteQuestCharacter";
DROP TABLE IF EXISTS "NoteQuestDungeon";