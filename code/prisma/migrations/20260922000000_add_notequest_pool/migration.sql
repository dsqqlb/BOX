-- CreateTable：人物池（掷骰/自定义建角都存这里，一份完整角色快照）
CREATE TABLE "NoteQuestCharacter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "raceId" TEXT NOT NULL DEFAULT '',
    "raceName" TEXT NOT NULL DEFAULT '',
    "classId" TEXT NOT NULL DEFAULT '',
    "className" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "maxHp" INTEGER NOT NULL DEFAULT 1,
    "heroJson" TEXT NOT NULL DEFAULT '{}',
    "runs" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "lastOutcome" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NoteQuestCharacter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable：永久地牢（一个账号 × 一种地牢类型 = 一张永久地图，含遗体与掉落）
CREATE TABLE "NoteQuestDungeon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 1,
    "rooms" INTEGER NOT NULL DEFAULT 0,
    "corpses" INTEGER NOT NULL DEFAULT 0,
    "nodesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NoteQuestDungeon_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NoteQuestCharacter_ownerId_updatedAt_idx" ON "NoteQuestCharacter"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NoteQuestDungeon_ownerId_typeId_key" ON "NoteQuestDungeon"("ownerId", "typeId");

-- CreateIndex
CREATE INDEX "NoteQuestDungeon_ownerId_updatedAt_idx" ON "NoteQuestDungeon"("ownerId", "updatedAt");

-- AlterTable：存档关联到人物与地牢（引入之前的存档为 NULL）
ALTER TABLE "NoteQuestRun" ADD COLUMN "characterId" TEXT REFERENCES "NoteQuestCharacter" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NoteQuestRun" ADD COLUMN "dungeonId" TEXT REFERENCES "NoteQuestDungeon" ("id") ON DELETE SET NULL ON UPDATE CASCADE;