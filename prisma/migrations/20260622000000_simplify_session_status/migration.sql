-- Normalize legacy prep statuses before shrinking the enum.
UPDATE "Session"
SET "status" = 'READY'
WHERE "status"::text IN ('IN_PROGRESS', 'COMPLETED', 'ANALYZED');

ALTER TYPE "SessionStatus" RENAME TO "SessionStatus_old";

CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'READY');

ALTER TABLE "Session" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Session"
  ALTER COLUMN "status" TYPE "SessionStatus"
  USING ("status"::text::"SessionStatus");
ALTER TABLE "Session" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "SessionStatus_old";
