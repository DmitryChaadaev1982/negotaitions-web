import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisStatus,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import {
  canOfferRetranscribe,
  computeShouldPoll,
  hasRunningRawTranscription,
  isStaleStartingRecording,
  MATERIALS_POLL_INTERVAL_DEFAULT_MS,
  MATERIALS_POLL_INTERVAL_FAST_STARTING_MS,
  resolveMaterialsNextPollMs,
  resolveTranscriptProcessingStage,
  STALE_RECORDING_STARTING_TIMEOUT_SECONDS,
} from "@/lib/materials-status-readiness";

test("raw transcript remains ready while enhancement is pending", () => {
  const stage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "IN_PROGRESS",
  );

  assert.equal(stage, "ready");
  assert.equal(
    computeShouldPoll(
      RecordingStatus.COMPLETED,
      true,
      TranscriptStatus.COMPLETED,
      true,
      null,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
    ),
    true,
  );
});

test("enhancement running does not make raw transcription cancellable", () => {
  assert.equal(hasRunningRawTranscription(TranscriptStatus.COMPLETED), false);
  assert.equal(hasRunningRawTranscription(TranscriptStatus.TRANSCRIBING), true);

  const shouldPoll = computeShouldPoll(
    RecordingStatus.COMPLETED,
    true,
    TranscriptStatus.COMPLETED,
    true,
    null,
    false,
    true,
    hasRunningRawTranscription(TranscriptStatus.COMPLETED),
  );

  assert.equal(shouldPoll, true);
});

test("enhancement completed reaches terminal ready stage", () => {
  const stage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "COMPLETED",
  );

  assert.equal(stage, "ready");
  assert.equal(
    computeShouldPoll(
      RecordingStatus.COMPLETED,
      true,
      TranscriptStatus.COMPLETED,
      false,
      null,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
    ),
    false,
  );
});

test("enhancement partial still keeps transcript ready", () => {
  const stage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "PARTIAL",
  );

  assert.equal(stage, "ready");
});

test("enhancement failed with retained transcript keeps readiness", () => {
  const stage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "FAILED",
  );

  assert.equal(stage, "ready");
});

test("no-grant participant polls while processing is pending", () => {
  assert.equal(
    computeShouldPoll(
      RecordingStatus.COMPLETED,
      true,
      TranscriptStatus.COMPLETED,
      false,
      AiAnalysisStatus.ANALYZING,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
    ),
    true,
  );
});

test("no-grant participant stops polling after terminal processing failure", () => {
  assert.equal(
    computeShouldPoll(
      RecordingStatus.COMPLETED,
      true,
      TranscriptStatus.COMPLETED,
      false,
      AiAnalysisStatus.FAILED,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
    ),
    false,
  );
});

test("current completed AI keeps no-grant polling through obsolete upstream failures", () => {
  for (const [recordingStatus, transcriptStatus] of [
    [RecordingStatus.FAILED, TranscriptStatus.COMPLETED],
    [RecordingStatus.COMPLETED, TranscriptStatus.FAILED],
  ] as const) {
    assert.equal(
      computeShouldPoll(
        recordingStatus,
        true,
        transcriptStatus,
        false,
        AiAnalysisStatus.COMPLETED,
        true,
        true,
        false,
        true,
        true,
        false,
        false,
        true,
      ),
      true,
    );
  }
});

test("stale completed AI does not override terminal upstream failure", () => {
  assert.equal(
    computeShouldPoll(
      RecordingStatus.FAILED,
      true,
      TranscriptStatus.COMPLETED,
      false,
      AiAnalysisStatus.COMPLETED,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
    ),
    false,
  );
});

test("participant polling waits for Publish and stays active after a grant so Unshare can be observed", () => {
  const completedWithoutGrant = computeShouldPoll(
    RecordingStatus.COMPLETED,
    true,
    TranscriptStatus.COMPLETED,
    false,
    AiAnalysisStatus.COMPLETED,
    true,
    true,
    false,
    true,
    true,
    false,
    false,
  );
  const granted = computeShouldPoll(
    RecordingStatus.COMPLETED,
    true,
    TranscriptStatus.COMPLETED,
    false,
    AiAnalysisStatus.COMPLETED,
    true,
    true,
    false,
    true,
    true,
    true,
    false,
  );

  assert.equal(completedWithoutGrant, true);
  assert.equal(granted, true);
});

test("stale STARTING recording is detected when no provider artifact appears", () => {
  const now = new Date("2026-07-28T13:10:00.000Z");
  const startedAt = new Date(
    now.getTime() - (STALE_RECORDING_STARTING_TIMEOUT_SECONDS + 1) * 1000,
  );
  assert.equal(
    isStaleStartingRecording({
      status: RecordingStatus.STARTING,
      startedAt,
      egressId: null,
      now,
    }),
    true,
  );
});

test("STARTING recording with provider artifact is not stale", () => {
  const now = new Date("2026-07-28T13:10:00.000Z");
  const startedAt = new Date(
    now.getTime() - (STALE_RECORDING_STARTING_TIMEOUT_SECONDS + 5) * 1000,
  );
  assert.equal(
    isStaleStartingRecording({
      status: RecordingStatus.STARTING,
      startedAt,
      egressId: "provider-recorder-id",
      now,
    }),
    false,
  );
});

test("STARTING recording inside timeout window is not stale", () => {
  const now = new Date("2026-07-28T13:10:00.000Z");
  const startedAt = new Date(now.getTime() - 20 * 1000);
  assert.equal(
    isStaleStartingRecording({
      status: RecordingStatus.STARTING,
      startedAt,
      egressId: null,
      now,
    }),
    false,
  );
});

test("materials polling switches to fast interval during STARTING only", () => {
  assert.equal(
    resolveMaterialsNextPollMs(RecordingStatus.STARTING, true),
    MATERIALS_POLL_INTERVAL_FAST_STARTING_MS,
  );
  assert.equal(
    resolveMaterialsNextPollMs(RecordingStatus.RECORDING, true),
    MATERIALS_POLL_INTERVAL_DEFAULT_MS,
  );
  assert.equal(
    resolveMaterialsNextPollMs(RecordingStatus.FAILED, true),
    MATERIALS_POLL_INTERVAL_DEFAULT_MS,
  );
  assert.equal(resolveMaterialsNextPollMs(RecordingStatus.STARTING, false), null);
});

test("retranscribe remains offered from lifecycle-ready recording even if storage object is gone", () => {
  assert.equal(
    canOfferRetranscribe({
      canRunTranscription: true,
      hasRunningTranscription: false,
      transcriptCompleted: true,
      recordingLifecycleReady: true,
      hasFileKey: true,
    }),
    true,
  );
});
