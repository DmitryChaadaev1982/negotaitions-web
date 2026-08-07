import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisStatus,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import {
  computeShouldPoll,
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
      true,
      true,
      true,
      false,
      false,
    ),
    true,
  );
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

test("participant debrief polling stops once shared analysis is available", () => {
  const pendingShare = computeShouldPoll(
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
  const shared = computeShouldPoll(
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

  assert.equal(pendingShare, true);
  assert.equal(shared, false);
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
