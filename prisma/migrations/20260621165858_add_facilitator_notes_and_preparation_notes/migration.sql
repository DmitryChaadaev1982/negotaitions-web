-- AlterTable
ALTER TABLE "SessionParticipant" ADD COLUMN     "preparationNotes" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "FacilitatorNote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "facilitatorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilitatorNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacilitatorNote_sessionId_idx" ON "FacilitatorNote"("sessionId");

-- CreateIndex
CREATE INDEX "FacilitatorNote_facilitatorId_idx" ON "FacilitatorNote"("facilitatorId");

-- AddForeignKey
ALTER TABLE "FacilitatorNote" ADD CONSTRAINT "FacilitatorNote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitatorNote" ADD CONSTRAINT "FacilitatorNote_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "SessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
