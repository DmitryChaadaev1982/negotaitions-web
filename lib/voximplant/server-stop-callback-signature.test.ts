import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import {
  buildServerStopSignedHeaders,
  verifyServerStopCallbackSignature,
} from "@/lib/voximplant/server-stop-callback-signature";

const SECRET = "test-server-stop-secret";

function buildHeaders(headers: Record<string, string>) {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    normalized.set(key, value);
  }
  return normalized;
}

function buildScenarioStyleSignedHeaders(input: {
  secret: string;
  timestampSeconds: string;
  nonce: string;
  rawBody: Buffer;
}) {
  const protocol = "v1";
  const bodyHashHex = createHash("sha256").update(input.rawBody).digest("hex");
  const signatureHex = createHmac("sha256", input.secret)
    .update([protocol, input.timestampSeconds, input.nonce, bodyHashHex].join("\n"))
    .digest("hex");

  return {
    "x-vox-stop-protocol": protocol,
    "x-vox-stop-timestamp": input.timestampSeconds,
    "x-vox-stop-nonce": input.nonce,
    "x-vox-stop-body-sha256": bodyHashHex,
    "x-vox-stop-signature": signatureHex,
  } as const;
}

test("verifyServerStopCallbackSignature accepts valid signature", () => {
  const rawBody = Buffer.from(JSON.stringify({ eventType: "recording_stopped" }), "utf8");
  const signed = buildServerStopSignedHeaders({
    rawBody,
    secret: SECRET,
    nonce: "nonce-1",
    timestampSeconds: 1_700_000_000,
  });

  const result = verifyServerStopCallbackSignature({
    headers: buildHeaders(signed),
    rawBody,
    secret: SECRET,
    replayWindowSeconds: 300,
    now: new Date(1_700_000_000 * 1000),
  });

  assert.equal(result.ok, true);
});

test("verifyServerStopCallbackSignature rejects invalid signature", () => {
  const rawBody = Buffer.from(JSON.stringify({ eventType: "recording_stopped" }), "utf8");
  const signed = buildServerStopSignedHeaders({
    rawBody,
    secret: SECRET,
    nonce: "nonce-2",
    timestampSeconds: 1_700_000_000,
  });
  signed["x-vox-stop-signature"] = "deadbeef";

  const result = verifyServerStopCallbackSignature({
    headers: buildHeaders(signed),
    rawBody,
    secret: SECRET,
    replayWindowSeconds: 300,
    now: new Date(1_700_000_000 * 1000),
  });

  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_INVALID" });
});

test("verifyServerStopCallbackSignature rejects expired timestamp", () => {
  const rawBody = Buffer.from(JSON.stringify({ eventType: "recording_stopped" }), "utf8");
  const signed = buildServerStopSignedHeaders({
    rawBody,
    secret: SECRET,
    nonce: "nonce-3",
    timestampSeconds: 1_700_000_000,
  });

  const result = verifyServerStopCallbackSignature({
    headers: buildHeaders(signed),
    rawBody,
    secret: SECRET,
    replayWindowSeconds: 60,
    now: new Date(1_700_000_200 * 1000),
  });

  assert.deepEqual(result, { ok: false, reason: "TIMESTAMP_EXPIRED" });
});

test("verifyServerStopCallbackSignature rejects body hash mismatch", () => {
  const rawBody = Buffer.from(JSON.stringify({ eventType: "recording_stopped" }), "utf8");
  const signed = buildServerStopSignedHeaders({
    rawBody,
    secret: SECRET,
    nonce: "nonce-4",
    timestampSeconds: 1_700_000_000,
  });

  const tamperedBody = Buffer.from(
    JSON.stringify({ eventType: "recording_stop_failed" }),
    "utf8",
  );
  const result = verifyServerStopCallbackSignature({
    headers: buildHeaders(signed),
    rawBody: tamperedBody,
    secret: SECRET,
    replayWindowSeconds: 300,
    now: new Date(1_700_000_000 * 1000),
  });

  assert.deepEqual(result, { ok: false, reason: "BODY_HASH_MISMATCH" });
});

test("verifyServerStopCallbackSignature accepts scenario-style provider registration payload", () => {
  const payload = {
    eventType: "provider_session_registered",
    sessionId: "cmrufe9dx0000houa265dgdrc",
    conferenceName: "negotiation-cmrufe9dx0000houa265dgdrc",
    providerSessionId: "vox-1721550801000-abc123",
    accessSecureUrl: "https://local.negotaitions.ru/control/server-stop",
    controlUrl: "https://local.negotaitions.ru/control/server-stop",
    scenarioBuild: "main-room-server-stop-2026-07-21-s2",
    scenarioSource: "neg-conf-main-room",
    ruleIdentity: "neg-conf-server-stop-poc-rule#9175667",
  };
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signed = buildScenarioStyleSignedHeaders({
    rawBody,
    secret: SECRET,
    timestampSeconds: "1700000000",
    nonce: "vox-stop-1700000000000-ab12cd",
  });

  const result = verifyServerStopCallbackSignature({
    headers: buildHeaders(signed),
    rawBody,
    secret: SECRET,
    replayWindowSeconds: 300,
    now: new Date(1_700_000_000 * 1000),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.verified.protocolVersion, "v1");
    assert.equal(result.verified.timestampSeconds, 1_700_000_000);
    assert.equal(result.verified.nonce, "vox-stop-1700000000000-ab12cd");
  }
});
