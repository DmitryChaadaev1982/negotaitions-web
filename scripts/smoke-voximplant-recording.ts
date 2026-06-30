/**
 * Stage 5.4.8 — Voximplant recording smoke test.
 *
 * Validates the server-side recording lifecycle end-to-end without needing
 * a real Voximplant browser session. Uses the dev-only smoke endpoint for
 * recording-control (no browser auth required) and a simulated signed webhook.
 *
 * Requirements:
 *   - Next.js dev server running (--baseUrl default: http://localhost:3000)
 *   - RECORDING_DEBUG_PANEL=true in .env.local (enables the smoke endpoint)
 *   - A real Session row in the DB (--sessionId)
 *   - VOXIMPLANT_RECORDING_WEBHOOK_SECRET set in .env.local (for signing)
 *
 * Usage:
 *   npm run smoke:vox-recording -- --sessionId <SESSION_ID>
 *   npm run smoke:vox-recording -- --sessionId <ID> --baseUrl http://localhost:3000 --verbose
 *
 * Security note:
 *   - The webhook secret is read from the local .env.local and used only to
 *     sign the simulated request. It is NOT printed in output.
 *   - No cookies, tokens, or secrets are printed.
 */

import { loadEnvConfig } from "@next/env";
import { createHmac } from "crypto";
import { parseArgs } from "node:util";

loadEnvConfig(process.cwd());

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    sessionId: { type: "string" },
    baseUrl: { type: "string", default: "http://localhost:3000" },
    participantId: { type: "string", default: "smoke-facilitator" },
    simulateWebhook: { type: "string", default: "true" },
    verbose: { type: "boolean", default: false },
  },
});

if (!values.sessionId) {
  console.error("❌  --sessionId is required");
  console.error(
    "Usage: npm run smoke:vox-recording -- --sessionId <SESSION_ID> [--baseUrl http://localhost:3000] [--verbose]",
  );
  process.exit(1);
}

const SESSION_ID: string = values.sessionId;
const BASE_URL = (values.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
const PARTICIPANT_ID = values.participantId ?? "smoke-facilitator";
const SIMULATE_WEBHOOK = values.simulateWebhook !== "false";
const VERBOSE = values.verbose === true;

// ─── Colours ──────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function pass(msg: string) {
  console.log(`  ${C.green}✓ PASS${C.reset}  ${msg}`);
}
function fail(msg: string) {
  console.log(`  ${C.red}✗ FAIL${C.reset}  ${msg}`);
}
function info(msg: string) {
  console.log(`  ${C.cyan}·${C.reset}      ${msg}`);
}
function warn(msg: string) {
  console.log(`  ${C.yellow}⚠${C.reset}      ${msg}`);
}
function verbose(msg: string) {
  if (VERBOSE) console.log(`  ${C.dim}${msg}${C.reset}`);
}

// ─── Step tracking ────────────────────────────────────────────────────────────

type StepResult = { step: string; ok: boolean; note: string };
const results: StepResult[] = [];

