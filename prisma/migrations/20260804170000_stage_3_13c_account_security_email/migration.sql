-- Stage 3.13C account-security email core.
-- Additive only: password reset tokens are independently revocable and expire.

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
ON "PasswordResetToken"("tokenHash");

CREATE INDEX "PasswordResetToken_userId_usedAt_revokedAt_idx"
ON "PasswordResetToken"("userId", "usedAt", "revokedAt");

CREATE UNIQUE INDEX "PasswordResetToken_one_active_per_user_key"
ON "PasswordResetToken"("userId")
WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

CREATE INDEX "PasswordResetToken_expiresAt_idx"
ON "PasswordResetToken"("expiresAt");

CREATE INDEX "PasswordResetToken_createdAt_idx"
ON "PasswordResetToken"("createdAt");

ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
