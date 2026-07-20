import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePocControlResponse,
  sendPocControlCommand,
} from "@/lib/voximplant/poc/control-command";

const secret = "poc-control-secret-16+";

test("1. empty HTTP 200 => TRANSPORT_ACCEPTED", async () => {
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/token",
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-empty",
    secret,
    fetchImpl: async () => new Response("", { status: 200 }),
  });
  assert.equal(result.transportOutcome, "TRANSPORT_ACCEPTED");
  assert.equal(result.responseBodyPresent, false);
  assert.equal(result.commandConfirmed, false);
});

test("2. non-JSON HTTP 200 => TRANSPORT_ACCEPTED", async () => {
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/token",
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-text",
    secret,
    fetchImpl: async () => new Response("ok", { status: 200 }),
  });
  assert.equal(result.transportOutcome, "TRANSPORT_ACCEPTED");
  assert.equal(result.responseJsonParsed, false);
  assert.equal(result.commandConfirmed, false);
});

test("3. HTTP non-2xx => TRANSPORT_REJECTED", async () => {
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/token",
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-401",
    secret,
    fetchImpl: async () => new Response("nope", { status: 401 }),
  });
  assert.equal(result.transportOutcome, "TRANSPORT_REJECTED");
});

test("4. timeout => TRANSPORT_TIMEOUT", async () => {
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/token",
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-timeout",
    secret,
    timeoutMs: 20,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  });
  assert.equal(result.transportOutcome, "TRANSPORT_TIMEOUT");
});

test("5. HTTP 200 alone does not confirm command", async () => {
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/token",
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-no-confirm",
    secret,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          action: "ping",
          operationId: "op-no-confirm",
          scenarioKind: "voximplant_server_stop_poc",
          protocolVersion: 1,
        }),
        { status: 200 },
      ),
  });
  assert.equal(result.transportOutcome, "TRANSPORT_ACCEPTED");
  assert.equal(result.commandConfirmed, false);
});

test("empty/non-JSON 200 does not throw UNEXPECTED_SCENARIO_IDENTITY", async () => {
  await assert.doesNotReject(() =>
    sendPocControlCommand({
      controlUrl: "https://example.invalid/session/token",
      action: "ping",
      conferenceName: "neg-poc-server-stop-1",
      operationId: "op-no-identity",
      secret,
      fetchImpl: async () => new Response("", { status: 200 }),
    }),
  );
});

test("parsePocControlResponse still parses optional body fields", () => {
  const parsed = parsePocControlResponse({
    ok: true,
    action: "ping",
    operationId: "op-1",
    state: "absent",
    errorCode: null,
    scenarioKind: "voximplant_server_stop_poc",
    protocolVersion: 1,
  });
  assert.equal(parsed.scenarioKind, "voximplant_server_stop_poc");
});

test("dry-run control command performs no network call", async () => {
  let fetchCalls = 0;
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/FULL-CONTROL-SECRET",
    action: "ping",
    conferenceName: "neg-poc-server-stop-dry",
    operationId: "op-dry",
    secret,
    dryRun: true,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network should not be called");
    },
  });
  assert.equal(result.dryRun, true);
  assert.equal(fetchCalls, 0);
  assert.ok(!result.controlUrlFingerprint.includes("FULL-CONTROL-SECRET"));
});

test("17. expired media session produces MEDIA_SESSION_EXPIRED", async () => {
  const result = await sendPocControlCommand({
    controlUrl: "https://example.invalid/session/token",
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-expired",
    secret,
    mediaSessionExpired: true,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  assert.equal(result.transportOutcome, "MEDIA_SESSION_EXPIRED");
});

test("full control URL does not appear in command output surfaces", async () => {
  const controlUrl = "https://example.invalid/session/NEVER-PRINT-THIS-TOKEN";
  const result = await sendPocControlCommand({
    controlUrl,
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-ping-3",
    secret,
    fetchImpl: async () => new Response("", { status: 200 }),
  });
  const serialized = JSON.stringify({
    ...result,
    requestHeaders: undefined,
  });
  assert.ok(!serialized.includes("NEVER-PRINT-THIS-TOKEN"));
  assert.ok(!serialized.includes(controlUrl));
});
