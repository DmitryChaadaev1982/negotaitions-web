import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpeakingIntervalPayload,
  getTrackerBlockReason,
  postSpeakingInterval,
  simulateSpeakingIntervalLifecycle,
} from "@/lib/telemetry/voximplant-speaking-tracker";
import { VOXIMPLANT_MIC_ACTIVITY_SOURCE } from "@/lib/telemetry/audio-activity-sources";

test("tracker can post while recordingActiveClientSide is false", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchMock: typeof fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const payload = buildSpeakingIntervalPayload({
    sessionParticipantId: "sp_123",
    participantIdentity: "participant-a",
    startedAt: new Date("2026-07-05T20:56:15.000Z"),
    endedAt: new Date("2026-07-05T20:56:16.000Z"),
    recordingActiveClientSide: false,
    audioProcessingEnabled: true,
  });

  const result = await postSpeakingInterval({
    fetchImpl: fetchMock,
    sessionId: "cmr-session",
    roomAuth: { type: "account", participantId: "sp_123" },
    payload,
  });

  assert.equal(result.ok, true);
  assert.equal(requestUrl, "/api/sessions/cmr-session/audio-activity");
  assert.equal(payload.event, "speaking_interval");
  assert.equal(payload.source, VOXIMPLANT_MIC_ACTIVITY_SOURCE);
  assert.equal(payload.telemetryCalibration.recordingActiveClientSide, false);
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.credentials, "same-origin");
});

test("missing local stream blocks posting with diagnostic reason", () => {
  const reason = getTrackerBlockReason({
    enabled: true,
    localAudioStreamPresent: false,
    sessionParticipantId: "sp_123",
  });
  assert.equal(reason, "local-stream-missing");
});

test("missing participant id blocks posting with diagnostic reason", () => {
  const reason = getTrackerBlockReason({
    enabled: true,
    localAudioStreamPresent: true,
    sessionParticipantId: null,
  });
  assert.equal(reason, "participant-id-missing");
});

test("sustained 5s speaking produces one realistic interval", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 5000, micLevel: 20 },
    { atMs: 5001, micLevel: 0 },
    { atMs: 5801, micLevel: 0 },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].durationMs, 5801);
});

test("brief dip below off threshold does not split interval", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 2000, micLevel: 20 },
    { atMs: 2100, micLevel: 3 },
    { atMs: 2200, micLevel: 20 },
    { atMs: 5000, micLevel: 20 },
    { atMs: 5001, micLevel: 0 },
    { atMs: 5801, micLevel: 0 },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].durationMs, 5801);
});

test("silence longer than debounce closes exactly once", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 4000, micLevel: 20 },
    { atMs: 4001, micLevel: 0 },
    { atMs: 4300, micLevel: 0 },
    { atMs: 4801, micLevel: 0 },
    { atMs: 6000, micLevel: 0, rerender: true },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].endedAtMs, 4801);
  assert.equal(result.intervals[0].closeReason, "silence_debounce");
});

test("muted schedules debounced close without fragment churn", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 3000, micLevel: 20 },
    { atMs: 3001, micLevel: 20, muted: true },
    { atMs: 3500, micLevel: 20, muted: true },
    { atMs: 3801, micLevel: 20, muted: true },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].closeReason, "muted");
  assert.equal(result.intervals[0].endedAtMs, 3801);
});

test("ordinary rerender ticks do not flush open interval", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 1000, micLevel: 20, rerender: true },
    { atMs: 2000, micLevel: 20, rerender: true },
    { atMs: 3000, micLevel: 20, rerender: true },
    { atMs: 3500, micLevel: 0 },
    { atMs: 4300, micLevel: 0 },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].durationMs, 4300);
});

test("true unmount flushes open interval once", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 1500, micLevel: 20 },
    { atMs: 2500, micLevel: 20, unmount: true },
    { atMs: 2600, micLevel: 20, unmount: true },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].closeReason, "unmount");
  assert.equal(result.intervals[0].endedAtMs, 2500);
});

test("block transition flushes open interval once", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 1200, micLevel: 20 },
    { atMs: 1800, micLevel: 20, blocked: true },
    { atMs: 2200, micLevel: 20, blocked: true },
  ]);

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].closeReason, "block_transition");
  assert.equal(result.intervals[0].endedAtMs, 1800);
});

test("sub-50ms intervals are skipped and never persisted", () => {
  const result = simulateSpeakingIntervalLifecycle([
    { atMs: 0, micLevel: 20 },
    { atMs: 10, micLevel: 0, blocked: true },
  ]);

  assert.equal(result.intervals.length, 0);
  assert.equal(result.skippedShortIntervalCount, 1);
});
