import { createHmac, timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { getVoximplantRecordingWebhookSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getS3Config } from "@/lib/storage/s3";

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
  requestId: z.string().optional().nullable(),
  recordingId: z.string().optional().nullable(),
  objectKey: z.string().optional().nullable(),
  recordingUrl: z.string().optional().nullable(),
  errorCode: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  startedAt: z.string().datetime({ offset: true }).optional().nullable(),
  stoppedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

type RecordingStatusPayload = z.infer<typeof recordingStatusPayloadSchema>;

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * Maps a Voximplant scenario recording status to the canonical DB RecordingStatus.
 * When status is "stopped" and a fileKey is available, returns COMPLETED so the
 * existing materials/status endpoint enables transcription immediately.
 */
function mapVoximplantStatusToDb(
  voximplantStatus: RecordingStatusPayload["status"],
  hasFileKey: boolean,
): RecordingStatus {
  switch (voximplantStatus) {
    case "starting":
      return RecordingStatus.STARTING;
    case "recording":
    case "paused":
    case "resuming":
      return RecordingStatus.RECORDING;
    case "stopping":
      return RecordingStatus.STOPPED;
    case "stopped":
      return hasFileKey ? RecordingStatus.COMPLETED : RecordingStatus.STOPPED;
    case "error":
      return RecordingStatus.FAILED;
    case "idle":
    case "not_recording":
      return RecordingStatus.NOT_STARTED;
    default:
      return RecordingStatus.NOT_STARTED;
  }
}

/**
 * Returns true if the target status is a valid transition from the current status.
 * Prevents state machine downgrades (e.g. COMPLETED → STARTING from replayed webhook).
 */
function isValidStatusTransition(
  current: RecordingStatus,
  next: RecordingStatus,
): boolean {
  // Terminal states — do not overwrite unless also terminal or same.
  if (current === RecordingStatus.COMPLETED) {
    return next === RecordingStatus.COMPLETED;
  }
  if (current === RecordingStatus.FAILED) {
    return next === RecordingStatus.FAILED || next === RecordingStatus.COMPLETED;
  }
  // STOPPED can be upgraded to COMPLETED (if fileKey arrives in a later webhook).
  if (current === RecordingStatus.STOPPED) {
    return next === RecordingStatus.STOPPED || next === RecordingStatus.COMPLETED;
  }
  // All other transitions are allowed.
  return true;
}

// ─── objectKey → fileKey normalization ───────────────────────────────────────

/**
 * Strips the S3 bucket name prefix from an objectKey that includes it.
 *
 * Voximplant scenario extracts objectKey from the Yandex Object Storage URL:
 *   URL:       https://storage.yandexcloud.net/{bucket}/{objectPath}
 *   objectKey: {bucket}/{objectPath}
 *   fileKey:   {objectPath}
 *
 * If the objectKey does not start with {bucket}/, it is returned as-is.
 */
function normalizeFileKey(objectKey: string): string {
  const s3Config = getS3Config();
  if (s3Config?.bucket && objectKey.startsWith(`${s3Config.bucket}/`)) {
    return objectKey.slice(s3Config.bucket.length + 1);
  }
  return objectKey;
}

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

  if (!validateWebhookSignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

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
  const fileKey = rawObjectKey ? normalizeFileKey(rawObjectKey) : null;
  const hasFileKey = Boolean(fileKey);

  // ── Map status ────────────────────────────────────────────────────────────
  const targetStatus = mapVoximplantStatusToDb(payload.status, hasFileKey);

  // Ignore purely informational statuses that don't imply a recording lifecycle change.
  // "idle" and "not_recording" before any recording has ever started should not create a row.
  const shouldCreateIfAbsent =
    payload.status !== "idle" && payload.status !== "not_recording";

  // ── Create or update Recording row ────────────────────────────────────────
  try {
    const existing = await prisma.recording.findUnique({
      where: { sessionId },
      select: { id: true, status: true },
    });

    if (!existing) {
      if (!shouldCreateIfAbsent) {
        // Do not create a recording row for idle/not_recording status.
        return NextResponse.json({ ok: true, action: "skipped" });
      }

      await prisma.recording.create({
        data: {
          sessionId,
          provider: "VOXIMPLANT",
          status: targetStatus,
          recordingType: "AUDIO_ONLY",
          fileKey: hasFileKey ? fileKey : undefined,
          egressId: payload.recordingId ?? undefined,
          startedAt:
            payload.startedAt
              ? new Date(payload.startedAt)
              : payload.status === "starting" || payload.status === "recording"
                ? new Date()
                : undefined,
          endedAt:
            payload.stoppedAt
              ? new Date(payload.stoppedAt)
              : payload.status === "stopped" || payload.status === "stopping"
                ? new Date()
                : undefined,
          errorMessage:
            targetStatus === RecordingStatus.FAILED
              ? (payload.message ?? payload.errorCode ?? "Recording failed.")
              : undefined,
        },
      });

      return NextResponse.json({ ok: true, action: "created", status: targetStatus });
    }

    // Row exists — check if transition is valid.
    if (!isValidStatusTransition(existing.status, targetStatus)) {
      return NextResponse.json({
        ok: true,
        action: "skipped",
        reason: "state_machine_protection",
        current: existing.status,
        attempted: targetStatus,
      });
    }

    const updateData: Parameters<typeof prisma.recording.update>[0]["data"] = {
      status: targetStatus,
    };

    if (hasFileKey) updateData.fileKey = fileKey;
    if (payload.recordingId) updateData.egressId = payload.recordingId;

    if (
      payload.startedAt &&
      (payload.status === "starting" || payload.status === "recording")
    ) {
      updateData.startedAt = new Date(payload.startedAt);
    } else if (
      !payload.startedAt &&
      (payload.status === "starting" || payload.status === "recording") &&
      existing.status === RecordingStatus.NOT_STARTED
    ) {
      updateData.startedAt = new Date();
    }

    if (payload.stoppedAt && (payload.status === "stopped" || payload.status === "stopping")) {
      updateData.endedAt = new Date(payload.stoppedAt);
    } else if (!payload.stoppedAt && (payload.status === "stopped" || payload.status === "stopping")) {
      updateData.endedAt = new Date();
    }

    if (targetStatus === RecordingStatus.FAILED) {
      updateData.errorMessage = payload.message ?? payload.errorCode ?? "Recording failed.";
    }

    await prisma.recording.update({
      where: { id: existing.id },
      data: updateData,
    });

    return NextResponse.json({ ok: true, action: "updated", status: targetStatus });
  } catch (err) {
    console.error("[vox-recording-webhook] DB update failed:", err);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
