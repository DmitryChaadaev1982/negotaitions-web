-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AiAnalysisStatus" AS ENUM ('QUEUED', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."CaseLanguage" AS ENUM ('RU', 'EN');

-- CreateEnum
CREATE TYPE "public"."CompressionStatus" AS ENUM ('NOT_STARTED', 'COMPRESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "public"."EventParticipantPreference" AS ENUM ('UNDECIDED', 'PLAY', 'OBSERVE', 'FACILITATE');

-- CreateEnum
CREATE TYPE "public"."ExternalService" AS ENUM ('LIVEKIT', 'OPENAI', 'YANDEX_OBJECT_STORAGE', 'FFMPEG', 'APP');

-- CreateEnum
CREATE TYPE "public"."ExternalServiceErrorCode" AS ENUM ('AUTH_ERROR', 'PERMISSION_DENIED', 'QUOTA_EXCEEDED', 'BILLING_LIMIT', 'RATE_LIMIT', 'CONFIG_MISSING', 'NETWORK_ERROR', 'STORAGE_UPLOAD_FAILED', 'STORAGE_DOWNLOAD_FAILED', 'STORAGE_OBJECT_NOT_FOUND', 'RECORDING_START_FAILED', 'RECORDING_STOP_FAILED', 'RECORDING_STATUS_FAILED', 'TRANSCRIPTION_FAILED', 'TRANSCRIPTION_FILE_TOO_LARGE', 'COMPRESSION_FAILED', 'FFMPEG_MISSING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."ExternalServiceEventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."NegotiationState" AS ENUM ('PREPARATION', 'RUNNING', 'PAUSED', 'FINISHED', 'PREPARATION_RUNNING', 'PREPARATION_PAUSED', 'READY_TO_START');

-- CreateEnum
CREATE TYPE "public"."ParticipantType" AS ENUM ('PARTICIPANT', 'OBSERVER', 'FACILITATOR');

-- CreateEnum
CREATE TYPE "public"."RecordingStatus" AS ENUM ('NOT_STARTED', 'STARTING', 'RECORDING', 'PAUSED', 'COMPLETED', 'FAILED', 'PROCESSING', 'STOPPED');

-- CreateEnum
CREATE TYPE "public"."RecordingType" AS ENUM ('AUDIO_ONLY', 'VIDEO_COMPOSITE');

-- CreateEnum
CREATE TYPE "public"."SessionStatus" AS ENUM ('DRAFT', 'READY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."TrainingEventStatus" AS ENUM ('DRAFT', 'LOBBY_OPEN', 'SESSION_CREATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TranscriptSource" AS ENUM ('MANUAL', 'GENERATED');

-- CreateEnum
CREATE TYPE "public"."TranscriptStatus" AS ENUM ('QUEUED', 'DOWNLOADING_RECORDING', 'COMPRESSING_AUDIO', 'TRANSCRIBING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('FACILITATOR', 'PARTICIPANT', 'OBSERVER');

-- CreateTable
CREATE TABLE "public"."AiAnalysis" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "analysisJson" JSONB,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "executiveSummary" TEXT,
    "language" TEXT,
    "model" TEXT,
    "overallScore" INTEGER,
    "rawModelOutput" JSONB,
    "startedAt" TIMESTAMP(3),
    "status" "public"."AiAnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "transcriptId" TEXT,
    "sharedAnalysisJson" JSONB,
    "sharedAt" TIMESTAMP(3),
    "sharedBy" TEXT,
    "sharedExecutiveSummary" TEXT,
    "unsharedAt" TIMESTAMP(3),
    "visibility" TEXT NOT NULL DEFAULT 'FACILITATOR_ONLY',
    "transcriptRetranscribeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CaseRole" (
    "id" TEXT NOT NULL,
    "negotiationCaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "constraints" TEXT NOT NULL,
    "fallbackPosition" TEXT NOT NULL,
    "hiddenInfo" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "privateInstructions" TEXT NOT NULL,

    CONSTRAINT "CaseRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "participantToken" TEXT NOT NULL,
    "preference" "public"."EventParticipantPreference" NOT NULL DEFAULT 'UNDECIDED',
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "wantsToPlay" BOOLEAN NOT NULL DEFAULT false,
    "wantsToObserve" BOOLEAN NOT NULL DEFAULT false,
    "wantsToFacilitate" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "assignedSessionId" TEXT,
    "assignedSessionParticipantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExternalServiceEvent" (
    "id" TEXT NOT NULL,
    "service" "public"."ExternalService" NOT NULL,
    "severity" "public"."ExternalServiceEventSeverity" NOT NULL,
    "errorCode" "public"."ExternalServiceErrorCode",
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawError" JSONB,
    "sessionId" TEXT,
    "recordingId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalServiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NegotiationCase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "difficulty" "public"."Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "facilitatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessContext" TEXT NOT NULL,
    "publicInstructions" TEXT NOT NULL,
    "targetSkills" TEXT NOT NULL,
    "defaultDurationSeconds" INTEGER NOT NULL DEFAULT 900,
    "caseLanguage" "public"."CaseLanguage" NOT NULL DEFAULT 'EN',
    "deletedAt" TIMESTAMP(3),
    "defaultPreparationDurationSeconds" INTEGER NOT NULL DEFAULT 300,

    CONSTRAINT "NegotiationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Recording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "public"."RecordingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'LIVEKIT_CLOUD',
    "egressId" TEXT,
    "recordingType" "public"."RecordingType" NOT NULL DEFAULT 'AUDIO_ONLY',
    "fileUrl" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "originalSizeBytes" INTEGER,
    "compressedFileKey" TEXT,
    "compressedFileName" TEXT,
    "compressedMimeType" TEXT,
    "compressedSizeBytes" INTEGER,
    "compressionStatus" "public"."CompressionStatus",
    "compressionError" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "negotiationCaseId" TEXT NOT NULL,
    "facilitatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "public"."SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "livekitRoomName" TEXT,
    "negotiationState" "public"."NegotiationState" NOT NULL DEFAULT 'PREPARATION',
    "durationSeconds" INTEGER NOT NULL DEFAULT 900,
    "negotiationStartedAt" TIMESTAMP(3),
    "negotiationEndedAt" TIMESTAMP(3),
    "timerStartedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "totalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "snapshotCaseTitle" TEXT NOT NULL,
    "snapshotBusinessContext" TEXT NOT NULL,
    "snapshotPublicInstructions" TEXT NOT NULL,
    "snapshotCaseLanguage" "public"."CaseLanguage" NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "eventId" TEXT,
    "preparationDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "preparationStartedAt" TIMESTAMP(3),
    "preparationEndedAt" TIMESTAMP(3),
    "preparationTimerStartedAt" TIMESTAMP(3),
    "preparationPausedAt" TIMESTAMP(3),
    "preparationTotalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "closeReason" TEXT,
    "closedByEventAt" TIMESTAMP(3),
    "closedByEventId" TEXT,
    "sequenceNumber" INTEGER,
    "roomLabel" TEXT,
    "createdFromEventAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "public"."ParticipantType" NOT NULL,
    "joinToken" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "sessionRoleId" TEXT,
    "eventParticipantId" TEXT,

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionParticipantAudioActivity" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionParticipantId" TEXT NOT NULL,
    "participantIdentity" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "startedOffsetSeconds" DOUBLE PRECISION,
    "endedOffsetSeconds" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'LIVEKIT_ACTIVE_SPEAKER',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionParticipantAudioActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionPauseInterval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionPauseInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionRole" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privateInstructions" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "hiddenInfo" TEXT NOT NULL,
    "fallbackPosition" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrainingEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "public"."TrainingEventStatus" NOT NULL DEFAULT 'LOBBY_OPEN',
    "publicJoinCode" TEXT NOT NULL,
    "hostToken" TEXT NOT NULL,
    "lobbyRoomName" TEXT,
    "selectedCaseId" TEXT,
    "estimatedEventDurationSeconds" INTEGER DEFAULT 7200,
    "assignmentDraft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "completionReason" TEXT,
    "endedMessage" TEXT,

    CONSTRAINT "TrainingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transcript" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordingId" TEXT,
    "source" "public"."TranscriptSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "language" TEXT,
    "originalFileName" TEXT,
    "originalMimeType" TEXT,
    "transcriptionModel" TEXT,
    "diarizedText" TEXT,
    "hasSpeakerDiarization" BOOLEAN NOT NULL DEFAULT false,
    "speakerMapping" JSONB,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "status" "public"."TranscriptStatus" NOT NULL DEFAULT 'COMPLETED',
    "processingMetadata" JSONB,
    "speakerMappingConfirmedAt" TIMESTAMP(3),
    "speakerMappingConfirmedBy" TEXT,
    "speakerMappingStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "diarizationError" TEXT,
    "diarizationProvider" TEXT,
    "diarizationStatus" TEXT,
    "retranscribeCount" INTEGER NOT NULL DEFAULT 0,
    "retranscribeHistory" JSONB,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "mappedParticipantId" TEXT,
    "startSeconds" DOUBLE PRECISION,
    "endSeconds" DOUBLE PRECISION,
    "text" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mappingConfidence" DOUBLE PRECISION,
    "mappingLocked" BOOLEAN NOT NULL DEFAULT false,
    "mappingSource" TEXT,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageCounter" (
    "id" TEXT NOT NULL,
    "service" "public"."ExternalService" NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'PARTICIPANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysis_sessionId_key" ON "public"."AiAnalysis"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "CaseRole_negotiationCaseId_idx" ON "public"."CaseRole"("negotiationCaseId" ASC);

-- CreateIndex
CREATE INDEX "EventParticipant_assignedSessionId_idx" ON "public"."EventParticipant"("assignedSessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_assignedSessionParticipantId_key" ON "public"."EventParticipant"("assignedSessionParticipantId" ASC);

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_idx" ON "public"."EventParticipant"("eventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_participantToken_key" ON "public"."EventParticipant"("participantToken" ASC);

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_createdAt_idx" ON "public"."ExternalServiceEvent"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_service_idx" ON "public"."ExternalServiceEvent"("service" ASC);

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_sessionId_idx" ON "public"."ExternalServiceEvent"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_severity_idx" ON "public"."ExternalServiceEvent"("severity" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Recording_sessionId_key" ON "public"."Recording"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "Session_eventId_idx" ON "public"."Session"("eventId" ASC);

-- CreateIndex
CREATE INDEX "Session_facilitatorId_idx" ON "public"."Session"("facilitatorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_livekitRoomName_key" ON "public"."Session"("livekitRoomName" ASC);

-- CreateIndex
CREATE INDEX "Session_negotiationCaseId_idx" ON "public"."Session"("negotiationCaseId" ASC);

-- CreateIndex
CREATE INDEX "SessionParticipant_eventParticipantId_idx" ON "public"."SessionParticipant"("eventParticipantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_joinToken_key" ON "public"."SessionParticipant"("joinToken" ASC);

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionId_idx" ON "public"."SessionParticipant"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionRoleId_idx" ON "public"."SessionParticipant"("sessionRoleId" ASC);

-- CreateIndex
CREATE INDEX "SessionParticipant_userId_idx" ON "public"."SessionParticipant"("userId" ASC);

-- CreateIndex
CREATE INDEX "SessionParticipantAudioActivity_sessionId_idx" ON "public"."SessionParticipantAudioActivity"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "SessionParticipantAudioActivity_sessionParticipantId_idx" ON "public"."SessionParticipantAudioActivity"("sessionParticipantId" ASC);

-- CreateIndex
CREATE INDEX "SessionPauseInterval_sessionId_idx" ON "public"."SessionPauseInterval"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "SessionRole_sessionId_idx" ON "public"."SessionRole"("sessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_hostToken_key" ON "public"."TrainingEvent"("hostToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_publicJoinCode_key" ON "public"."TrainingEvent"("publicJoinCode" ASC);

-- CreateIndex
CREATE INDEX "TrainingEvent_selectedCaseId_idx" ON "public"."TrainingEvent"("selectedCaseId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_recordingId_key" ON "public"."Transcript"("recordingId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_sessionId_key" ON "public"."Transcript"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "TranscriptSegment_mappedParticipantId_idx" ON "public"."TranscriptSegment"("mappedParticipantId" ASC);

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_idx" ON "public"."TranscriptSegment"("transcriptId" ASC);

-- CreateIndex
CREATE INDEX "UsageCounter_service_metric_periodStart_idx" ON "public"."UsageCounter"("service" ASC, "metric" ASC, "periodStart" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."AiAnalysis" ADD CONSTRAINT "AiAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseRole" ADD CONSTRAINT "CaseRole_negotiationCaseId_fkey" FOREIGN KEY ("negotiationCaseId") REFERENCES "public"."NegotiationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventParticipant" ADD CONSTRAINT "EventParticipant_assignedSessionId_fkey" FOREIGN KEY ("assignedSessionId") REFERENCES "public"."Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventParticipant" ADD CONSTRAINT "EventParticipant_assignedSessionParticipantId_fkey" FOREIGN KEY ("assignedSessionParticipantId") REFERENCES "public"."SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TrainingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NegotiationCase" ADD CONSTRAINT "NegotiationCase_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Recording" ADD CONSTRAINT "Recording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TrainingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_negotiationCaseId_fkey" FOREIGN KEY ("negotiationCaseId") REFERENCES "public"."NegotiationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionParticipant" ADD CONSTRAINT "SessionParticipant_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "public"."EventParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionRoleId_fkey" FOREIGN KEY ("sessionRoleId") REFERENCES "public"."SessionRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionParticipant" ADD CONSTRAINT "SessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionPauseInterval" ADD CONSTRAINT "SessionPauseInterval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionRole" ADD CONSTRAINT "SessionRole_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrainingEvent" ADD CONSTRAINT "TrainingEvent_selectedCaseId_fkey" FOREIGN KEY ("selectedCaseId") REFERENCES "public"."NegotiationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transcript" ADD CONSTRAINT "Transcript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "public"."Recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transcript" ADD CONSTRAINT "Transcript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_mappedParticipantId_fkey" FOREIGN KEY ("mappedParticipantId") REFERENCES "public"."SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "public"."Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

