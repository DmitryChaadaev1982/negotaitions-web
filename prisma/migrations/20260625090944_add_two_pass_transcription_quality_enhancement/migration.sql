-- AlterTable
ALTER TABLE "Transcript" ADD COLUMN     "alignmentConfidence" DOUBLE PRECISION,
ADD COLUMN     "alignmentStatus" TEXT,
ADD COLUMN     "diarizationPassStatus" TEXT,
ADD COLUMN     "qualityModel" TEXT,
ADD COLUMN     "qualityPassStatus" TEXT,
ADD COLUMN     "strategy" TEXT;

-- AlterTable
ALTER TABLE "TranscriptSegment" ADD COLUMN     "alignmentConfidence" DOUBLE PRECISION,
ADD COLUMN     "qualityText" TEXT,
ADD COLUMN     "textSource" TEXT;
