import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignedControlHeaders,
  signControlFields,
  verifyControlSignature,
} from "@/lib/voximplant/poc/control-signature";

const secret = "poc-control-secret-value-32chars!!";

test("valid signature accepted", () => {
  const body = JSON.stringify({ action: "ping" });
  const signed = buildSignedControlHeaders({
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-1",
    secret,
    body,
  });
  const result = verifyControlSignature({
    ...signed.fields,
    signature: signed.signature,
    secret,
  });
  assert.equal(result.ok, true);
});

test("invalid signature rejected", () => {
  const body = JSON.stringify({ action: "ping" });
  const signed = buildSignedControlHeaders({
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-1",
    secret,
    body,
  });
  const result = verifyControlSignature({
    ...signed.fields,
    signature: "00".repeat(32),
    secret,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "invalid_signature");
});

test("expired timestamp rejected", () => {
  const body = "{}";
  const signed = buildSignedControlHeaders({
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-1",
    secret,
    body,
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const result = verifyControlSignature({
    ...signed.fields,
    signature: signed.signature,
    secret,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "expired_timestamp");
});

test("replayed nonce rejected", () => {
  const body = "{}";
  const signed = buildSignedControlHeaders({
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-1",
    secret,
    body,
    nonce: "fixed-nonce-1",
  });
  const first = verifyControlSignature({
    ...signed.fields,
    signature: signed.signature,
    secret,
    seenNonces: new Set(),
  });
  assert.equal(first.ok, true);
  const second = verifyControlSignature({
    ...signed.fields,
    signature: signed.signature,
    secret,
    seenNonces: new Set(["fixed-nonce-1"]),
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.errorCode, "replayed_nonce");
});

test("unknown action rejected", () => {
  const fields = {
    version: "v1",
    action: "delete_everything" as "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-1",
    timestamp: new Date().toISOString(),
    nonce: "n1",
    bodyHash: "abc",
  };
  const signature = signControlFields(
    { ...fields, action: "ping" },
    secret,
  );
  const result = verifyControlSignature({
    ...fields,
    signature,
    secret,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "unknown_action");
});
