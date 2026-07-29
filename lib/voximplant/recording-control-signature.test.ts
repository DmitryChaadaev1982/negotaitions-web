import assert from "node:assert/strict";
import test from "node:test";

import {
  VOX_RECORDING_CONTROL_CLOCK_SKEW_SECONDS,
  VOX_RECORDING_CONTROL_PROTOCOL_VERSION,
  buildRecordingControlCanonicalPayload,
  createSignedRecordingControlMessage,
  normalizeRecordingWebhookOrigin,
  verifySignedRecordingControlMessage,
  type RecordingControlSignedMessage,
} from "@/lib/voximplant/recording-control-signature";

const SECRET = "recording-control-secret-0123456789";
const BASE_TIME = 1_784_000_000;

function buildSignedMessage(overrides?: {
  webhookBaseUrl?: string;
  action?: "start" | "pause" | "resume" | "stop" | "status";
}) {
  return createSignedRecordingControlMessage({
    secret: SECRET,
    action: overrides?.action ?? "start",
    requestId: "req-001",
    sessionId: "session-001",
    conferenceName: "negotiation-session-001",
    participantId: "participant-001",
    controllerUserId: "user-001",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: overrides?.webhookBaseUrl ?? "https://local.negotaitions.ru",
    nonce: "nonce-001",
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 90,
  });
}

function cloneMessage(message: RecordingControlSignedMessage): RecordingControlSignedMessage {
  return JSON.parse(JSON.stringify(message)) as RecordingControlSignedMessage;
}

test("local runtime signs local callback origin", () => {
  const signed = buildSignedMessage({ webhookBaseUrl: "https://local.negotaitions.ru" });
  assert.equal(signed.message.claims.webhookBaseUrl, "https://local.negotaitions.ru");
  assert.equal(signed.message.claims.protocolVersion, VOX_RECORDING_CONTROL_PROTOCOL_VERSION);
  assert.equal(signed.message.protocolVersion, VOX_RECORDING_CONTROL_PROTOCOL_VERSION);
});

test("production runtime signs production callback origin", () => {
  const signed = buildSignedMessage({ webhookBaseUrl: "https://negotaitions.ru" });
  assert.equal(signed.message.claims.webhookBaseUrl, "https://negotaitions.ru");
});

test("one unchanged verifier accepts local and production messages", () => {
  const local = buildSignedMessage({ webhookBaseUrl: "https://local.negotaitions.ru" });
  const production = buildSignedMessage({
    webhookBaseUrl: "https://negotaitions.ru",
    action: "stop",
  });
  assert.equal(
    verifySignedRecordingControlMessage({
      message: local.message,
      secret: SECRET,
      nowSeconds: BASE_TIME + 10,
    }).ok,
    true,
  );
  assert.equal(
    verifySignedRecordingControlMessage({
      message: production.message,
      secret: SECRET,
      nowSeconds: BASE_TIME + 10,
    }).ok,
    true,
  );
});

test("exact issuedAt timestamp is accepted", () => {
  const signed = buildSignedMessage();
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME,
  });
  assert.equal(result.ok, true);
});

test("future issuedAt within skew (11 seconds) is accepted", () => {
  const signed = createSignedRecordingControlMessage({
    secret: SECRET,
    action: "start",
    requestId: "req-future-11",
    sessionId: "session-001",
    conferenceName: "negotiation-session-001",
    participantId: "participant-001",
    controllerUserId: "user-001",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: "https://local.negotaitions.ru",
    nonce: "nonce-future-11",
    issuedAt: BASE_TIME + 11,
    expiresAt: BASE_TIME + 101,
  });
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME,
  });
  assert.equal(result.ok, true);
});

test("future issuedAt at skew boundary is accepted", () => {
  const signed = createSignedRecordingControlMessage({
    secret: SECRET,
    action: "start",
    requestId: "req-future-30",
    sessionId: "session-001",
    conferenceName: "negotiation-session-001",
    participantId: "participant-001",
    controllerUserId: "user-001",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: "https://local.negotaitions.ru",
    nonce: "nonce-future-30",
    issuedAt: BASE_TIME + VOX_RECORDING_CONTROL_CLOCK_SKEW_SECONDS,
    expiresAt: BASE_TIME + 110,
  });
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME,
  });
  assert.equal(result.ok, true);
});

test("future issuedAt beyond skew is rejected as not yet valid", () => {
  const signed = createSignedRecordingControlMessage({
    secret: SECRET,
    action: "start",
    requestId: "req-future-31",
    sessionId: "session-001",
    conferenceName: "negotiation-session-001",
    participantId: "participant-001",
    controllerUserId: "user-001",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: "https://local.negotaitions.ru",
    nonce: "nonce-future-31",
    issuedAt: BASE_TIME + VOX_RECORDING_CONTROL_CLOCK_SKEW_SECONDS + 1,
    expiresAt: BASE_TIME + 110,
  });
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME,
  });
  assert.deepEqual(result, { ok: false, reason: "CLAIMS_NOT_YET_VALID" });
});

