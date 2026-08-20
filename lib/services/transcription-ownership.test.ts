import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  decideTranscriptionAdmit,
  isOwnedTranscriptionGeneration,
  isSameTranscriptionGeneration,
  shouldBindDownstreamToGeneration,
  transcriptionConflictBody,
  TRANSCRIPTION_IN_PROGRESS_CODE,
  TRANSCRIPTION_ALREADY_COMPLETED_CODE,
} from "@/lib/services/transcription-ownership";

const generation = {
  transcriptId: "tr-1",
  startedAt: new Date("2026-08-19T10:00:00.000Z"),
  retranscribeCount: 0,
};

test("F01/F02 admit rejects an active claim from either entry mode", () => {
  const decision = decideTranscriptionAdmit({
    existing: {
      id: "tr-1",
      status: TranscriptStatus.QUEUED,
      text: "",
    },
    allowCompletedOverwrite: false,
  });
  assert.deepEqual(decision, {
    kind: "already_active",
    transcriptId: "tr-1",
    status: TranscriptStatus.QUEUED,
  });
  assert.equal(
    transcriptionConflictBody(decision).code,
    TRANSCRIPTION_IN_PROGRESS_CODE,
  );
});

test("initial admit rejects a completed transcript", () => {
  const decision = decideTranscriptionAdmit({
    existing: {
      id: "tr-1",
      status: TranscriptStatus.COMPLETED,
      text: "ready",
    },
    allowCompletedOverwrite: false,
  });
  assert.equal(decision.kind, "already_completed");
  if (decision.kind === "already_completed") {
    assert.equal(
      transcriptionConflictBody(decision).code,
      TRANSCRIPTION_ALREADY_COMPLETED_CODE,
    );
  }
});

test("retranscribe/compat completed path is allowed only when overwrite is explicit", () => {
  const decision = decideTranscriptionAdmit({
    existing: {
      id: "tr-1",
      status: TranscriptStatus.COMPLETED,
      text: "ready",
    },
    allowCompletedOverwrite: true,
  });
  assert.equal(decision.kind, "admit");
});

test("F03 stale generation cannot own a newer row", () => {
  const newer = {
    id: "tr-1",
    startedAt: new Date("2026-08-19T10:05:00.000Z"),
    retranscribeCount: 1,
    status: TranscriptStatus.TRANSCRIBING,
  };
  assert.equal(isSameTranscriptionGeneration(newer, generation), false);
  assert.equal(isOwnedTranscriptionGeneration(newer, generation), false);
});

test("F04 downstream work binds only when persist applied and generation matches", () => {
  assert.equal(
    shouldBindDownstreamToGeneration({ applied: true, generationMatches: true }),
    true,
  );
  assert.equal(
    shouldBindDownstreamToGeneration({ applied: true, generationMatches: false }),
    false,
  );
  assert.equal(
    shouldBindDownstreamToGeneration({ applied: false, generationMatches: true }),
    false,
  );
});
