import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisStatus, TranscriptStatus } from "@/app/generated/prisma/client";
import {
  admitAiAnalysisMaterial,
  claimAiAnalysisRunWithTranscriptAuthority,
} from "@/lib/ai/analysis-transcript-admission";

type TranscriptRow = {
  id: string;
  sessionId: string;
  status: TranscriptStatus;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string;
  speakerMapping: Record<string, string>;
  retranscribeCount: number;
  processingMetadata: Record<string, unknown>;
  segments: Array<{
    orderIndex: number;
    speakerLabel: string | null;
    mappedParticipantId: string | null;
    mappedParticipant: { id: string; displayName: string } | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
  }>;
};

type AnalysisRow = {
  id: string;
  sessionId: string;
  status: AiAnalysisStatus;
  runToken: string | null;
  leaseExpiresAt: Date | null;
  providerResponseId: string | null;
  transcriptId: string | null;
  transcriptRetranscribeCount: number;
  language: string | null;
  inputFingerprint: string | null;
  updatedAt: Date;
};

function usableTranscript(overrides?: Partial<TranscriptRow>): TranscriptRow {
  return {
    id: "tr-1",
    sessionId: "session-1",
    status: TranscriptStatus.COMPLETED,
    text: "hello from buyer",
    diarizedText: "Buyer: hello from buyer",
    language: "ru",
    transcriptionModel: "general:rc",
    hasSpeakerDiarization: true,
    speakerMappingStatus: "CONFIRMED",
    speakerMapping: { speaker_1: "buyer" },
    retranscribeCount: 7,
    processingMetadata: {},
    segments: [
      {
        orderIndex: 0,
        speakerLabel: "speaker_1",
        mappedParticipantId: "buyer",
        mappedParticipant: { id: "buyer", displayName: "Buyer" },
        startSeconds: 0,
        endSeconds: 1,
        text: "hello from buyer",
      },
    ],
    ...overrides,
  };
}

function sessionGraph(transcript: TranscriptRow) {
  return {
    id: "session-1",
    title: "Session",
    roomLabel: null,
    status: "FINISHED",
    snapshotCaseTitle: "Case",
    snapshotCaseLanguage: "RU",
    snapshotPublicInstructions: "public",
    snapshotBusinessContext: "biz",
    preparationDurationSeconds: 60,
    durationSeconds: 60,
    startedAt: null,
    endedAt: null,
    negotiationStartedAt: null,
    negotiationEndedAt: null,
    sequenceNumber: 1,
    event: null,
    sessionRoles: [],
    participants: [
      {
        id: "buyer",
        displayName: "Buyer",
        type: "PARTICIPANT",
        notes: "",
        sessionRole: { name: "Buyer" },
      },
    ],
    recording: { startedAt: null, endedAt: null },
    transcript,
  };
}

function createAdmissionClient(params: {
  transcript: TranscriptRow | null;
  analysis: AnalysisRow | null;
}) {
  const created: AnalysisRow[] = [];
  const tx = {
    transcript: {
      findUnique: async (args?: { where?: { sessionId?: string; id?: string } }) => {
        if (!params.transcript) return null;
        if (args?.where?.sessionId && args.where.sessionId !== params.transcript.sessionId) {
          return null;
        }
        if (args?.where?.id && args.where.id !== params.transcript.id) {
          return null;
        }
        return params.transcript;
      },
      update: async () => params.transcript,
    },
    session: {
      findFirst: async () =>
        params.transcript ? sessionGraph(params.transcript) : null,
    },
    aiAnalysis: {
      findUnique: async () => params.analysis,
      create: async (args: { data: Record<string, unknown> }) => {
        const row: AnalysisRow = {
          id: "analysis-1",
          sessionId: String(args.data.sessionId),
          status: AiAnalysisStatus.QUEUED,
          runToken: String(args.data.runToken),
          leaseExpiresAt: args.data.leaseExpiresAt as Date,
          providerResponseId: null,
          transcriptId: String(args.data.transcriptId),
          transcriptRetranscribeCount: Number(args.data.transcriptRetranscribeCount),
          language: String(args.data.language),
          inputFingerprint:
            typeof args.data.inputFingerprint === "string"
              ? args.data.inputFingerprint
              : null,
          updatedAt: args.data.startedAt as Date,
        };
        created.push(row);
        params.analysis = row;
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
  };
  const client = {
    $transaction: async <T>(callback: (inner: typeof tx) => Promise<T>) => callback(tx),
  };
  return { client, created };
}

test("AI claim rejects while enhancement publicationEligible is true", async () => {
  const { client, created } = createAdmissionClient({
    transcript: usableTranscript({
      processingMetadata: {
        transcriptEnhancement: {
          executionStatus: "RUNNING",
          publicationEligible: true,
        },
      },
    }),
    analysis: null,
  });
  const result = await claimAiAnalysisRunWithTranscriptAuthority({
    sessionId: "session-1",
    transcriptId: "tr-1",
    transcriptRetranscribeCount: 0,
    language: "ru",
    client: client as never,
  });
  assert.equal(result.state, "enhancement_in_flight");
  assert.equal(created.length, 0);
});

test("AI claim uses locked transcript generation and persists fingerprint at claim", async () => {
  const { client, created } = createAdmissionClient({
    transcript: usableTranscript({
      processingMetadata: {
        transcriptEnhancement: {
          executionStatus: "CANCELLED_FOR_PUBLICATION",
          publicationEligible: false,
        },
      },
    }),
    analysis: null,
  });
  const result = await admitAiAnalysisMaterial({
    sessionId: "session-1",
    transcriptId: "tr-1",
    language: "ru",
    client: client as never,
  });
  assert.equal(result.state, "claimed");
  if (result.state !== "claimed") return;
  assert.equal(created[0]?.transcriptRetranscribeCount, 7);
  assert.equal(created[0]?.transcriptId, "tr-1");
  assert.equal(result.inputFingerprint, created[0]?.inputFingerprint);
  assert.match(result.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.analysisContext.transcript?.text, "hello from buyer");
  assert.equal(
    result.analysisContext.transcript?.segments[0]?.mappedParticipantId,
    "buyer",
  );
});

test("AI admission rejects a mismatched transcriptId before constructing context", async () => {
  const { client, created } = createAdmissionClient({
    transcript: usableTranscript(),
    analysis: null,
  });
  const result = await admitAiAnalysisMaterial({
    sessionId: "session-1",
    transcriptId: "stale-transcript",
    language: "ru",
    client: client as never,
  });
  assert.equal(result.state, "transcript_missing");
  assert.equal(created.length, 0);
});
