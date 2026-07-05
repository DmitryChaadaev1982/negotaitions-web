import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpeakingIntervalPayload,
  getTrackerBlockReason,
  postSpeakingInterval,
} from "@/lib/telemetry/voximplant-speaking-tracker";

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
