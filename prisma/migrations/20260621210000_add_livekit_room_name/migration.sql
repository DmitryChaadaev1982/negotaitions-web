-- AlterTable
ALTER TABLE "Session" ADD COLUMN "livekitRoomName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Session_livekitRoomName_key" ON "Session"("livekitRoomName");
