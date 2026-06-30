/**
 * Stage 5.4.8 — Voximplant recording debug diagnostics API tests.
 *
 * Tests the /api/debug/recording/[sessionId] endpoint at the API level.
 * Does NOT depend on real Voximplant — uses the smoke endpoint and
 * a simulated (HMAC-signed) webhook.
 *
 * Run:
 *   RECORDING_DEBUG_PANEL=true npx playwright test tests/e2e/voximplant-recording-debug.spec.ts
 *
 * Skip conditions:
 *   - The test suite checks that the debug endpoint is available and skips
 *     individual tests with `test.skip` if RECORDING_DEBUG_PANEL is not set.
 *   - Real Voximplant is never required.
 *   - Real webhook signing is tested only when VOXIMPLANT_RECORDING_WEBHOOK_SECRET is set.
 */

import { createHmac } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, createE2eCase, query } from "./helpers/db";

// ─── Fixture: create a minimal session for the debug test ─────────────────────

async function createDebugFixtureSession(): Promise<string> {
  const kase = await createE2eCase();

  const facilitatorRows = await query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" = 'demo@example.com' LIMIT 1`,
  );
  const facilitatorId = facilitatorRows[0]?.id;
  if (!facilitatorId) throw new Error("Demo facilitator not found in DB");

  const sessionId = `e2e-debug-${Date.now()}`;
  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "preparationDurationSeconds", "durationSeconds", "updatedAt")
     VALUES ($1, $2, $3, 'E2E Debug Recording Session', $4,
        'E2E debug ctx', 'E2E debug instructions', 'EN', 300, 900, NOW())`,
    [sessionId, kase.id, facilitatorId, kase.title],
  );

  return sessionId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signWebhookBody(bodyStr: string, secret: string): string {
  return `hmac-sha256=${createHmac("sha256", secret).update(Buffer.from(bodyStr, "utf-8")).digest("hex")}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Voximplant recording debug API", () => {
  test.describe.configure({ mode: "serial" });

  let sessionId: string;

  test.beforeAll(async () => {
    sessionId = await createDebugFixtureSession();
  });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  // ── Test 1: endpoint returns 404 when debug panel is not enabled ─────────────
  test("debug endpoint returns 404 when RECORDING_DEBUG_PANEL is not set", async ({
    request,
  }) => {
    // The playwright webServer does NOT set RECORDING_DEBUG_PANEL, so this should 404.
    const res = await request.get(`/api/debug/recording/${sessionId}`);
    expect(res.status()).toBe(404);
  });
});

// ─── Tests that require RECORDING_DEBUG_PANEL=true ────────────────────────────
// These tests run only when RECORDING_DEBUG_PANEL is explicitly enabled
// (e.g. local dev or dedicated CI step with that env var).

