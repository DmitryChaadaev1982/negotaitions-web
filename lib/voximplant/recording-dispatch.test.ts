import assert from "node:assert/strict";
import test from "node:test";

import { buildSignedRecordingDispatchPayload } from "@/lib/voximplant/recording-dispatch-contract";
import { verifySignedRecordingControlMessage } from "@/lib/voximplant/recording-control-signature";

const SECRET = "recording-control-secret-0123456789";
const BASE_CONTEXT = {
  sessionId: "session-001",
  participantId: "participant-001",
  controllerUserId: "user-001",
  controllerRole: "facilitator",
  canControlRecording: true,
  requestId: "req-001",
};

test("buildVoximplantRecordingDispatch signs local callback origin", () => {
  const dispatch = buildSignedRecordingDispatchPayload({
    action: "start",
    ...BASE_CONTEXT,
    webhookBaseUrlRaw: "https://local.negotaitions.ru",
    signingSecret: SECRET,
    issuedAt: 1_784_000_000,
    expiresAt: 1_784_000_120,
    nonce: "nonce-local",
  });

  assert.equal(dispatch.scenarioMessage.claims.action, "start");
  assert.equal(dispatch.scenarioMessage.claims.webhookBaseUrl, "https://local.negotaitions.ru");
  assert.equal(dispatch.scenarioMessageText, JSON.stringify(dispatch.scenarioMessage));
  assert.equal(
    verifySignedRecordingControlMessage({
      message: dispatch.scenarioMessage,
      secret: SECRET,
      nowSeconds: 1_784_000_060,
    }).ok,
    true,
  );
});

test("buildVoximplantRecordingDispatch signs production callback origin", () => {
  const dispatch = buildSignedRecordingDispatchPayload({
    action: "stop",
    ...BASE_CONTEXT,
    webhookBaseUrlRaw: "https://negotaitions.ru",
    signingSecret: SECRET,
    issuedAt: 1_784_000_000,
    expiresAt: 1_784_000_120,
    nonce: "nonce-prod",
  });

  assert.equal(dispatch.scenarioMessage.claims.action, "stop");
  assert.equal(dispatch.scenarioMessage.claims.webhookBaseUrl, "https://negotaitions.ru");
  assert.equal(
    verifySignedRecordingControlMessage({
      message: dispatch.scenarioMessage,
      secret: SECRET,
      nowSeconds: 1_784_000_060,
    }).ok,
    true,
  );
});

test("refresh action maps to signed status action", () => {
  const dispatch = buildSignedRecordingDispatchPayload({
    action: "refresh",
    ...BASE_CONTEXT,
    webhookBaseUrlRaw: "https://negotaitions.ru",
    signingSecret: SECRET,
    issuedAt: 1_784_000_000,
    expiresAt: 1_784_000_120,
    nonce: "nonce-status",
  });

  assert.equal(dispatch.scenarioMessage.claims.action, "status");
  assert.equal(dispatch.recordingStatusPending, "NOT_STARTED");
});

test("dispatch fails closed for disallowed webhook origin", () => {
  assert.throws(
    () =>
      buildSignedRecordingDispatchPayload({
        action: "start",
        ...BASE_CONTEXT,
        webhookBaseUrlRaw: "https://example.org",
        signingSecret: SECRET,
      }),
    /Invalid effective Voximplant webhook base URL/,
  );
});
