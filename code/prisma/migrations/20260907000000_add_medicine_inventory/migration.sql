-- Shared household medicine inventory. Image bytes stay in private data/medicine/uploads.
CREATE TABLE "MedicineProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "genericName" TEXT,
  "brand" TEXT,
  "category" TEXT NOT NULL,
  "dosageForm" TEXT,
  "specification" TEXT,
  "manufacturer" TEXT,
  "origin" TEXT,
  "approvalNumber" TEXT,
  "purpose" TEXT,
  "precautions" TEXT,
  "notes" TEXT,
  "creatorId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MedicineProduct_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "MedicineBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "batchNumber" TEXT,
  "productionDate" DATETIME,
  "expiryDate" DATETIME,
  "initialQuantity" REAL NOT NULL,
  "remainingQuantity" REAL NOT NULL,
  "unit" TEXT NOT NULL,
  "storageLocation" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MedicineBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MedicineProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "MedicineUseLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "usedQuantity" REAL NOT NULL,
  "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recipient" TEXT,
  "reason" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicineUseLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MedicineUseLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "MedicinePhoto" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicinePhoto_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MedicineProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MedicinePhoto_storedName_key" ON "MedicinePhoto"("storedName");
CREATE INDEX "MedicineProduct_updatedAt_idx" ON "MedicineProduct"("updatedAt");
CREATE INDEX "MedicineProduct_category_updatedAt_idx" ON "MedicineProduct"("category", "updatedAt");
CREATE INDEX "MedicineBatch_productId_expiryDate_idx" ON "MedicineBatch"("productId", "expiryDate");
CREATE INDEX "MedicineBatch_expiryDate_idx" ON "MedicineBatch"("expiryDate");
CREATE INDEX "MedicineUseLog_batchId_usedAt_idx" ON "MedicineUseLog"("batchId", "usedAt");
CREATE INDEX "MedicineUseLog_usedAt_idx" ON "MedicineUseLog"("usedAt");
CREATE INDEX "MedicinePhoto_productId_createdAt_idx" ON "MedicinePhoto"("productId", "createdAt");
