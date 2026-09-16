-- CreateTable
CREATE TABLE "EdhLifeGame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "startingLife" INTEGER NOT NULL DEFAULT 40,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'running',
    "winnerSeat" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "stateJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EdhLifeGame_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EdhLifePlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL,
    "life" INTEGER NOT NULL,
    "poison" INTEGER NOT NULL DEFAULT 0,
    "energy" INTEGER NOT NULL DEFAULT 0,
    "treasure" INTEGER NOT NULL DEFAULT 0,
    "clue" INTEGER NOT NULL DEFAULT 0,
    "food" INTEGER NOT NULL DEFAULT 0,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "eliminatedReason" TEXT,
    CONSTRAINT "EdhLifePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "EdhLifeGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EdhLifeRoll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "notation" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "seat" INTEGER,
    "detailJson" TEXT NOT NULL,
    CONSTRAINT "EdhLifeRoll_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "EdhLifeGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EdhLifeGame_ownerId_startedAt_idx" ON "EdhLifeGame"("ownerId", "startedAt");

-- CreateIndex
CREATE INDEX "EdhLifeGame_ownerId_status_updatedAt_idx" ON "EdhLifeGame"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "EdhLifePlayer_gameId_idx" ON "EdhLifePlayer"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "EdhLifePlayer_gameId_seat_key" ON "EdhLifePlayer"("gameId", "seat");

-- CreateIndex
CREATE INDEX "EdhLifeRoll_gameId_at_idx" ON "EdhLifeRoll"("gameId", "at");
