import assert from "node:assert/strict";
import test from "node:test";

import {
  getRemoteTrackerBlockReason,
  isRemoteStreamTelemetryEnabled,
  simulateRemoteSpeakingIntervalLifecycle,
} from "@/lib/telemetry/voximplant-remote-speaking-tracker";
import { VOX_REMOTE_STREAM_ACTIVITY_SOURCE } from "@/lib/telemetry/audio-activity-sources";
import { buildSpeakingIntervalPayload } from "@/lib/telemetry/voximplant-speaking-tracker";

test("sustained remote speaking posts one interval in lifecycle simulation", () => {
  const result = simulateRemoteSpeakingIntervalLifecycle([
    { atMs: 0, speaking: true },
    { atMs: 2500, speaking: true },
    { atMs: 2600, speaking: false },
    { atMs: 3400, speaking: false },
  ]);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].durationMs, 3400);
});

test("brief remote speaking dip does not fragment interval", () => {
  const result = simulateRemoteSpeakingIntervalLifecycle([
    { atMs: 0, speaking: true },
    { atMs: 1800, speaking: false },
    { atMs: 1900, speaking: true },
    { atMs: 4000, speaking: false },
    { atMs: 4900, speaking: false },
  ]);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].durationMs, 4800);
});

test("remote tracker is allowed when enabled and facilitator can report", () => {
  const reason = getRemoteTrackerBlockReason({
    enabled: true,
    canReportRemoteTelemetry: true,
  });
  assert.equal(reason, null);
});

test("disabled-mode remote tracker is blocked", () => {
  const reason = getRemoteTrackerBlockReason({
    enabled: false,
    canReportRemoteTelemetry: true,
  });
  assert.equal(reason, "disabled");
});

test("remote tracker requires facilitator-capable reporter", () => {
  const reason = getRemoteTrackerBlockReason({
    enabled: true,
    canReportRemoteTelemetry: false,
  });
  assert.equal(reason, "facilitator-required");
});

test("remote telemetry capture is enabled by default", () => {
  assert.equal(isRemoteStreamTelemetryEnabled(undefined), true);
});

test("remote telemetry capture kill switch disables capture", () => {
  assert.equal(isRemoteStreamTelemetryEnabled("false"), false);
});

test("debug flag does not affect remote telemetry enablement", () => {
  assert.equal(isRemoteStreamTelemetryEnabled("1"), true);
});

test("unmount flushes open remote interval", () => {
  const result = simulateRemoteSpeakingIntervalLifecycle([
    { atMs: 0, speaking: true },
    { atMs: 1200, speaking: true },
    { atMs: 2100, speaking: true, unmount: true },
  ]);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].closeReason, "unmount");
  assert.equal(result.intervals[0].endedAtMs, 2100);
});

test("remote interval payload includes VOX_REMOTE_STREAM_ACTIVITY source", () => {
  const payload = buildSpeakingIntervalPayload({
    sessionParticipantId: "sp_remote",
    participantIdentity: "participant-a",
    startedAt: new Date("2026-07-06T19:00:00.000Z"),
    endedAt: new Date("2026-07-06T19:00:03.000Z"),
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    recordingActiveClientSide: true,
  });
  assert.equal(payload.source, VOX_REMOTE_STREAM_ACTIVITY_SOURCE);
});
