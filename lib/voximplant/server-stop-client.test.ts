import assert from "node:assert/strict";
import test from "node:test";

import {
  queryVoximplantRecordingAttemptStatus,
  sendVoximplantServerStopCommand,
} from "@/lib/voximplant/server-stop-client";

const baseInput = {
  controlUrl: "https://provider.example/control/abc123",
  controlUrlFingerprint: "f".repeat(64),
  controlSecret: "server-stop-control-secret",
  timeoutMs: 50,
  operationId: "op-1",
  sessionId: "session-1",
  conferenceName: "negotiation-session-1",
  providerSessionId: "provider-1",
};

test("sendVoximplantServerStopCommand returns TRANSPORT_ACCEPTED", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: string[] = [];
  let calledUrl: URL | null = null;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    logs.push([message, ...optional].join(" "));
  };
  globalThis.fetch = async (url) => {
    calledUrl = new URL(String(url));
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };

  try {
    const result = await sendVoximplantServerStopCommand(baseInput);
    assert.equal(result.code, "TRANSPORT_ACCEPTED");
    assert.equal(result.httpStatus, 200);
    assert.ok(calledUrl);
    assert.equal(calledUrl?.origin, "https://provider.example");
    assert.equal(calledUrl?.pathname, "/control/abc123");
    assert.ok(calledUrl?.searchParams.get("x-vox-stop-protocol"));
    assert.ok(calledUrl?.searchParams.get("x-vox-stop-timestamp"));
    assert.ok(calledUrl?.searchParams.get("x-vox-stop-nonce"));
    assert.ok(calledUrl?.searchParams.get("x-vox-stop-body-sha256"));
    assert.ok(calledUrl?.searchParams.get("x-vox-stop-signature"));
    assert.ok(logs.some((line) => line.includes(baseInput.controlUrlFingerprint)));
    assert.ok(logs.every((line) => !line.includes(baseInput.controlUrl)));
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  }
});

test("sendVoximplantServerStopCommand returns TRANSPORT_TIMEOUT", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as typeof fetch;

  try {
    const result = await sendVoximplantServerStopCommand({
      ...baseInput,
      timeoutMs: 10,
    });
    assert.equal(result.code, "TRANSPORT_TIMEOUT");
    assert.equal(result.httpStatus, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendVoximplantServerStopCommand returns TRANSPORT_NETWORK_FAILED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network exploded");
  }) as typeof fetch;

  try {
    const result = await sendVoximplantServerStopCommand(baseInput);
    assert.equal(result.code, "TRANSPORT_NETWORK_FAILED");
    assert.equal(result.httpStatus, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendVoximplantServerStopCommand returns TRANSPORT_APPLICATION_REJECTED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ accepted: false, reason: "bad command" }), {
      status: 422,
    });

  try {
    const result = await sendVoximplantServerStopCommand(baseInput);
    assert.equal(result.code, "TRANSPORT_APPLICATION_REJECTED");
    assert.equal(result.httpStatus, 422);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendVoximplantServerStopCommand returns TRANSPORT_RESPONSE_INVALID", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });

  try {
    const result = await sendVoximplantServerStopCommand(baseInput);
    assert.equal(result.code, "TRANSPORT_RESPONSE_INVALID");
    assert.equal(result.httpStatus, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queryVoximplantRecordingAttemptStatus returns exact fenced attempt metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        accepted: true,
        attempt: {
          protocolVersion: "rc3-hmac-sha256-recording-attempt-v1",
          recordingAttemptId: "attempt-a",
          status: "stopped",
          recordingUrl: "https://provider.example/recording.mp4",
          recordingId: "provider-recording-a",
          objectKey: "negotiation-room/audio/a.mp4",
          startedAt: "2026-08-12T10:00:00.000Z",
          stoppedAt: "2026-08-12T10:05:00.000Z",
          errorCode: null,
          message: "Recording stopped.",
          terminalConfirmed: true,
        },
      }),
      { status: 200 },
    );
  };

  try {
    const result = await queryVoximplantRecordingAttemptStatus({
      ...baseInput,
      recordingAttemptId: "attempt-a",
    });
    assert.equal(requestBody?.action, "get_recording_status");
    assert.equal(requestBody?.recordingAttemptId, "attempt-a");
    assert.equal(result.code, "STATUS_FOUND");
    if (result.code === "STATUS_FOUND") {
      assert.equal(result.attempt.recordingAttemptId, "attempt-a");
      assert.equal(result.attempt.status, "stopped");
      assert.equal(result.attempt.terminalConfirmed, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queryVoximplantRecordingAttemptStatus preserves unknown-attempt 409", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        accepted: false,
        error: "recording_attempt_unknown",
      }),
      { status: 409 },
    );

  try {
    const result = await queryVoximplantRecordingAttemptStatus({
      ...baseInput,
      recordingAttemptId: "attempt-unknown",
    });
    assert.equal(result.code, "TRANSPORT_APPLICATION_REJECTED");
    assert.equal(result.httpStatus, 409);
    if (result.code === "TRANSPORT_APPLICATION_REJECTED") {
      assert.equal(result.scenarioCode, "recording_attempt_unknown");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queryVoximplantRecordingAttemptStatus rejects non-fenced attempt metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        accepted: true,
        attempt: {
          protocolVersion: "rc2-hmac-sha256-v1",
          recordingAttemptId: "attempt-a",
          status: "recording",
          terminalConfirmed: false,
        },
      }),
      { status: 200 },
    );

  try {
    const result = await queryVoximplantRecordingAttemptStatus({
      ...baseInput,
      recordingAttemptId: "attempt-a",
    });
    assert.equal(result.code, "TRANSPORT_RESPONSE_INVALID");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
