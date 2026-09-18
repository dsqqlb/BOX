-- CreateTable
CREATE TABLE "ScratchProfile" (
    "ownerId" TEXT NOT NULL PRIMARY KEY,
    "scraps" INTEGER NOT NULL DEFAULT 0,
    "levelsJson" TEXT NOT NULL DEFAULT '{}',
    "unlockedJson" TEXT NOT NULL DEFAULT '[]',
    "statsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScratchProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScratchTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sealed',
    "scratchRatio" REAL NOT NULL DEFAULT 0,
    "posX" REAL NOT NULL DEFAULT 0,
    "posY" REAL NOT NULL DEFAULT 0,
    "z" INTEGER NOT NULL DEFAULT 0,
    "purchasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScratchTicket_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScratchLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "ticketId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScratchLedger_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScratchTicket_ownerId_status_purchasedAt_idx" ON "ScratchTicket"("ownerId", "status", "purchasedAt");

-- CreateIndex
CREATE INDEX "ScratchLedger_ownerId_createdAt_idx" ON "ScratchLedger"("ownerId", "createdAt");