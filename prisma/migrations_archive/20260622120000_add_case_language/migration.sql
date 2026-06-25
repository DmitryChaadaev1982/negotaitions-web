-- CreateEnum
CREATE TYPE "CaseLanguage" AS ENUM ('RU', 'EN');

-- AlterTable
ALTER TABLE "NegotiationCase" ADD COLUMN "caseLanguage" "CaseLanguage" NOT NULL DEFAULT 'EN';
