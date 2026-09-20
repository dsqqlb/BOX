-- 桌面机器（兑奖机 / 碎纸机 / 自动刮奖机）的位置与收起状态
ALTER TABLE "ScratchProfile" ADD COLUMN "machinesJson" TEXT NOT NULL DEFAULT '{}';