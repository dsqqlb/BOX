-- CreateTable
CREATE TABLE "DndSave" (
    "ownerId" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DndSave_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavingsRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "SavingsRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DndSave_ownerId_key" ON "DndSave"("ownerId");

-- CreateIndex
CREATE INDEX "SavingsRecord_ownerId_createdAt_idx" ON "SavingsRecord"("ownerId", "createdAt");
