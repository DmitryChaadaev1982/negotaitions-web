-- NegotiationState: LOBBY -> PREPARATION and add preparation lifecycle states
ALTER TYPE "NegotiationState" RENAME VALUE 'LOBBY' TO 'PREPARATION';
ALTER TYPE "NegotiationState" ADD VALUE 'PREPARATION_RUNNING';
ALTER TYPE "NegotiationState" ADD VALUE 'PREPARATION_PAUSED';
ALTER TYPE "NegotiationState" ADD VALUE 'READY_TO_START';

-- NegotiationCase: default preparation duration
ALTER TABLE "NegotiationCase" ADD COLUMN "defaultPreparationDurationSeconds" INTEGER NOT NULL DEFAULT 300;

-- Session: preparation timer fields
ALTER TABLE "Session" ADD COLUMN "preparationDurationSeconds" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "Session" ADD COLUMN "preparationStartedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "preparationEndedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "preparationTimerStartedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "preparationPausedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "preparationTotalPausedSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Session" ALTER COLUMN "durationSeconds" SET DEFAULT 900;
ALTER TABLE "Session" ALTER COLUMN "negotiationState" SET DEFAULT 'PREPARATION';

-- TrainingEvent: event duration is planning-only, not session negotiation duration
ALTER TABLE "TrainingEvent" RENAME COLUMN "defaultDurationSeconds" TO "estimatedEventDurationSeconds";
ALTER TABLE "TrainingEvent" ALTER COLUMN "estimatedEventDurationSeconds" DROP NOT NULL;
ALTER TABLE "TrainingEvent" ALTER COLUMN "estimatedEventDurationSeconds" SET DEFAULT 7200;
