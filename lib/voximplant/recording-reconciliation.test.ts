import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { RECORDING_STARTING_TIMEOUT_RECONCILED } from "@/lib/voximplant/recording-status-fencing";

type Reconcile = typeof import("@/lib/voximplant/recording-reconciliation")["maybeReconcileVoximplantRecordingAttempt"];

let reconcile: Reconcile | null = null;

async function loadReconciliationService(): Promise<Reconcile> {
  if (reconcile) return reconcile;
  const requireForTest = createRequire(`${process.cwd()}/package.json`);
  const moduleInternals = requireForTest("node:module") as {
    _load: (
      request: string,
      parent: unknown,
      isMain: boolean,
    ) => unknown;
  };
  const originalLoad = moduleInternals._load;
  moduleInternals._load = function loadWithServerOnlyShim(
    request,
    parent,
    isMain,
  ) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    reconcile = (
      await import("@/lib/voximplant/recording-reconciliation")
    ).maybeReconcileVoximplantRecordingAttempt;
    return reconcile;
  } finally {
    moduleInternals._load = originalLoad;
  }
}

const now = new Date("2026-08-12T14:03:30.000Z");

function recordingRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "recording-a",
    provider: "VOXIMPLANT",
    status: RecordingStatus.STARTING,
    recordingAttemptId: "attempt-a",
    errorMessage: null,
    startedAt: null,
    updatedAt: new Date(now.getTime() - 91_000),
    stopOperation: null,
    session: {
      voximplantControlChannel: {
        providerSessionId: "provider-session-a",
        conferenceName: "conf_session-a",
        controlUrl: "https://example.invalid/control",
        controlUrlFingerprint: "f".repeat(64),
      },
    },
    ...overrides,
  };
}

function config() {
  return {
    mode: "prefer_server_no_relay_fallback" as const,
    enabled: true,
    controlSecret: "test-control-secret",
    callbackSecret: "test-callback-secret",
    controlTimeoutMs: 1_000,
    callbackReplayWindowSeconds: 300,
    terminalTimeoutSeconds: 90,
  };
}

test("lost RECORDING callback is recovered from exact provider attempt status", async () => {
  const maybeReconcileVoximplantRecordingAttempt =
    await loadReconciliationService();
  const row = recordingRow();
  const updateCalls: unknown[] = [];
  const prismaClient = {
    recording: {
      findUnique: async () => row,
      updateMany: async (input: unknown) => {
        updateCalls.push(input);
        return { count: 1 };
      },
    },
  };
  const appliedInputs: Array<{
    payload: {
      recordingAttemptId?: string | null;
      recordingId?: string | null;
    };
  }> = [];

  const result = await maybeReconcileVoximplantRecordingAttempt(
    "session-lost-callback",
    {
      now: () => now,
      prismaClient: prismaClient as never,
      getConfig: config,
      queryStatus: async () => ({
        code: "STATUS_FOUND",
        httpStatus: 200,
        attempt: {
          protocolVersion: "rc3-hmac-sha256-recording-attempt-v1",
          recordingAttemptId: "attempt-a",
          status: "recording",
          recordingUrl: null,
          recordingId: "provider-recording-a",
          objectKey: null,
          startedAt: "2026-08-12T14:01:47.780Z",
          stoppedAt: null,
          errorCode: null,
          message: null,
          terminalConfirmed: false,
        },
      }),
      applyStatus: async (input) => {
        appliedInputs.push(input);
        return {
          action: "updated",
          status: RecordingStatus.RECORDING,
          recordingId: "recording-a",
          recovered: false,
        };
      },
    },
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(result.action, "reconciled");
  assert.equal(result.status, RecordingStatus.RECORDING);
  assert.equal(appliedInputs[0]?.payload.recordingAttemptId, "attempt-a");
  assert.equal(appliedInputs[0]?.payload.recordingId, "provider-recording-a");
});

test("exact active status re-drives a due failed STOP for the same attempt", async () => {
  const maybeReconcileVoximplantRecordingAttempt =
    await loadReconciliationService();
  const row = recordingRow({
    status: RecordingStatus.FAILED,
    errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED,
    updatedAt: new Date(now.getTime() - 31_000),
    stopOperation: {
      id: "stop-a",
      state: "FAILED",
      updatedAt: new Date(now.getTime() - 31_000),
    },
  });
  const prismaClient = {
    recording: {
      findUnique: async () => row,
      updateMany: async () => ({ count: 1 }),
    },
  };
  const retries: Array<Record<string, unknown>> = [];

  const result = await maybeReconcileVoximplantRecordingAttempt(
    "session-stop-retry",
    {
      now: () => now,
      prismaClient: prismaClient as never,
      getConfig: config,
      queryStatus: async () => ({
        code: "STATUS_FOUND",
        httpStatus: 200,
        attempt: {
          protocolVersion: "rc3-hmac-sha256-recording-attempt-v1",
          recordingAttemptId: "attempt-a",
          status: "recording",
          recordingUrl: null,
          recordingId: "provider-recording-a",
          objectKey: null,
          startedAt: "2026-08-12T14:01:47.780Z",
          stoppedAt: null,
          errorCode: null,
          message: null,
          terminalConfirmed: false,
        },
      }),
      applyStatus: async () => ({
        action: "updated",
        status: RecordingStatus.RECORDING,
        recordingId: "recording-a",
        recovered: true,
      }),
      retryStop: async (input) => {
        retries.push(input);
        return {
          state: "DELIVERING",
          warning: null,
          fallbackScenarioMessage: null,
        };
      },
    },
  );

  assert.equal(result.status, RecordingStatus.RECORDING);
  assert.deepEqual(retries, [
    {
      sessionId: "session-stop-retry",
      operationRowId: "stop-a",
      recordingAttemptId: "attempt-a",
      now,
    },
  ]);
});

test("unavailable exact status produces bounded callback-loss uncertainty", async () => {
  const maybeReconcileVoximplantRecordingAttempt =
    await loadReconciliationService();
  const row = recordingRow();
  let updateCount = 0;
  const prismaClient = {
    recording: {
      findUnique: async () => row,
      updateMany: async () => {
        updateCount += 1;
        return { count: 1 };
      },
    },
  };

  const result = await maybeReconcileVoximplantRecordingAttempt(
    "session-status-unavailable",
    {
      now: () => now,
      prismaClient: prismaClient as never,
      getConfig: config,
      queryStatus: async () => ({
        code: "TRANSPORT_APPLICATION_REJECTED",
        httpStatus: 409,
        scenarioCode: "recording_attempt_unknown",
      }),
    },
  );

  assert.equal(updateCount, 2);
  assert.equal(result.action, "recoverable_uncertainty");
  assert.equal(result.status, RecordingStatus.FAILED);
  assert.equal(result.recordingAttemptId, "attempt-a");
});
