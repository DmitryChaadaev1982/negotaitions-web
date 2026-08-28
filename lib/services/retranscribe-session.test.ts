import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RecordingStatus, TranscriptStatus } from "@/app/generated/prisma/client";
import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import {
  SOURCE_RECORDING_NOT_AVAILABLE_CODE,
  SourceRecordingNotAvailableError,
} from "@/lib/services/source-recording-not-available";
import { executeAuthorizedRetranscribe } from "@/lib/services/retranscribe-session";
import type { AdmitTranscriptionRunResult } from "@/lib/services/transcription-run-claim";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

type HistoricalSnapshot = {
  recordingStatus: RecordingStatus;
  fileKey: string;
  recordingErrorMessage: string | null;
  transcriptStatus: TranscriptStatus;
  transcriptText: string;
  diarizedText: string;
  segments: Array<{ text: string }>;
  speakerMapping: unknown;
  speakerMappingStatus: string;
  processingMetadata: unknown;
  retranscribeCount: number;
  retranscribeHistory: unknown[];
  analysisGeneration: number;
  analysisCurrent: boolean;
  publicationActive: boolean;
  grantsActive: boolean;
  visibility: string;
  sharedPayload: unknown;
  notes: string;
};

function createHistoricalSnapshot(): HistoricalSnapshot {
  return {
    recordingStatus: RecordingStatus.COMPLETED,
    fileKey: "voximplant/audio/session/file.mp4",
    recordingErrorMessage: null,
    transcriptStatus: TranscriptStatus.COMPLETED,
    transcriptText: "saved transcript",
    diarizedText: "[Speaker 1] saved transcript",
    segments: [{ text: "saved transcript" }],
    speakerMapping: { speaker_1: "participant-1" },
    speakerMappingStatus: "CONFIRMED",
    processingMetadata: { pauseProcessing: { mode: "source_audio_cut" } },
    retranscribeCount: 2,
    retranscribeHistory: [{ version: 1 }],
    analysisGeneration: 0,
    analysisCurrent: true,
    publicationActive: true,
    grantsActive: true,
    visibility: "PUBLISHED",
    sharedPayload: { summary: "shared" },
    notes: "participant note",
  };
}

function cloneSnapshot(snapshot: HistoricalSnapshot): HistoricalSnapshot {
  return structuredClone(snapshot);
}

function assertSnapshotUnchanged(
  before: HistoricalSnapshot,
  after: HistoricalSnapshot,
) {
  assert.deepEqual(after, before);
}

function createRecording() {
  return {
    id: "rec-1",
    recordingAttemptId: "attempt-1",
    fileKey: "voximplant/audio/session/file.mp4",
    fileName: "file.mp4",
    mimeType: "audio/mp4",
    startedAt: new Date("2026-08-01T10:00:00.000Z"),
    endedAt: new Date("2026-08-01T10:10:00.000Z"),
  };
}

function claimedAdmit(): AdmitTranscriptionRunResult {
  const startedAt = new Date("2026-08-28T10:00:00.000Z");
  return {
    kind: "claimed",
    transcript: {
      id: "tr-1",
      status: TranscriptStatus.QUEUED,
      text: "saved transcript",
      startedAt,
      retranscribeCount: 3,
    },
    generation: {
      transcriptId: "tr-1",
      startedAt,
      retranscribeCount: 3,
    },
    archiveEntry: {
      archivedAt: startedAt.toISOString(),
      reason: "manual_rerun",
      version: 2,
      status: "COMPLETED",
      text: "saved transcript",
      diarizedText: "[Speaker 1] saved transcript",
      language: "ru",
      transcriptionModel: "speechkit",
      hasSpeakerDiarization: true,
      diarizationStatus: "COMPLETED",
      speakerMapping: { speaker_1: "participant-1" },
      speakerMappingStatus: "CONFIRMED",
      completedAt: startedAt.toISOString(),
      processingMetadata: {},
    },
  };
}

