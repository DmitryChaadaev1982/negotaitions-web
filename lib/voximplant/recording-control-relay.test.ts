import assert from "node:assert/strict";
import test from "node:test";

import { resolveScenarioMessageTextForRelay } from "@/lib/voximplant/recording-control-relay";
import {
  RECORDING_CONTROL_PROTOCOL_VERSION,
  type RecordingControlMessage,
} from "@/lib/voximplant/scenario-messages";

const signedMessage: RecordingControlMessage = {
  type: "recording_control" as const,
  protocolVersion: RECORDING_CONTROL_PROTOCOL_VERSION,
  signature: "a".repeat(64),
  claims: {
    protocolVersion: RECORDING_CONTROL_PROTOCOL_VERSION,
    issuedAt: 1_784_000_000,
    expiresAt: 1_784_000_120,
    nonce: "nonce-1",
    action: "start" as const,
    requestId: "req-1",
    sessionId: "session-1",
    conferenceName: "negotiation-session-1",
    participantId: "participant-1",
    controllerUserId: "user-1",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: "https://local.negotaitions.ru",
  },
};

test("client relay prefers opaque scenarioMessageText", () => {
  const text = '{"opaque":"signed"}';
  assert.equal(
    resolveScenarioMessageTextForRelay({
      scenarioMessageText: text,
      scenarioMessage: signedMessage,
    }),
    text,
  );
});

test("client relay keeps compatibility fallback for typed message", () => {
  const resolved = resolveScenarioMessageTextForRelay({
    scenarioMessageText: "",
    scenarioMessage: signedMessage,
  });
  assert.equal(resolved, JSON.stringify(signedMessage));
});

test("client relay returns null when no payload exists", () => {
  assert.equal(resolveScenarioMessageTextForRelay({}), null);
});
