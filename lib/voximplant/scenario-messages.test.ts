import assert from "node:assert/strict";
import test from "node:test";

import {
  RECORDING_CONTROL_PROTOCOL_VERSION,
  createRecordingControlMessage,
  isRecordingControlMessage,
  parseScenarioMessage,
  type RecordingControlSignedClaims,
} from "@/lib/voximplant/scenario-messages";

const signedClaims: RecordingControlSignedClaims = {
  protocolVersion: RECORDING_CONTROL_PROTOCOL_VERSION,
  issuedAt: 1_784_000_000,
  expiresAt: 1_784_000_120,
  nonce: "nonce-001",
  action: "start" as const,
  requestId: "req-001",
  sessionId: "session-001",
  conferenceName: "negotiation-session-001",
  participantId: "participant-001",
  controllerUserId: "user-001",
  controllerRole: "facilitator",
  canControlRecording: true,
  webhookBaseUrl: "https://local.negotaitions.ru",
};

test("createRecordingControlMessage builds signed envelope shape", () => {
  const message = createRecordingControlMessage({
    claims: signedClaims,
    signature: "a".repeat(64),
  });

  assert.equal(message.type, "recording_control");
  assert.equal(message.protocolVersion, RECORDING_CONTROL_PROTOCOL_VERSION);
  assert.equal(message.claims.requestId, "req-001");
  assert.equal(isRecordingControlMessage(message), true);
});

test("parseScenarioMessage accepts JSON signed recording_control message", () => {
  const raw = JSON.stringify(
    createRecordingControlMessage({
      claims: signedClaims,
      signature: "b".repeat(64),
    }),
  );
  const parsed = parseScenarioMessage(raw);
  assert.ok(parsed);
  assert.equal(parsed?.type, "recording_control");
  if (parsed && parsed.type === "recording_control") {
    assert.equal(parsed.claims.action, "start");
    assert.equal(parsed.claims.webhookBaseUrl, "https://local.negotaitions.ru");
  }
});

test("parseScenarioMessage rejects legacy unsigned recording_control shape", () => {
  const parsed = parseScenarioMessage(
    JSON.stringify({
      type: "recording_control",
      action: "start",
      requestId: "req-001",
      sessionId: "session-001",
    }),
  );
  assert.equal(parsed, null);
});

test("parseScenarioMessage continues to accept recording_status shape", () => {
  const parsed = parseScenarioMessage(
    JSON.stringify({
      type: "recording_status",
      status: "recording",
      requestId: "req-001",
      message: "ok",
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed?.type, "recording_status");
});