function record(step: string, ok: boolean, note: string): boolean {
  results.push({ step, ok, note });
  if (ok) pass(`[${step}] ${note}`);
  else fail(`[${step}] ${note}`);
  return ok;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function postJson(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  verbose(`POST ${url} → ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}

async function postSignedJson(
  url: string,
  body: unknown,
  secret: string,
): Promise<{ status: number; data: unknown }> {
  const bodyStr = JSON.stringify(body);
  const bodyBuf = Buffer.from(bodyStr, "utf-8");
  const signature = createHmac("sha256", secret).update(bodyBuf).digest("hex");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Voximplant-Signature": `hmac-sha256=${signature}`,
    },
    body: bodyStr,
  });
  const data = await res.json().catch(() => ({}));
  verbose(`POST (signed) ${url} → ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}

async function getJson(url: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  verbose(`GET ${url} → ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.cyan}═══ Voximplant Recording Smoke Test ═══${C.reset}`);
  console.log(`  sessionId   : ${SESSION_ID}`);
  console.log(`  baseUrl     : ${BASE_URL}`);
  console.log(`  participantId: ${PARTICIPANT_ID}`);
  console.log(`  simulateWebhook: ${SIMULATE_WEBHOOK}`);

  // ── Config print ────────────────────────────────────────────────────────────
  const videoProvider = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  const scenarioName = process.env.VOXIMPLANT_SCENARIO_NAME ?? null;
  const ruleName = process.env.VOXIMPLANT_RULE_NAME ?? null;
  const webhookBaseUrl = process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL ?? null;
  const webhookSecretConfigured = Boolean(
    process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET?.trim(),
  );
  const debugPanelEnabled = process.env.RECORDING_DEBUG_PANEL === "true";
  const dbName = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.replace("/", "").split("?")[0] ?? "(unknown)"
    : "(not set)";

  console.log(`\n${C.cyan}Config:${C.reset}`);
  info(`VIDEO_PROVIDER          : ${videoProvider ?? "(not set)"}`);
  info(`VOXIMPLANT_SCENARIO_NAME: ${scenarioName ?? "(not set)"}`);
  info(`VOXIMPLANT_RULE_NAME    : ${ruleName ?? "(not set)"}`);
  info(`webhookBaseUrl          : ${webhookBaseUrl ?? "(not set)"}`);
  info(`webhookSecretConfigured : ${webhookSecretConfigured}`);
  info(`RECORDING_DEBUG_PANEL   : ${debugPanelEnabled}`);
  info(`database                : ${dbName}`);

  if (!debugPanelEnabled) {
    warn(
      "RECORDING_DEBUG_PANEL is not set to 'true'. The smoke endpoint may return 404.",
    );
    warn("Add RECORDING_DEBUG_PANEL=true to .env.local and restart the dev server.");
  }

  if (videoProvider !== "voximplant") {
    warn(`VIDEO_PROVIDER=${videoProvider ?? "(unset)"} — expected 'voximplant'`);
  }

  // ── Step 1: Check Session via debug endpoint ────────────────────────────────
  console.log(`\n${C.cyan}Steps:${C.reset}`);
  const debugUrl = `${BASE_URL}/api/debug/recording/${encodeURIComponent(SESSION_ID)}`;

  const step1 = await getJson(debugUrl);
  if (step1.status === 404) {
    record(
      "session",
      false,
      `Debug endpoint returned 404. Enable RECORDING_DEBUG_PANEL=true and restart the dev server.`,
    );
    printSummary();
    process.exit(1);
  }

  const debugData = step1.data as { db?: { session?: unknown } };
  const sessionExists = Boolean(debugData?.db?.session);
  if (!record("session-exists", sessionExists, `Session ${SESSION_ID} exists in DB`)) {
    warn("Cannot continue — session not found. Provide a valid --sessionId.");
    printSummary();
    process.exit(1);
  }

  // ── Clear previous smoke events ─────────────────────────────────────────────
  await fetch(debugUrl, { method: "DELETE" });
  info("Cleared previous debug events.");

  // ── Step 2: POST recording-control start (via smoke endpoint) ───────────────
  const startResult = await postJson(debugUrl, {
    smokeAction: "start",
    participantId: PARTICIPANT_ID,
  });

  const startData = startResult.data as {
    ok?: boolean;
    recording?: { id?: string; status?: string };
    error?: string;
  };

  if (startResult.status !== 200 || !startData.ok) {
    record(
      "start-api",
      false,
      `recording-control start failed: HTTP ${startResult.status} — ${startData.error ?? JSON.stringify(startData)}`,
    );
    printSummary();
    process.exit(1);
  }

  record("start-api", true, `recording-control start ok`);
  info(`  recordingId: ${startData.recording?.id ?? "(none)"}`);
  info(`  status: ${startData.recording?.status ?? "(none)"}`);

  // ── Step 3: Assert STARTING ─────────────────────────────────────────────────
  const snap1 = (await getJson(debugUrl)).data as {
    db?: { recording?: { id?: string; status?: string; fileKeyPresent?: boolean } };
  };
  const recStatus1 = snap1?.db?.recording?.status;
  record(
    "status-starting",
    recStatus1 === "STARTING" || recStatus1 === "RECORDING",
    `Recording status after start: ${recStatus1 ?? "null"} (expected STARTING or RECORDING)`,
  );
  const fileKeyPresent1 = snap1?.db?.recording?.fileKeyPresent ?? false;
  record(
    "filekey-null-after-start",
    !fileKeyPresent1,
    `fileKey is null after start (expected null, got fileKeyPresent=${fileKeyPresent1})`,
  );

  // ── Step 4: POST recording-control stop ─────────────────────────────────────
  const stopResult = await postJson(debugUrl, {
    smokeAction: "stop",
    participantId: PARTICIPANT_ID,
  });

  const stopData = stopResult.data as {
    ok?: boolean;
    recording?: { id?: string; status?: string };
    error?: string;
  };

  if (stopResult.status !== 200 || !stopData.ok) {
    record(
      "stop-api",
      false,
      `recording-control stop failed: HTTP ${stopResult.status} — ${stopData.error ?? JSON.stringify(stopData)}`,
    );
  } else {
    record("stop-api", true, `recording-control stop ok`);
    info(`  recordingId: ${stopData.recording?.id ?? "(none)"}`);
    info(`  status: ${stopData.recording?.status ?? "(none)"}`);
  }

  // ── Step 5: Assert STOPPED ──────────────────────────────────────────────────
  const snap2 = (await getJson(debugUrl)).data as {
    db?: { recording?: { id?: string; status?: string; fileKeyPresent?: boolean } };
  };
  const recStatus2 = snap2?.db?.recording?.status;
  record(
    "status-stopped",
    recStatus2 === "STOPPED",
    `Recording status after stop: ${recStatus2 ?? "null"} (expected STOPPED)`,
  );
  const fileKeyPresent2 = snap2?.db?.recording?.fileKeyPresent ?? false;
  record(
    "filekey-null-after-stop",
    !fileKeyPresent2,
    `fileKey is null after stop (expected null, got fileKeyPresent=${fileKeyPresent2})`,
  );

  // ── Step 6: Simulate signed webhook ─────────────────────────────────────────
  if (SIMULATE_WEBHOOK) {
    const webhookSecret = process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      record(
        "webhook-secret",
        false,
        "VOXIMPLANT_RECORDING_WEBHOOK_SECRET is not set — cannot simulate webhook",
      );
    } else {
      const webhookUrl = `${BASE_URL}/api/sessions/${encodeURIComponent(SESSION_ID)}/voximplant/recording-status`;
      const s3Bucket = process.env.S3_BUCKET?.trim() ?? "smoke-bucket";
      const fakeObjectKey = `${s3Bucket}/voximplant/audio/smoke-${SESSION_ID}.flac`;
      const webhookPayload = {
        status: "stopped",
        requestId: "smoke-stop-request",
        recordingId: "smoke-recorder",
        objectKey: fakeObjectKey,
        recordingUrl: `https://storage.yandexcloud.net/${fakeObjectKey}`,
        errorCode: null,
        message: "Smoke recording stopped.",
        stoppedAt: new Date().toISOString(),
      };

      info(`Sending simulated webhook to ${webhookUrl}`);
      verbose(`Webhook payload: ${JSON.stringify(webhookPayload)}`);

      const webhookResult = await postSignedJson(webhookUrl, webhookPayload, webhookSecret);
      const webhookData = webhookResult.data as { ok?: boolean; action?: string; error?: string };

      record(
        "webhook-sent",
        webhookResult.status === 200 && webhookData.ok === true,
        `Webhook response: HTTP ${webhookResult.status} action=${webhookData.action ?? "?"} ${webhookData.error ? `error=${webhookData.error}` : ""}`,
      );

      // ── Step 7: Assert COMPLETED ───────────────────────────────────────────
      const snap3 = (await getJson(debugUrl)).data as {
        db?: {
          recording?: {
            id?: string;
            status?: string;
            fileKeyPresent?: boolean;
            errorMessage?: string | null;
          };
        };
      };
      const recStatus3 = snap3?.db?.recording?.status;
      const fileKeyPresent3 = snap3?.db?.recording?.fileKeyPresent ?? false;
      const errorMessage3 = snap3?.db?.recording?.errorMessage ?? null;

      record(
        "status-completed",
        recStatus3 === "COMPLETED",
        `Recording status after webhook: ${recStatus3 ?? "null"} (expected COMPLETED)`,
      );
      record(
        "filekey-present-after-webhook",
        fileKeyPresent3,
        `fileKey present after webhook: fileKeyPresent=${fileKeyPresent3}`,
      );
      record(
        "no-error-message",
        !errorMessage3,
        `errorMessage is null (got: ${errorMessage3 ?? "null"})`,
      );

      const recordingId3 = snap3?.db?.recording?.id;
      if (recordingId3) {
        info(`  recordingId : ${recordingId3}`);
        info(`  status      : ${recStatus3}`);
        info(`  fileKeyPresent: ${fileKeyPresent3}`);
      }
    }
  }

  printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n${C.cyan}═══ Summary ═══${C.reset}`);
  for (const r of results) {
    if (r.ok) {
      console.log(`  ${C.green}✓${C.reset} ${r.step.padEnd(30)} ${r.note}`);
    } else {
      console.log(`  ${C.red}✗${C.reset} ${r.step.padEnd(30)} ${r.note}`);
    }
  }

  console.log();
  if (failed === 0) {
    console.log(`${C.green}ALL ${passed} STEPS PASSED${C.reset}`);
  } else {
    console.log(`${C.red}${failed} STEP(S) FAILED${C.reset} (${passed} passed)`);
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(
    `\n${C.red}Unhandled error:${C.reset}`,
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
