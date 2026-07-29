import assert from "node:assert/strict";
import test from "node:test";

import { sendVoximplantServerStopCommand } from "@/lib/voximplant/server-stop-client";

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
