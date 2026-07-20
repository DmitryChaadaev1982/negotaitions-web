import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executePocPing } from "@/lib/voximplant/poc/ping-command";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  writePocState,
  type PocCallbackEventRecord,
} from "@/lib/voximplant/poc/poc-state";

const secret = "poc-control-secret-16+";

function writeActiveState(cwd: string) {
  let state = createEmptyPocState({
    pocId: "poc-ping",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "hist-1",
    mediaSessionAccessUrl: "https://example.invalid/session/token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/token",
    ruleId: "9175667",
    applicationId: "1",
    startedAt: new Date().toISOString(),
    idleTtlMs: 60_000,
    stateRoot: cwd,
  });
  writePocState(state, cwd);
  return state;
}

test("6. matching signed callback confirms ping", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-ping-"));
  writeActiveState(cwd);
  const callback: PocCallbackEventRecord = {
    eventType: "command_accepted",
    action: "ping",
    operationId: "op-confirm",
    conferenceName: "neg-poc-server-stop-1",
    callSessionHistoryId: "hist-1",
    recorderState: "absent",
    errorCode: null,
    receivedAt: new Date().toISOString(),
    signatureVerified: true,
  };
  const result = await executePocPing({
    operationId: "op-confirm",
    secret,
    cwd,
    fetchImpl: async () => new Response("", { status: 200 }),
    waitForCallback: async () => callback,
  });
  assert.equal(result.transport.transportOutcome, "TRANSPORT_ACCEPTED");
  assert.equal(result.pingOutcome, "PING_COMMAND_CONFIRMED");
  assert.equal(result.transport.commandConfirmed, true);
});

test("9. wrong operationId does not confirm", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-ping-"));
  writeActiveState(cwd);
  const result = await executePocPing({
    operationId: "op-expected",
    secret,
    cwd,
    fetchImpl: async () => new Response("", { status: 200 }),
    waitForCallback: async () => ({
      eventType: "command_accepted",
      action: "ping",
      operationId: "op-other",
      conferenceName: "neg-poc-server-stop-1",
      callSessionHistoryId: null,
      recorderState: "absent",
      errorCode: null,
      receivedAt: new Date().toISOString(),
      signatureVerified: true,
    }),
  });
  assert.equal(result.pingOutcome, "PING_CALLBACK_REJECTED");
  assert.equal(result.transport.commandConfirmed, false);
});

test("ping callback timeout", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-ping-"));
  writeActiveState(cwd);
  const result = await executePocPing({
    operationId: "op-timeout",
    secret,
    cwd,
    callbackWaitMs: 50,
    callbackPollMs: 10,
    fetchImpl: async () => new Response("", { status: 200 }),
    waitForCallback: async () => null,
  });
  assert.equal(result.pingOutcome, "PING_CALLBACK_TIMEOUT");
});

test("--no-wait is transport-only non-terminal", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-ping-"));
  writeActiveState(cwd);
  const result = await executePocPing({
    operationId: "op-nowait",
    secret,
    cwd,
    noWait: true,
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  assert.equal(result.pingOutcome, "PING_TRANSPORT_ONLY");
  assert.equal(result.nonTerminal, true);
  assert.equal(result.transport.commandConfirmed, false);
});

test("17. expired local session refuses before reuse", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-ping-"));
  let state = createEmptyPocState({
    pocId: "poc-exp",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "hist-1",
    mediaSessionAccessUrl: "https://example.invalid/session/token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/token",
    ruleId: "9175667",
    applicationId: "1",
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    idleTtlMs: 60_000,
    stateRoot: cwd,
  });
  writePocState(state, cwd);

  let fetchCalls = 0;
  const result = await executePocPing({
    operationId: "op-expired",
    secret,
    cwd,
    nowMs: Date.now(),
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("", { status: 200 });
    },
  });
  assert.equal(result.transport.transportOutcome, "MEDIA_SESSION_EXPIRED");
  assert.equal(result.runtimeStatus, "EXPIRED");
  assert.equal(fetchCalls, 0);
});