function mutateOnAdmit(snapshot: HistoricalSnapshot) {
  snapshot.retranscribeCount += 1;
  snapshot.retranscribeHistory = [
    ...snapshot.retranscribeHistory,
    { version: snapshot.retranscribeCount },
  ];
  snapshot.transcriptStatus = TranscriptStatus.QUEUED;
  snapshot.publicationActive = false;
  snapshot.grantsActive = false;
  snapshot.analysisCurrent = false;
  snapshot.visibility = "FACILITATOR_ONLY";
  snapshot.sharedPayload = null;
}

test("S324A-RT-01 missing source before retranscribe returns controlled error and leaves transcript history unchanged", async () => {
  const before = createHistoricalSnapshot();
  const after = cloneSnapshot(before);
  let admitCalls = 0;
  let executeCalls = 0;

  const response = await executeAuthorizedRetranscribe({
    sessionId: "session-1",
    recording: createRecording(),
    language: "auto",
    deps: {
      isMockMode: () => false,
      preload: async () => {
        throw new SourceRecordingNotAvailableError();
      },
      admit: async () => {
        admitCalls += 1;
        mutateOnAdmit(after);
        return claimedAdmit();
      },
      execute: async () => {
        executeCalls += 1;
        return NextResponse.json({ ok: true });
      },
      restoreFailedRetranscription: async () => undefined,
    },
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error:
      "The original recording file is unavailable, so retranscription cannot be started. The saved transcript and AI analysis remain available.",
    code: SOURCE_RECORDING_NOT_AVAILABLE_CODE,
  });
  assert.equal(admitCalls, 0);
  assert.equal(executeCalls, 0);
  assert.equal(after.retranscribeCount, before.retranscribeCount);
  assert.deepEqual(after.retranscribeHistory, before.retranscribeHistory);
  assert.equal(after.transcriptStatus, before.transcriptStatus);
  assert.equal(after.transcriptText, before.transcriptText);
});

test("S324A-RT-02 missing source leaves Recording COMPLETED, fileKey, and errorMessage unchanged", async () => {
  const before = createHistoricalSnapshot();
  const after = cloneSnapshot(before);

  await executeAuthorizedRetranscribe({
    sessionId: "session-1",
    recording: createRecording(),
    language: "auto",
    deps: {
      isMockMode: () => false,
      preload: async () => {
        throw Object.assign(new Error("missing"), {
          name: "NoSuchKey",
          $metadata: { httpStatusCode: 404 },
        });
      },
      admit: async () => {
        after.recordingStatus = RecordingStatus.FAILED;
        after.recordingErrorMessage = "Файл записи не найден в хранилище";
        return claimedAdmit();
      },
      execute: async () => NextResponse.json({ ok: true }),
      restoreFailedRetranscription: async () => undefined,
    },
  });

  assert.equal(after.recordingStatus, RecordingStatus.COMPLETED);
  assert.equal(after.fileKey, before.fileKey);
  assert.equal(after.recordingErrorMessage, before.recordingErrorMessage);
});

test("S324A-RT-03 missing source does not touch AI currentness, publication, grants, or notes", async () => {
  const before = createHistoricalSnapshot();
  const after = cloneSnapshot(before);

  const response = await executeAuthorizedRetranscribe({
    sessionId: "session-1",
    recording: createRecording(),
    language: "auto",
    deps: {
      isMockMode: () => false,
      preload: async () => {
        throw new SourceRecordingNotAvailableError();
      },
      admit: async () => {
        mutateOnAdmit(after);
        return claimedAdmit();
      },
      execute: async () => NextResponse.json({ ok: true }),
      restoreFailedRetranscription: async () => undefined,
    },
  });

  assert.equal(response.status, 409);
  assertSnapshotUnchanged(before, after);

  const currentness = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: "gen0-hash",
      transcriptId: "transcript-1",
      transcriptRetranscribeCount: after.retranscribeCount,
    },
    currentFingerprint: "gen0-hash",
    transcriptId: "transcript-1",
    transcriptRetranscribeCount: after.retranscribeCount,
  });
  assert.equal(currentness.current, true);
  assert.equal(after.publicationActive, true);
  assert.equal(after.grantsActive, true);
  assert.equal(after.visibility, "PUBLISHED");
  assert.deepEqual(after.sharedPayload, { summary: "shared" });
  assert.equal(after.notes, "participant note");
});

