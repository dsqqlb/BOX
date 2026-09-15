-- CreateTable
CREATE TABLE "LoginRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LoginRecord_userId_createdAt_idx" ON "LoginRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginRecord_username_createdAt_idx" ON "LoginRecord"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginRecord_createdAt_idx" ON "LoginRecord"("createdAt");
