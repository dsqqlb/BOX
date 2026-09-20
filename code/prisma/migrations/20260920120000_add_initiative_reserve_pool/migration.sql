-- 先攻追踪器遥控器的「备选角色池」：按账户保存，换浏览器/清缓存/换设备都还在。
CREATE TABLE "InitiativeReservePool" (
    "ownerId" TEXT NOT NULL PRIMARY KEY,
    "poolJson" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InitiativeReservePool_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);