test("S324A-RT-04 GET NotFound after optional HEAD success does not admit", async () => {
  const after = createHistoricalSnapshot();
  let admitCalls = 0;
  let headCalls = 0;
  let getCalls = 0;

  const response = await executeAuthorizedRetranscribe({
    sessionId: "session-1",
    recording: createRecording(),
    language: "auto",
    deps: {
      isMockMode: () => false,
      preload: async ({ download }) => {
        headCalls += 1;
        getCalls += 1;
        assert.equal(download, undefined);
        throw Object.assign(new Error("The specified key does not exist."), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      },
      admit: async () => {
        admitCalls += 1;
        mutateOnAdmit(after);
        return claimedAdmit();
      },
      execute: async () => NextResponse.json({ ok: true }),
      restoreFailedRetranscription: async () => undefined,
    },
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, SOURCE_RECORDING_NOT_AVAILABLE_CODE);
  assert.equal(admitCalls, 0);
  assert.equal(getCalls, 1);
  assert.equal(headCalls, 1);
  assert.equal(after.retranscribeCount, 2);
  assert.equal(after.transcriptStatus, TranscriptStatus.COMPLETED);
});

test("S324A-RT-05 storage timeout during preload is not SOURCE_RECORDING_NOT_AVAILABLE and does not admit", async () => {
  const after = createHistoricalSnapshot();
  let admitCalls = 0;

  const response = await executeAuthorizedRetranscribe({
    sessionId: "session-1",
    recording: createRecording(),
    language: "auto",
    deps: {
      isMockMode: () => false,
      preload: async () => {
        throw Object.assign(new Error("Request timed out"), {
          name: "TimeoutError",
        });
      },
      admit: async () => {
        admitCalls += 1;
        mutateOnAdmit(after);
        return claimedAdmit();
      },
      execute: async () => NextResponse.json({ ok: true }),
      restoreFailedRetranscription: async () => undefined,
    },
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.notEqual(body.code, SOURCE_RECORDING_NOT_AVAILABLE_CODE);
  assert.equal(body.error, "Request timed out");
  assert.equal(admitCalls, 0);
  assert.equal(after.retranscribeCount, 2);
  assert.equal(after.publicationActive, true);
});

test("S324A-RT-06 successful preload admits once, invalidates downstream, and reuses bytes without a second GET", async () => {
  const after = createHistoricalSnapshot();
  const preloaded = {
    fileKey: "voximplant/audio/session/file.mp4",
    buffer: Buffer.from("preloaded-audio"),
  };
  let admitCalls = 0;
  let executeCalls = 0;
  let getCalls = 0;
  let seenPreloaded: Buffer | null = null;

  const response = await executeAuthorizedRetranscribe({
    sessionId: "session-1",
    recording: createRecording(),
    language: "auto",
    reason: "manual_rerun",
    deps: {
      isMockMode: () => false,
      preload: async () => {
        getCalls += 1;
        return preloaded;
      },
      admit: async (input) => {
        admitCalls += 1;
        assert.equal(input.mode, "retranscribe");
        mutateOnAdmit(after);
        return claimedAdmit();
      },
      execute: async (input) => {
        executeCalls += 1;
        seenPreloaded = input.preloadedRecordingSource?.buffer ?? null;
        return NextResponse.json({ ok: true, reused: true });
      },
      restoreFailedRetranscription: async () => undefined,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(admitCalls, 1);
  assert.equal(executeCalls, 1);
  assert.equal(getCalls, 1);
  assert.equal(seenPreloaded, preloaded.buffer);
  assert.equal(after.retranscribeCount, 3);
  assert.equal(after.analysisCurrent, false);
  assert.equal(after.publicationActive, false);
  assert.equal(after.grantsActive, false);

  const runnerSource = readFileSync(
    join(ROOT, "lib/services/transcription-runner.ts"),
    "utf8",
  );
  assert.match(runnerSource, /preloadedRecordingSource/);
  assert.match(runnerSource, /resolveTranscriptionRecordingSource/);
  assert.doesNotMatch(runnerSource, /downloadObjectToBuffer/);
  assert.doesNotMatch(runnerSource, /headObject\(/);
});
