-- Shared DND initiative scene media metadata; file bytes are private runtime files.
CREATE TABLE "DndSceneMedia" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "uploaderId" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DndSceneMedia_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DndSceneMedia_storedName_key" ON "DndSceneMedia"("storedName");
CREATE INDEX "DndSceneMedia_kind_createdAt_idx" ON "DndSceneMedia"("kind", "createdAt");
CREATE INDEX "DndSceneMedia_uploaderId_createdAt_idx" ON "DndSceneMedia"("uploaderId", "createdAt");
