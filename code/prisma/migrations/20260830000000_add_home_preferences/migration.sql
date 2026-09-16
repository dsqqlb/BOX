-- Account-scoped homepage customization and explicit tool-launch history.
CREATE TABLE "HomePreference" (
    "ownerId" TEXT NOT NULL PRIMARY KEY,
    "favoriteToolSlugsJson" TEXT NOT NULL DEFAULT '[]',
    "toolOrderJson" TEXT NOT NULL DEFAULT '[]',
    "collapsedCategoriesJson" TEXT NOT NULL DEFAULT '[]',
    "theme" TEXT NOT NULL DEFAULT 'midnight',
    "viewMode" TEXT NOT NULL DEFAULT 'grid',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HomePreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "HomeToolUsage" (
    "ownerId" TEXT NOT NULL,
    "toolSlug" TEXT NOT NULL,
    "lastOpenedAt" DATETIME NOT NULL,
    "openCount" INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY ("ownerId", "toolSlug"),
    CONSTRAINT "HomeToolUsage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HomeToolUsage_ownerId_lastOpenedAt_idx" ON "HomeToolUsage"("ownerId", "lastOpenedAt");
