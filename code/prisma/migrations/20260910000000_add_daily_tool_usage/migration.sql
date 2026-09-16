-- Per-user, per-tool daily aggregates.  Kept compact to power personal trends without
-- retaining a detailed event-by-event activity log.
CREATE TABLE "DailyToolUsage" (
    "ownerId" TEXT NOT NULL,
    "toolSlug" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "openCount" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("ownerId", "toolSlug", "dayKey"),
    CONSTRAINT "DailyToolUsage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DailyToolUsage_ownerId_dayKey_idx" ON "DailyToolUsage"("ownerId", "dayKey");
