-- 角色卡存档从「每账户一行整包 JSON」改为「一行一个 key」。
-- 动机：整包覆盖会用旧快照抹掉新改动；改成按 key 存后只写变化的字段，
-- 不同设备改不同字段不再互相覆盖，上传体积也只跟改动量相关。
-- 旧表 DndSave 保留为迁移前快照（运行时不再读写，回滚时可用）。
CREATE TABLE "DndSaveEntry" (
    "ownerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("ownerId", "key"),
    CONSTRAINT "DndSaveEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
