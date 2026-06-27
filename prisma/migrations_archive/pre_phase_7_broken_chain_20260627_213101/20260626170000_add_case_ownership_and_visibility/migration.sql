-- AlterTable
ALTER TABLE "public"."NegotiationCase"
ADD COLUMN "createdByUserId" TEXT,
ADD COLUMN "visibility" "public"."VisibilityLevel" NOT NULL DEFAULT 'PRIVATE';

-- Backfill visibility for legacy/demo cases.
UPDATE "public"."NegotiationCase"
SET "visibility" = 'PUBLIC'
WHERE "createdByUserId" IS NULL;

-- CreateIndex
CREATE INDEX "NegotiationCase_createdByUserId_idx"
ON "public"."NegotiationCase"("createdByUserId");

-- CreateIndex
CREATE INDEX "NegotiationCase_visibility_idx"
ON "public"."NegotiationCase"("visibility");

-- AddForeignKey
ALTER TABLE "public"."NegotiationCase"
ADD CONSTRAINT "NegotiationCase_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId")
REFERENCES "public"."User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
