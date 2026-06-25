-- Phase 1: Auth Security Baseline
-- Adds globalRole, status, approval fields to User model.
-- Adds UserSession model for httpOnly cookie-based sessions.

-- AlterTable: User — add account-level role and approval workflow fields
ALTER TABLE "User"
  ADD COLUMN "globalRole" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedByUserId" TEXT,
  ADD COLUMN "blockedAt" TIMESTAMP(3),
  ADD COLUMN "blockedByUserId" TEXT,
  ADD COLUMN "approvalComment" TEXT;

-- CreateTable: UserSession — stores server-side session token hashes
CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "userAgent" TEXT,
  "ipHash" TEXT,

  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_sessionTokenHash_key" ON "UserSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
