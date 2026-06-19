/*
  Warnings:

  - You are about to drop the column `instructions` on the `CaseRole` table. All the data in the column will be lost.
  - Added the required column `constraints` to the `CaseRole` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fallbackPosition` to the `CaseRole` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hiddenInfo` to the `CaseRole` table without a default value. This is not possible if the table is not empty.
  - Added the required column `objectives` to the `CaseRole` table without a default value. This is not possible if the table is not empty.
  - Added the required column `privateInstructions` to the `CaseRole` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessContext` to the `NegotiationCase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `publicInstructions` to the `NegotiationCase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetSkills` to the `NegotiationCase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CaseRole" DROP COLUMN "instructions",
ADD COLUMN     "constraints" TEXT NOT NULL,
ADD COLUMN     "fallbackPosition" TEXT NOT NULL,
ADD COLUMN     "hiddenInfo" TEXT NOT NULL,
ADD COLUMN     "objectives" TEXT NOT NULL,
ADD COLUMN     "privateInstructions" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "NegotiationCase" ADD COLUMN     "businessContext" TEXT NOT NULL,
ADD COLUMN     "publicInstructions" TEXT NOT NULL,
ADD COLUMN     "targetSkills" TEXT NOT NULL;
