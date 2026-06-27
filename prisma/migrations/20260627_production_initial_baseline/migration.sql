-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FACILITATOR', 'PARTICIPANT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "CaseLanguage" AS ENUM ('RU', 'EN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'READY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('PARTICIPANT', 'OBSERVER', 'FACILITATOR');

-- CreateEnum
CREATE TYPE "NegotiationState" AS ENUM ('PREPARATION', 'PREPARATION_RUNNING', 'PREPARATION_PAUSED', 'READY_TO_START', 'RUNNING', 'PAUSED', 'FINISHED');

-- CreateEnum
CREATE TYPE "TrainingEventStatus" AS ENUM ('DRAFT', 'LOBBY_OPEN', 'SESSION_CREATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventParticipantPreference" AS ENUM ('UNDECIDED', 'PLAY', 'OBSERVE', 'FACILITATE');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('NOT_STARTED', 'STARTING', 'RECORDING', 'PAUSED', 'PROCESSING', 'COMPLETED', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "RecordingType" AS ENUM ('AUDIO_ONLY', 'VIDEO_COMPOSITE');

-- CreateEnum
CREATE TYPE "CompressionStatus" AS ENUM ('NOT_STARTED', 'COMPRESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('MANUAL', 'GENERATED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('QUEUED', 'DOWNLOADING_RECORDING', 'COMPRESSING_AUDIO', 'TRANSCRIBING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('QUEUED', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VisibilityLevel" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ExternalService" AS ENUM ('LIVEKIT', 'OPENAI', 'YANDEX_OBJECT_STORAGE', 'FFMPEG', 'APP');

-- CreateEnum
CREATE TYPE "ExternalServiceEventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExternalServiceErrorCode" AS ENUM ('AUTH_ERROR', 'PERMISSION_DENIED', 'QUOTA_EXCEEDED', 'BILLING_LIMIT', 'RATE_LIMIT', 'CONFIG_MISSING', 'NETWORK_ERROR', 'STORAGE_UPLOAD_FAILED', 'STORAGE_DOWNLOAD_FAILED', 'STORAGE_OBJECT_NOT_FOUND', 'RECORDING_START_FAILED', 'RECORDING_STOP_FAILED', 'RECORDING_STATUS_FAILED', 'TRANSCRIPTION_FAILED', 'TRANSCRIPTION_FILE_TOO_LARGE', 'COMPRESSION_FAILED', 'FFMPEG_MISSING', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PARTICIPANT',
    "globalRole" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "preferredLocale" TEXT NOT NULL DEFAULT 'ru',
    "lastLoginAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedByUserId" TEXT,
    "approvalComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationCase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "businessContext" TEXT NOT NULL,
    "publicInstructions" TEXT NOT NULL,
    "targetSkills" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "caseLanguage" "CaseLanguage" NOT NULL DEFAULT 'EN',
    "defaultPreparationDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "defaultDurationSeconds" INTEGER NOT NULL DEFAULT 900,
    "facilitatorId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "visibility" "VisibilityLevel" NOT NULL DEFAULT 'PRIVATE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRole" (
    "id" TEXT NOT NULL,
    "negotiationCaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privateInstructions" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "hiddenInfo" TEXT NOT NULL,
    "fallbackPosition" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "negotiationCaseId" TEXT NOT NULL,
    "facilitatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snapshotCaseTitle" TEXT NOT NULL,
    "snapshotBusinessContext" TEXT NOT NULL,
    "snapshotPublicInstructions" TEXT NOT NULL,
    "snapshotCaseLanguage" "CaseLanguage" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "livekitRoomName" TEXT,
    "negotiationState" "NegotiationState" NOT NULL DEFAULT 'PREPARATION',
    "preparationDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "durationSeconds" INTEGER NOT NULL DEFAULT 900,
    "preparationStartedAt" TIMESTAMP(3),
    "preparationEndedAt" TIMESTAMP(3),
    "preparationTimerStartedAt" TIMESTAMP(3),
    "preparationPausedAt" TIMESTAMP(3),
    "preparationTotalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "negotiationStartedAt" TIMESTAMP(3),
    "negotiationEndedAt" TIMESTAMP(3),
    "timerStartedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "totalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "visibility" "VisibilityLevel" NOT NULL DEFAULT 'PRIVATE',
    "eventId" TEXT,
    "sequenceNumber" INTEGER,
    "roomLabel" TEXT,
    "createdFromEventAt" TIMESTAMP(3),
    "closedByEventAt" TIMESTAMP(3),
    "closedByEventId" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPauseInterval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionPauseInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRole" (
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
CREATE TABLE "SessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionRoleId" TEXT,
    "eventParticipantId" TEXT,
    "type" "ParticipantType" NOT NULL,
    "joinToken" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "joinedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "hostUserId" TEXT,
    "facilitatorUserId" TEXT,
    "visibility" "VisibilityLevel" NOT NULL DEFAULT 'PRIVATE',
    "status" "TrainingEventStatus" NOT NULL DEFAULT 'LOBBY_OPEN',
    "publicJoinCode" TEXT NOT NULL,
    "hostToken" TEXT NOT NULL,
    "lobbyRoomName" TEXT,
    "selectedCaseId" TEXT,
    "estimatedEventDurationSeconds" INTEGER DEFAULT 7200,
    "assignmentDraft" JSONB,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "completionReason" TEXT,
    "endedMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "participantToken" TEXT NOT NULL,
    "preference" "EventParticipantPreference" NOT NULL DEFAULT 'UNDECIDED',
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
CREATE TABLE "EventInvite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "invitedEmail" TEXT,
    "invitedEmailNormalized" TEXT,
    "displayLabel" TEXT,
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionInvite" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "invitedEmail" TEXT,
    "invitedEmailNormalized" TEXT,
    "displayLabel" TEXT,
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'LIVEKIT_CLOUD',
    "egressId" TEXT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "recordingType" "RecordingType" NOT NULL DEFAULT 'AUDIO_ONLY',
    "fileUrl" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "originalSizeBytes" INTEGER,
    "compressedFileKey" TEXT,
    "compressedFileName" TEXT,
    "compressedMimeType" TEXT,
    "compressedSizeBytes" INTEGER,
    "compressionStatus" "CompressionStatus",
    "compressionError" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordingId" TEXT,
    "source" "TranscriptSource" NOT NULL,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'COMPLETED',
    "text" TEXT NOT NULL DEFAULT '',
    "diarizedText" TEXT,
    "language" TEXT,
    "originalFileName" TEXT,
    "originalMimeType" TEXT,
    "transcriptionModel" TEXT,
    "hasSpeakerDiarization" BOOLEAN NOT NULL DEFAULT false,
    "speakerMapping" JSONB,
    "speakerMappingStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "speakerMappingConfirmedAt" TIMESTAMP(3),
    "speakerMappingConfirmedBy" TEXT,
    "diarizationStatus" TEXT,
    "diarizationProvider" TEXT,
    "diarizationError" TEXT,
    "strategy" TEXT,
    "qualityModel" TEXT,
    "diarizationPassStatus" TEXT,
    "qualityPassStatus" TEXT,
    "alignmentStatus" TEXT,
    "alignmentConfidence" DOUBLE PRECISION,
    "retranscribeCount" INTEGER NOT NULL DEFAULT 0,
    "retranscribeHistory" JSONB,
    "processingMetadata" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "mappedParticipantId" TEXT,
    "startSeconds" DOUBLE PRECISION,
    "endSeconds" DOUBLE PRECISION,
    "text" TEXT NOT NULL,
    "qualityText" TEXT,
    "alignmentConfidence" DOUBLE PRECISION,
    "textSource" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "mappingSource" TEXT,
    "mappingConfidence" DOUBLE PRECISION,
    "mappingLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "transcriptId" TEXT,
    "transcriptRetranscribeCount" INTEGER NOT NULL DEFAULT 0,
    "status" "AiAnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "language" TEXT,
    "executiveSummary" TEXT,
    "overallScore" INTEGER,
    "analysisJson" JSONB,
    "rawModelOutput" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "visibility" TEXT NOT NULL DEFAULT 'FACILITATOR_ONLY',
    "sharedAnalysisJson" JSONB,
    "sharedExecutiveSummary" TEXT,
    "sharedAt" TIMESTAMP(3),
    "sharedBy" TEXT,
    "unsharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalServiceEvent" (
    "id" TEXT NOT NULL,
    "service" "ExternalService" NOT NULL,
    "severity" "ExternalServiceEventSeverity" NOT NULL,
    "errorCode" "ExternalServiceErrorCode",
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
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "service" "ExternalService" NOT NULL,
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
CREATE TABLE "AdminActionLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionParticipantAudioActivity" (
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_sessionTokenHash_key" ON "UserSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "NegotiationCase_createdByUserId_idx" ON "NegotiationCase"("createdByUserId");

-- CreateIndex
CREATE INDEX "NegotiationCase_visibility_idx" ON "NegotiationCase"("visibility");

-- CreateIndex
CREATE INDEX "CaseRole_negotiationCaseId_idx" ON "CaseRole"("negotiationCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_livekitRoomName_key" ON "Session"("livekitRoomName");

-- CreateIndex
CREATE INDEX "Session_negotiationCaseId_idx" ON "Session"("negotiationCaseId");

-- CreateIndex
CREATE INDEX "Session_facilitatorId_idx" ON "Session"("facilitatorId");

-- CreateIndex
CREATE INDEX "Session_eventId_idx" ON "Session"("eventId");

-- CreateIndex
CREATE INDEX "SessionPauseInterval_sessionId_idx" ON "SessionPauseInterval"("sessionId");

-- CreateIndex
CREATE INDEX "SessionRole_sessionId_idx" ON "SessionRole"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_joinToken_key" ON "SessionParticipant"("joinToken");

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionId_idx" ON "SessionParticipant"("sessionId");

-- CreateIndex
CREATE INDEX "SessionParticipant_userId_idx" ON "SessionParticipant"("userId");

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionId_userId_idx" ON "SessionParticipant"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionRoleId_idx" ON "SessionParticipant"("sessionRoleId");

-- CreateIndex
CREATE INDEX "SessionParticipant_eventParticipantId_idx" ON "SessionParticipant"("eventParticipantId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_publicJoinCode_key" ON "TrainingEvent"("publicJoinCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_hostToken_key" ON "TrainingEvent"("hostToken");

-- CreateIndex
CREATE INDEX "TrainingEvent_hostUserId_idx" ON "TrainingEvent"("hostUserId");

-- CreateIndex
CREATE INDEX "TrainingEvent_facilitatorUserId_idx" ON "TrainingEvent"("facilitatorUserId");

-- CreateIndex
CREATE INDEX "TrainingEvent_selectedCaseId_idx" ON "TrainingEvent"("selectedCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_participantToken_key" ON "EventParticipant"("participantToken");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_assignedSessionParticipantId_key" ON "EventParticipant"("assignedSessionParticipantId");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_idx" ON "EventParticipant"("eventId");

-- CreateIndex
CREATE INDEX "EventParticipant_userId_idx" ON "EventParticipant"("userId");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_userId_idx" ON "EventParticipant"("eventId", "userId");

-- CreateIndex
CREATE INDEX "EventParticipant_assignedSessionId_idx" ON "EventParticipant"("assignedSessionId");

-- CreateIndex
CREATE INDEX "EventInvite_eventId_idx" ON "EventInvite"("eventId");

-- CreateIndex
CREATE INDEX "EventInvite_userId_idx" ON "EventInvite"("userId");

-- CreateIndex
CREATE INDEX "EventInvite_invitedEmailNormalized_idx" ON "EventInvite"("invitedEmailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvite_eventId_userId_key" ON "EventInvite"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvite_eventId_invitedEmailNormalized_key" ON "EventInvite"("eventId", "invitedEmailNormalized");

-- CreateIndex
CREATE INDEX "SessionInvite_sessionId_idx" ON "SessionInvite"("sessionId");

-- CreateIndex
CREATE INDEX "SessionInvite_userId_idx" ON "SessionInvite"("userId");

-- CreateIndex
CREATE INDEX "SessionInvite_invitedEmailNormalized_idx" ON "SessionInvite"("invitedEmailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "SessionInvite_sessionId_userId_key" ON "SessionInvite"("sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionInvite_sessionId_invitedEmailNormalized_key" ON "SessionInvite"("sessionId", "invitedEmailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_sessionId_key" ON "Recording"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_sessionId_key" ON "Transcript"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_recordingId_key" ON "Transcript"("recordingId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_idx" ON "TranscriptSegment"("transcriptId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_mappedParticipantId_idx" ON "TranscriptSegment"("mappedParticipantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysis_sessionId_key" ON "AiAnalysis"("sessionId");

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_service_idx" ON "ExternalServiceEvent"("service");

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_severity_idx" ON "ExternalServiceEvent"("severity");

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_sessionId_idx" ON "ExternalServiceEvent"("sessionId");

-- CreateIndex
CREATE INDEX "ExternalServiceEvent_createdAt_idx" ON "ExternalServiceEvent"("createdAt");

-- CreateIndex
CREATE INDEX "UsageCounter_service_metric_periodStart_idx" ON "UsageCounter"("service", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "AdminActionLog_adminUserId_idx" ON "AdminActionLog"("adminUserId");

-- CreateIndex
CREATE INDEX "AdminActionLog_targetUserId_idx" ON "AdminActionLog"("targetUserId");

-- CreateIndex
CREATE INDEX "AdminActionLog_action_idx" ON "AdminActionLog"("action");

-- CreateIndex
CREATE INDEX "AdminActionLog_createdAt_idx" ON "AdminActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

-- CreateIndex
CREATE INDEX "UserConsent_consentType_idx" ON "UserConsent"("consentType");

-- CreateIndex
CREATE INDEX "SessionParticipantAudioActivity_sessionId_idx" ON "SessionParticipantAudioActivity"("sessionId");

-- CreateIndex
CREATE INDEX "SessionParticipantAudioActivity_sessionParticipantId_idx" ON "SessionParticipantAudioActivity"("sessionParticipantId");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationCase" ADD CONSTRAINT "NegotiationCase_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationCase" ADD CONSTRAINT "NegotiationCase_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRole" ADD CONSTRAINT "CaseRole_negotiationCaseId_fkey" FOREIGN KEY ("negotiationCaseId") REFERENCES "NegotiationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_negotiationCaseId_fkey" FOREIGN KEY ("negotiationCaseId") REFERENCES "NegotiationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrainingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPauseInterval" ADD CONSTRAINT "SessionPauseInterval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRole" ADD CONSTRAINT "SessionRole_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionRoleId_fkey" FOREIGN KEY ("sessionRoleId") REFERENCES "SessionRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_selectedCaseId_fkey" FOREIGN KEY ("selectedCaseId") REFERENCES "NegotiationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_facilitatorUserId_fkey" FOREIGN KEY ("facilitatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrainingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_assignedSessionId_fkey" FOREIGN KEY ("assignedSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_assignedSessionParticipantId_fkey" FOREIGN KEY ("assignedSessionParticipantId") REFERENCES "SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrainingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_mappedParticipantId_fkey" FOREIGN KEY ("mappedParticipantId") REFERENCES "SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

