-- 卡卡颂计分：每个账户可保存多份游戏快照，状态以 JSON 保存，便于跟随功能演进。
CREATE TABLE "CarcassonneSave" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CarcassonneSave_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CarcassonneSave_ownerId_createdAt_idx" ON "CarcassonneSave"("ownerId", "createdAt");