test("canonical payload uses deterministic key order", () => {
  const signed = buildSignedMessage();
  const canonical = buildRecordingControlCanonicalPayload(signed.message.claims);
  assert.equal(
    canonical,
    [
      "protocolVersion=rc2-hmac-sha256-v1",
      `issuedAt=${BASE_TIME}`,
      `expiresAt=${BASE_TIME + 90}`,
      "nonce=nonce-001",
      "action=start",
      "requestId=req-001",
      "sessionId=session-001",
      "conferenceName=negotiation-session-001",
      "participantId=participant-001",
      "controllerUserId=user-001",
      "controllerRole=facilitator",
      "canControlRecording=true",
      "webhookBaseUrl=https://local.negotaitions.ru",
    ].join("\n"),
  );
});

test("action tampering fails signature verification", () => {
  const signed = buildSignedMessage();
  const tampered = cloneMessage(signed.message);
  tampered.claims.action = "stop";
  const result = verifySignedRecordingControlMessage({
    message: tampered,
    secret: SECRET,
    nowSeconds: BASE_TIME + 10,
  });
  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_INVALID" });
});

test("requestId/sessionId/conferenceName tampering fails signature verification", () => {
  const signed = buildSignedMessage();
  const fields: Array<"requestId" | "sessionId" | "conferenceName"> = [
    "requestId",
    "sessionId",
    "conferenceName",
  ];

  for (const field of fields) {
    const tampered = cloneMessage(signed.message);
    tampered.claims[field] = `${tampered.claims[field]}-tampered`;
    const result = verifySignedRecordingControlMessage({
      message: tampered,
      secret: SECRET,
      nowSeconds: BASE_TIME + 10,
    });
    assert.deepEqual(result, { ok: false, reason: "SIGNATURE_INVALID" });
  }
});

test("participant/controller identity tampering fails signature verification", () => {
  const signed = buildSignedMessage();
  const participantTampered = cloneMessage(signed.message);
  participantTampered.claims.participantId = "participant-evil";

  const controllerTampered = cloneMessage(signed.message);
  controllerTampered.claims.controllerUserId = "user-evil";

  assert.deepEqual(
    verifySignedRecordingControlMessage({
      message: participantTampered,
      secret: SECRET,
      nowSeconds: BASE_TIME + 10,
    }),
    { ok: false, reason: "SIGNATURE_INVALID" },
  );
  assert.deepEqual(
    verifySignedRecordingControlMessage({
      message: controllerTampered,
      secret: SECRET,
      nowSeconds: BASE_TIME + 10,
    }),
    { ok: false, reason: "SIGNATURE_INVALID" },
  );
});

test("callback origin tampering fails signature verification", () => {
  const signed = buildSignedMessage();
  const tampered = cloneMessage(signed.message);
  tampered.claims.webhookBaseUrl = "https://negotaitions.ru";
  const result = verifySignedRecordingControlMessage({
    message: tampered,
    secret: SECRET,
    nowSeconds: BASE_TIME + 10,
  });
  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_INVALID" });
});

test("allowlist rejects arbitrary https domain", () => {
  assert.equal(normalizeRecordingWebhookOrigin("https://example.org"), null);
  assert.throws(
    () =>
      createSignedRecordingControlMessage({
        secret: SECRET,
        action: "start",
        requestId: "req-001",
        sessionId: "session-001",
        conferenceName: "negotiation-session-001",
        participantId: "participant-001",
        controllerUserId: "user-001",
        controllerRole: "facilitator",
        canControlRecording: true,
        webhookBaseUrl: "https://example.org",
      }),
    /Invalid webhookBaseUrl/,
  );
});

test("allowlist rejects http, localhost, loopback and .local", () => {
  const invalidOrigins = [
    "http://negotaitions.ru",
    "https://localhost",
    "https://127.0.0.1",
    "https://test.local",
    "https://local.negotaitions.ru/api/sessions",
    "https://local.negotaitions.ru?x=1",
    "https://local.negotaitions.ru#frag",
    "https://user:pass@local.negotaitions.ru",
  ];

  for (const origin of invalidOrigins) {
    assert.equal(normalizeRecordingWebhookOrigin(origin), null);
  }
});

test("expired command within skew is accepted", () => {
  const signed = buildSignedMessage();
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME + 120,
  });
  assert.equal(result.ok, true);
});

test("expired command beyond skew fails verification", () => {
  const signed = buildSignedMessage();
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME + 121,
  });
  assert.deepEqual(result, { ok: false, reason: "CLAIMS_EXPIRED" });
});

test("skew window does not allow substantially old command", () => {
  const signed = buildSignedMessage();
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: SECRET,
    nowSeconds: BASE_TIME + 1000,
  });
  assert.deepEqual(result, { ok: false, reason: "CLAIMS_EXPIRED" });
});

test("invalid signature fails verification", () => {
  const signed = buildSignedMessage();
  const tampered = cloneMessage(signed.message);
  tampered.signature = "deadbeef";
  const result = verifySignedRecordingControlMessage({
    message: tampered,
    secret: SECRET,
    nowSeconds: BASE_TIME + 10,
  });
  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_INVALID" });
});

test("missing secret fails closed", () => {
  const signed = buildSignedMessage();
  const result = verifySignedRecordingControlMessage({
    message: signed.message,
    secret: "",
    nowSeconds: BASE_TIME + 10,
  });
  assert.deepEqual(result, { ok: false, reason: "SECRET_MISSING" });
});
