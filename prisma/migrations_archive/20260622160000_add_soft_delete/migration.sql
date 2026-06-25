-- AlterTable
ALTER TABLE "NegotiationCase" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_negotiationCaseId_fkey";

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_negotiationCaseId_fkey" FOREIGN KEY ("negotiationCaseId") REFERENCES "NegotiationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
