import { createHmac, timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getVoximplantRecordingWebhookSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import { appendRecordingDebugEvent } from "@/lib/debug/recording-debug";
import {
  applyVoximplantRecordingStatusCallback,
  RecordingStatusFencingError,
} from "@/lib/voximplant/recording-status-fencing";
import { VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION } from "@/lib/voximplant/recording-control-signature";

/**
 * Stage 5.4 — Voximplant recording status webhook.
 *
 * Called by the VoxEngine scenario whenever recording state changes.
 * Creates or updates the canonical Recording row for the session.
 *
 * Authentication:
 *   Header: X-Voximplant-Signature: hmac-sha256=<hex>
 *   HMAC key: VOXIMPLANT_RECORDING_WEBHOOK_SECRET env var
 *   HMAC input: raw request body bytes
 *
 * Idempotency:
 *   Recording is keyed by sessionId (unique in schema). Duplicate stopped/completed
 *   webhooks update the same row. A state machine prevents downgrades (e.g.
 *   COMPLETED cannot be overwritten by STARTING from a replayed webhook).
 *
 * objectKey → fileKey mapping:
 *   VoxEngine extracts objectKey from the recording URL. The URL format for Yandex
 *   Object Storage is: https://storage.yandexcloud.net/{bucket}/{objectPath}
 *   The scenario's normalizeObjectKeyFromUrl() returns {bucket}/{objectPath}.
 *   This handler strips the {bucket}/ prefix to obtain the S3 object key used by
 *   the rest of the pipeline (downloadObjectToBuffer, getSignedDownloadUrl, etc.).
 *   If the objectKey does not contain the configured bucket prefix, it is used as-is.
 */

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

// ─── Payload schema ───────────────────────────────────────────────────────────

const recordingStatusPayloadSchema = z.object({
  status: z.enum([
    "idle",
    "starting",
    "recording",
    "stopping",
    "stopped",
    "error",
    "not_recording",
    "paused",
    "resuming",
  ]),
  protocolVersion: z.string().optional().nullable(),
  requestId: z.string().optional().nullable(),
  recordingAttemptId: z.string().trim().min(1).optional().nullable(),
  recordingId: z.string().optional().nullable(),
  objectKey: z.string().optional().nullable(),
  recordingUrl: z.string().optional().nullable(),
  errorCode: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  startedAt: z.string().datetime({ offset: true }).optional().nullable(),
  stoppedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// ─── objectKey → fileKey normalization ───────────────────────────────────────

// ─── Signature validation ─────────────────────────────────────────────────────

function validateWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const prefix = "hmac-sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;

  const receivedHex = signatureHeader.slice(prefix.length);
  const expectedHmac = createHmac("sha256", secret).update(rawBody).digest();

  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(receivedHex, "hex");
  } catch {
    return false;
  }

  if (receivedBuf.length !== expectedHmac.length) return false;

  return timingSafeEqual(expectedHmac, receivedBuf);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  // ── Auth: validate webhook secret ────────────────────────────────────────
  const secret = getVoximplantRecordingWebhookSecret();
  if (!secret) {
    console.error("[vox-recording-webhook] VOXIMPLANT_RECORDING_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const signatureHeader = request.headers.get("x-voximplant-signature");
  const rawBody = Buffer.from(await request.arrayBuffer());

  const signaturePresent = Boolean(signatureHeader);
  console.log(
    `[vox-recording-webhook] hit sessionId=${sessionId} signaturePresent=${signaturePresent}`,
  );

  appendRecordingDebugEvent({
    sessionId,
    source: "webhook",
    level: "info",
    step: "webhook:hit",
    message: `webhook hit, signaturePresent=${signaturePresent}`,
    data: { sessionId, signaturePresent },
  });

  const signatureValid = validateWebhookSignature(rawBody, signatureHeader, secret);
  if (!signatureValid) {
    console.warn(
      `[vox-recording-webhook] invalid signature sessionId=${sessionId} signaturePresent=${signaturePresent}`,
    );
    appendRecordingDebugEvent({
      sessionId,
      source: "webhook",
      level: "error",
      step: "webhook:signature:invalid",
      message: "webhook signature validation failed",
      data: { signaturePresent, signatureValid: false },
    });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  appendRecordingDebugEvent({
    sessionId,
    source: "webhook",
    level: "success",
    step: "webhook:signature:valid",
    message: "webhook signature valid",
    data: { signaturePresent, signatureValid: true },
  });

  // ── Parse payload ─────────────────────────────────────────────────────────
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = recordingStatusPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const isFencedProtocol =
    payload.protocolVersion ===
    VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION;
  if (
    (payload.recordingAttemptId && !isFencedProtocol) ||
    (isFencedProtocol && !payload.recordingAttemptId)
  ) {
    return NextResponse.json(
      {
        error: "Fenced callbacks require a matching protocol and recordingAttemptId.",
        code: "INVALID_RECORDING_ATTEMPT_PROTOCOL",
        retryable: false,
      },
      { status: 400 },
    );
  }

  // ── Validate session ──────────────────────────────────────────────────────
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, deletedAt: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (session.deletedAt) {
    return NextResponse.json({ error: "Session is deleted." }, { status: 403 });
  }

  // ── Resolve fileKey ───────────────────────────────────────────────────────
  const rawObjectKey = payload.objectKey?.trim() || null;
  const normalizedKey = rawObjectKey
    ? normalizeRecordingFileKey(rawObjectKey)
    : null;
  const fileKey =
    normalizedKey &&
    !normalizedKey.containsRawUrl &&
    !normalizedKey.containsEncodedUrl
      ? normalizedKey.normalizedKey
      : null;
  const hasFileKey = Boolean(fileKey);
  if (rawObjectKey && !fileKey) {
    return NextResponse.json(
      {
        error: "Unsafe recording object key.",
        code: "UNSAFE_RECORDING_OBJECT_KEY",
        retryable: false,
      },
      { status: 400 },
    );
  }

  console.log(
    `[vox-recording-webhook] payload sessionId=${sessionId} status=${payload.status} fileKeyPresent=${hasFileKey}`,
  );

  appendRecordingDebugEvent({
    sessionId,
    source: "webhook",
    level: "info",
    step: "webhook:payload",
    message: `payload received: status=${payload.status} fileKeyPresent=${hasFileKey}`,
    data: {
      status: payload.status,
      fileKeyPresent: hasFileKey,
      normalizedFileKeyPresent: hasFileKey,
      droppedUnsafeFileKey: Boolean(normalizedKey) && !hasFileKey,
      duplicatePrefixCollapsed: normalizedKey?.hadDuplicatePrefix ?? false,
      encodedProviderUrlDetected: normalizedKey?.containsEncodedUrl ?? false,
      encodedProviderUrlHost: normalizedKey?.decodedUrlHost ?? null,
      requestId: payload.requestId ?? null,
      recordingAttemptId: payload.recordingAttemptId ?? null,
      recordingId: payload.recordingId ?? null,
    },
  });

  try {
    const result = await applyVoximplantRecordingStatusCallback({
      sessionId,
      payload: {
        ...payload,
        fileKey,
      },
    });
    console.log(
      `[vox-recording-webhook] ${result.action} recordingId=${result.recordingId} status=${result.status} attemptId=${payload.recordingAttemptId ?? "legacy"} recovered=${result.recovered}`,
    );
    appendRecordingDebugEvent({
      sessionId,
      source: "webhook",
      level: result.status === "COMPLETED" ? "success" : "info",
      step: `webhook:db:${result.action}`,
      message: `Recording callback ${result.action}: recordingId=${result.recordingId} status=${result.status}`,
      data: {
        recordingId: result.recordingId,
        status: result.status,
        recordingAttemptId: payload.recordingAttemptId ?? null,
        requestId: payload.requestId ?? null,
        recovered: result.recovered,
      },
    });
    return NextResponse.json({
      ok: true,
      action: result.action,
      status: result.status,
      duplicate: result.action === "duplicate",
      recovered: result.recovered,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "DB update failed.";
    if (err instanceof RecordingStatusFencingError) {
      console.warn(
        `[vox-recording-webhook] rejected code=${err.code} status=${err.status} attemptId=${payload.recordingAttemptId ?? "missing"}`,
      );
      appendRecordingDebugEvent({
        sessionId,
        source: "webhook",
        level: "warn",
        step: "webhook:fencing:rejected",
        message: errMsg,
        data: {
          code: err.code,
          retryable: err.retryable,
          recordingAttemptId: payload.recordingAttemptId ?? null,
          requestId: payload.requestId ?? null,
        },
      });
      return NextResponse.json(
        {
          error: errMsg,
          code: err.code,
          retryable: err.retryable,
        },
        { status: err.status },
      );
    }
    console.error("[vox-recording-webhook] DB update failed:", err);
    appendRecordingDebugEvent({
      sessionId,
      source: "webhook",
      level: "error",
      step: "webhook:db:error",
      message: `DB update failed: ${errMsg}`,
    });
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
