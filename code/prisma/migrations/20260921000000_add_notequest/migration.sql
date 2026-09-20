-- CreateTable
CREATE TABLE "NoteQuestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "heroName" TEXT NOT NULL DEFAULT '',
    "raceName" TEXT NOT NULL DEFAULT '',
    "className" TEXT NOT NULL DEFAULT '',
    "dungeonName" TEXT NOT NULL DEFAULT '',
    "dungeonTypeId" TEXT NOT NULL DEFAULT 'palace',
    "depth" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "turns" INTEGER NOT NULL DEFAULT 0,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "treasures" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "torches" INTEGER NOT NULL DEFAULT 0,
    "hp" INTEGER NOT NULL DEFAULT 0,
    "maxHp" INTEGER NOT NULL DEFAULT 0,
    "outcomeText" TEXT NOT NULL DEFAULT '',
    "stateJson" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NoteQuestRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteQuestGrave" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT,
    "characterName" TEXT NOT NULL,
    "raceName" TEXT NOT NULL DEFAULT '',
    "className" TEXT NOT NULL DEFAULT '',
    "dungeonName" TEXT NOT NULL DEFAULT '',
    "dungeonTypeId" TEXT NOT NULL DEFAULT '',
    "depth" INTEGER NOT NULL DEFAULT 1,
    "cause" TEXT NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "treasures" INTEGER NOT NULL DEFAULT 0,
    "diedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoteQuestGrave_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteQuestGrave_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NoteQuestRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NoteQuestRun_ownerId_updatedAt_idx" ON "NoteQuestRun"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "NoteQuestRun_ownerId_status_updatedAt_idx" ON "NoteQuestRun"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "NoteQuestGrave_ownerId_diedAt_idx" ON "NoteQuestGrave"("ownerId", "diedAt");