test.describe("Voximplant recording debug API (panel enabled)", () => {
  test.describe.configure({ mode: "serial" });

  let sessionId: string;

  test.beforeAll(async () => {
    sessionId = await createDebugFixtureSession();
  });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  test("GET returns diagnostic snapshot shape", async ({ request }) => {
    test.skip(
      process.env.RECORDING_DEBUG_PANEL !== "true",
      "Skipped: RECORDING_DEBUG_PANEL is not set to 'true'",
    );

    const res = await request.get(`/api/debug/recording/${sessionId}`);
    expect(res.status()).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.sessionId).toBe(sessionId);
    expect(typeof body.env).toBe("object");
    expect(typeof body.db).toBe("object");
    expect(Array.isArray(body.expectedPipeline)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);

    const env = body.env as Record<string, unknown>;
    expect(env.diagnosticsEnabled).toBe(true);
    // webhookSecret is never exposed
    expect(env.webhookSecretConfigured).toBeDefined();
    expect(typeof env.webhookSecretConfigured).toBe("boolean");
    expect(env).not.toHaveProperty("webhookSecret");

    const db = body.db as { session: unknown; recording: unknown };
    expect(db.session).toBeTruthy();
    // No recording row yet
    expect(db.recording).toBeNull();
  });

  test("POST appends a client debug event", async ({ request }) => {
    test.skip(
      process.env.RECORDING_DEBUG_PANEL !== "true",
      "Skipped: RECORDING_DEBUG_PANEL is not set to 'true'",
    );

    const eventPayload = {
      source: "client",
      level: "info",
      step: "e2e-test:append",
      message: "E2E test event from Playwright",
      data: { testRun: true },
    };

    const postRes = await request.post(`/api/debug/recording/${sessionId}`, {
      data: eventPayload,
    });
    expect(postRes.status()).toBe(200);
    expect((await postRes.json() as { ok: boolean }).ok).toBe(true);

    // Verify it appears in GET
    const getRes = await request.get(`/api/debug/recording/${sessionId}`);
    const body = (await getRes.json()) as { events: Array<{ step: string; message: string }> };
    const found = body.events.find((e) => e.step === "e2e-test:append");
    expect(found).toBeDefined();
    expect(found?.message).toBe("E2E test event from Playwright");
  });

  test("DELETE clears events for session", async ({ request }) => {
    test.skip(
      process.env.RECORDING_DEBUG_PANEL !== "true",
      "Skipped: RECORDING_DEBUG_PANEL is not set to 'true'",
    );

    // First append an event
    await request.post(`/api/debug/recording/${sessionId}`, {
      data: { source: "client", level: "info", step: "to-be-cleared", message: "temp" },
    });

    // Delete
    const delRes = await request.delete(`/api/debug/recording/${sessionId}`);
    expect(delRes.status()).toBe(200);

    // Verify cleared
    const getRes = await request.get(`/api/debug/recording/${sessionId}`);
    const body = (await getRes.json()) as { events: unknown[] };
    expect(body.events.length).toBe(0);
  });

  test("smoke endpoint creates Recording STARTING then STOPPED", async ({ request }) => {
    test.skip(
      process.env.RECORDING_DEBUG_PANEL !== "true",
      "Skipped: RECORDING_DEBUG_PANEL is not set to 'true'",
    );
    test.skip(
      process.env.VIDEO_PROVIDER !== "voximplant",
      "Skipped: VIDEO_PROVIDER is not 'voximplant'",
    );

    const debugUrl = `/api/debug/recording/${sessionId}`;

    // Start
    const startRes = await request.post(debugUrl, {
      data: { smokeAction: "start", participantId: "e2e-facilitator" },
    });
    expect(startRes.status()).toBe(200);
    const startBody = (await startRes.json()) as { ok: boolean; recording: { status: string } };
    expect(startBody.ok).toBe(true);
    expect(["STARTING", "RECORDING"]).toContain(startBody.recording.status);

    // Verify DB
    const snap1 = (await request.get(debugUrl)).json() as Promise<{
      db: { recording: { status: string; fileKeyPresent: boolean } | null };
    }>;
    const db1 = (await snap1).db;
    expect(db1.recording).toBeTruthy();
    expect(["STARTING", "RECORDING"]).toContain(db1.recording?.status);
    expect(db1.recording?.fileKeyPresent).toBe(false);

    // Stop
    const stopRes = await request.post(debugUrl, {
      data: { smokeAction: "stop", participantId: "e2e-facilitator" },
    });
    expect(stopRes.status()).toBe(200);

    // Verify DB stopped
    const snap2 = (await request.get(debugUrl)).json() as Promise<{
      db: { recording: { status: string } | null };
    }>;
    const db2 = (await snap2).db;
    expect(db2.recording?.status).toBe("STOPPED");
  });

  test("simulated signed webhook sets Recording COMPLETED with fileKey", async ({ request }) => {
    test.skip(
      process.env.RECORDING_DEBUG_PANEL !== "true",
      "Skipped: RECORDING_DEBUG_PANEL is not set to 'true'",
    );
    test.skip(
      !process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET,
      "Skipped: VOXIMPLANT_RECORDING_WEBHOOK_SECRET is not set",
    );
    test.skip(
      process.env.VIDEO_PROVIDER !== "voximplant",
      "Skipped: VIDEO_PROVIDER is not 'voximplant'",
    );

    const debugUrl = `/api/debug/recording/${sessionId}`;

    // Ensure recording is in STOPPED state first (start + stop).
    await request.post(debugUrl, { data: { smokeAction: "start", participantId: "e2e-webhook-test" } });
    await request.post(debugUrl, { data: { smokeAction: "stop", participantId: "e2e-webhook-test" } });

    // Build simulated webhook payload
    const s3Bucket = process.env.S3_BUCKET ?? "smoke-bucket";
    const fakeObjectKey = `${s3Bucket}/voximplant/audio/smoke-${sessionId}.flac`;
    const webhookPayload = {
      status: "stopped",
      requestId: "e2e-webhook-request",
      recordingId: "e2e-recorder",
      objectKey: fakeObjectKey,
      recordingUrl: `https://storage.yandexcloud.net/${fakeObjectKey}`,
      errorCode: null,
      message: "E2E smoke recording stopped.",
      stoppedAt: new Date().toISOString(),
    };

    const bodyStr = JSON.stringify(webhookPayload);
    const secret = process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET!;
    const signature = signWebhookBody(bodyStr, secret);

    const webhookRes = await request.post(
      `/api/sessions/${sessionId}/voximplant/recording-status`,
      {
        headers: { "Content-Type": "application/json", "X-Voximplant-Signature": signature },
        data: webhookPayload,
      },
    );
    expect(webhookRes.status()).toBe(200);
    const webhookBody = (await webhookRes.json()) as { ok: boolean };
    expect(webhookBody.ok).toBe(true);

    // Verify DB → COMPLETED + fileKeyPresent
    const snap3 = (await request.get(debugUrl)).json() as Promise<{
      db: { recording: { status: string; fileKeyPresent: boolean } | null };
    }>;
    const db3 = (await snap3).db;
    expect(db3.recording?.status).toBe("COMPLETED");
    expect(db3.recording?.fileKeyPresent).toBe(true);
  });
});
