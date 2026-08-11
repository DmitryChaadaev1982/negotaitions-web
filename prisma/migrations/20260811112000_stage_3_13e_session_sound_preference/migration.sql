ALTER TABLE "User"
ADD COLUMN "sessionSoundEnabled" BOOLEAN;

UPDATE "User"
SET "sessionSoundEnabled" = TRUE
WHERE "sessionSoundEnabled" IS NULL;

ALTER TABLE "User"
ALTER COLUMN "sessionSoundEnabled" SET DEFAULT TRUE;

ALTER TABLE "User"
ALTER COLUMN "sessionSoundEnabled" SET NOT NULL;
