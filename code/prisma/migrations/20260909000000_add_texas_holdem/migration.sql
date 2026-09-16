-- 德州扑克：账户筹码余额（可变）+ 追加式筹码流水（审计用）。筹码是纯娱乐虚拟币。
CREATE TABLE "HoldemBalance" (
  "ownerId" TEXT NOT NULL PRIMARY KEY,
  "chips" INTEGER NOT NULL DEFAULT 10000,
  "handsPlayed" INTEGER NOT NULL DEFAULT 0,
  "handsWon" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "HoldemBalance_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "HoldemLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "balance" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "roomId" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoldemLedger_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "HoldemLedger_ownerId_createdAt_idx" ON "HoldemLedger"("ownerId", "createdAt");
