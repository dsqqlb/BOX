-- 票在桌面上的摆放角度：null = 还没摆正（客户端按票 id 给一个随机角），0 = 已经摆正
ALTER TABLE "ScratchTicket" ADD COLUMN "rotation" REAL;