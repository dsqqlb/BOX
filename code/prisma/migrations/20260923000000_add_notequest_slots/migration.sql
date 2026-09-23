-- AlterTable：三个存档栏位（0/1/2）——存档、人物池、永久地牢、墓地都按栏位隔离
ALTER TABLE "NoteQuestRun" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NoteQuestCharacter" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NoteQuestDungeon" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NoteQuestGrave" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;

-- 索引改成「按栏位查」
DROP INDEX "NoteQuestRun_ownerId_updatedAt_idx";
DROP INDEX "NoteQuestRun_ownerId_status_updatedAt_idx";
DROP INDEX "NoteQuestCharacter_ownerId_updatedAt_idx";
DROP INDEX "NoteQuestGrave_ownerId_diedAt_idx";
CREATE INDEX "NoteQuestRun_ownerId_slot_updatedAt_idx" ON "NoteQuestRun"("ownerId", "slot", "updatedAt");
CREATE INDEX "NoteQuestRun_ownerId_slot_status_updatedAt_idx" ON "NoteQuestRun"("ownerId", "slot", "status", "updatedAt");
CREATE INDEX "NoteQuestCharacter_ownerId_slot_updatedAt_idx" ON "NoteQuestCharacter"("ownerId", "slot", "updatedAt");
CREATE INDEX "NoteQuestGrave_ownerId_slot_diedAt_idx" ON "NoteQuestGrave"("ownerId", "slot", "diedAt");

-- 地牢的唯一约束从「账号 × 类型」变成「账号 × 栏位 × 类型」
DROP INDEX "NoteQuestDungeon_ownerId_typeId_key";
DROP INDEX "NoteQuestDungeon_ownerId_updatedAt_idx";
CREATE UNIQUE INDEX "NoteQuestDungeon_ownerId_slot_typeId_key" ON "NoteQuestDungeon"("ownerId", "slot", "typeId");
CREATE INDEX "NoteQuestDungeon_ownerId_slot_updatedAt_idx" ON "NoteQuestDungeon"("ownerId", "slot", "updatedAt");