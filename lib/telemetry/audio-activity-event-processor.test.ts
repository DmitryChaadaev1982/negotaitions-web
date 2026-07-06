import assert from "node:assert/strict";
import test from "node:test";

import {
  processAudioActivityEvent,
  type AudioActivityRepository,
} from "@/lib/telemetry/audio-activity-event-processor";
import { VOXIMPLANT_MIC_ACTIVITY_SOURCE } from "@/lib/telemetry/audio-activity-sources";

function createRepo() {
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const repo: AudioActivityRepository = {
    findRecordingWindow: async () => ({
      startedAt: new Date("2026-07-05T20:56:12.000Z"),
      endedAt: new Date("2026-07-05T20:58:12.000Z"),
    }),
    createActivity: async (data) => {
      creates.push(data as unknown as Record<string, unknown>);
    },
    findLatestOpenActivity: async () => null,
    updateActivity: async (id, data) => {
      updates.push({ id, ...data });
    },
  };
  return { repo, creates, updates };
}

test("accepts valid speaking_interval payload and persists row", async () => {
  const { repo, creates } = createRepo();
  const result = await processAudioActivityEvent(repo, {
    sessionId: "cmr-session",
    event: "speaking_interval",
    resolvedSessionParticipantId: "sp_1",
    sessionParticipantId: "sp_1",
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    startedAt: "2026-07-05T20:56:20.000Z",
    endedAt: "2026-07-05T20:56:23.200Z",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, "interval_recorded");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].sessionParticipantId, "sp_1");
  assert.equal(creates[0].source, VOXIMPLANT_MIC_ACTIVITY_SOURCE);
  assert.equal(creates[0].startedOffsetSeconds, 8);
  assert.equal(creates[0].endedOffsetSeconds, 11.2);
});

test("clamps partially outside intervals to recording window", async () => {
  const { repo, creates } = createRepo();
  const result = await processAudioActivityEvent(repo, {
    sessionId: "cmr-session",
    event: "speaking_interval",
    resolvedSessionParticipantId: "sp_1",
    sessionParticipantId: "sp_1",
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    startedAt: "2026-07-05T20:56:00.000Z",
    endedAt: "2026-07-05T20:56:14.500Z",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, "interval_recorded");
  assert.equal(creates.length, 1);
  assert.equal((creates[0].startedAt as Date).toISOString(), "2026-07-05T20:56:12.000Z");
  assert.equal((creates[0].endedAt as Date).toISOString(), "2026-07-05T20:56:14.500Z");
  assert.equal(creates[0].startedOffsetSeconds, 0);
  assert.equal(creates[0].endedOffsetSeconds, 2.5);
});

test("rejects speaking_interval fully outside recording window", async () => {
  const { repo, creates } = createRepo();
  const result = await processAudioActivityEvent(repo, {
    sessionId: "cmr-session",
    event: "speaking_interval",
    resolvedSessionParticipantId: "sp_1",
    sessionParticipantId: "sp_1",
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    startedAt: "2026-07-05T21:00:00.000Z",
    endedAt: "2026-07-05T21:00:04.000Z",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "interval_outside_recording_window");
  assert.equal(creates.length, 0);
});

test("rejects invalid sessionParticipantId mismatch", async () => {
  const { repo, creates } = createRepo();
  const result = await processAudioActivityEvent(repo, {
    sessionId: "cmr-session",
    event: "speaking_interval",
    resolvedSessionParticipantId: "sp_2",
    sessionParticipantId: "sp_1",
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    startedAt: "2026-07-05T20:56:20.000Z",
    endedAt: "2026-07-05T20:56:21.000Z",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid_session_participant_id");
  assert.equal(result.httpStatus, 403);
  assert.equal(creates.length, 0);
});

test("accepts speaking_interval without body participant id when resolved by auth", async () => {
  const { repo, creates } = createRepo();
  const result = await processAudioActivityEvent(repo, {
    sessionId: "cmr-session",
    event: "speaking_interval",
    resolvedSessionParticipantId: "sp_from_auth",
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    startedAt: "2026-07-05T20:56:20.000Z",
    endedAt: "2026-07-05T20:56:21.000Z",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, "interval_recorded");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].sessionParticipantId, "sp_from_auth");
});
