import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePocControlResponse,
  sendPocControlCommand,
  verifyPocControlScenarioIdentity,
} from "@/lib/voximplant/poc/control-command";
import { PocSafetyError } from "@/lib/voximplant/poc/poc-safety";

const secret = "poc-control-secret-16+";

test("parsePocControlResponse captures scenario identity fields", () => {
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
  assert.equal(parsed.protocolVersion, 1);
});

test("ping rejects missing scenarioKind", () => {
  assert.throws(
    () =>
      verifyPocControlScenarioIdentity({
        ok: true,
        action: "ping",
        operationId: "op-1",
        state: "absent",
        errorCode: null,
        scenarioKind: null,
        protocolVersion: 1,
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("ping rejects wrong scenarioKind", () => {
  assert.throws(
    () =>
      verifyPocControlScenarioIdentity({
        ok: true,
        action: "ping",
        operationId: "op-1",
        state: "absent",
        errorCode: null,
        scenarioKind: "production_main_room",
        protocolVersion: 1,
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("ping rejects wrong protocolVersion", () => {
  assert.throws(
    () =>
      verifyPocControlScenarioIdentity({
        ok: true,
        action: "ping",
        operationId: "op-1",
        state: "absent",
        errorCode: null,
        scenarioKind: "voximplant_server_stop_poc",
        protocolVersion: 99,
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("ping accepts dedicated POC scenario identity", () => {
  assert.doesNotThrow(() =>
    verifyPocControlScenarioIdentity({
      ok: true,
      action: "ping",
      operationId: "op-1",
      state: "absent",
      errorCode: null,
      scenarioKind: "voximplant_server_stop_poc",
      protocolVersion: 1,
    }),
  );
});

test("sendPocControlCommand ping rejects production-like identity before success", async () => {
  const controlUrl = "https://example.invalid/session/FULL-CONTROL-SECRET";
  await assert.rejects(
    () =>
      sendPocControlCommand({
        controlUrl,
        action: "ping",
        conferenceName: "neg-poc-server-stop-1",
        operationId: "op-ping-1",
        secret,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              action: "ping",
              operationId: "op-ping-1",
              state: "absent",
              errorCode: null,
            }),
            { status: 200 },
          ),
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("sendPocControlCommand ping accepts dedicated identity", async () => {
  const controlUrl = "https://example.invalid/session/FULL-CONTROL-SECRET";
  const result = await sendPocControlCommand({
    controlUrl,
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-ping-2",
    secret,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          action: "ping",
          operationId: "op-ping-2",
          state: "absent",
          errorCode: null,
          scenarioKind: "voximplant_server_stop_poc",
          protocolVersion: 1,
        }),
        { status: 200 },
      ),
  });
  assert.equal(result.response?.ok, true);
  assert.equal(result.response?.scenarioKind, "voximplant_server_stop_poc");
  assert.ok(!result.controlUrlFingerprint.includes("FULL-CONTROL-SECRET"));
  assert.ok(!JSON.stringify(result).includes("FULL-CONTROL-SECRET"));
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

test("full control URL does not appear in command output surfaces", async () => {
  const controlUrl = "https://example.invalid/session/NEVER-PRINT-THIS-TOKEN";
  const result = await sendPocControlCommand({
    controlUrl,
    action: "ping",
    conferenceName: "neg-poc-server-stop-1",
    operationId: "op-ping-3",
    secret,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          action: "ping",
          operationId: "op-ping-3",
          state: "absent",
          errorCode: null,
          scenarioKind: "voximplant_server_stop_poc",
          protocolVersion: 1,
        }),
        { status: 200 },
      ),
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("NEVER-PRINT-THIS-TOKEN"));
  assert.ok(!serialized.includes(controlUrl));
});
