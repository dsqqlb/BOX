-- Invalidate all existing session cookies on deployment and support password-reset session revocation.
ALTER TABLE "User" ADD COLUMN "sessionRevision" INTEGER NOT NULL DEFAULT 0;
