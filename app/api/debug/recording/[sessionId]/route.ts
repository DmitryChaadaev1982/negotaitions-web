/**
 * Stage 5.4.8 — Dev-only Voximplant recording diagnostics API.
 *
 * GET  /api/debug/recording/[sessionId]   — full diagnostic snapshot
 * POST /api/debug/recording/[sessionId]   — append client-side debug event (or smoke action)
 * DELETE /api/debug/recording/[sessionId] — clear events for session
 *
 * Security:
 *   Only available when RECORDING_DEBUG_PANEL=true
 *   OR (NODE_ENV !== "production" AND NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true).
 *   Returns 404 in all other cases to prevent accidental exposure.
 *   Webhook secret is never returned — only webhookSecretConfigured: boolean.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  appendRecordingDebugEvent,
  clearRecordingDebugEvents,
  getRecordingDebugEvents,
  isRecordingDebugEnabled,
  type RecordingDebugEventLevel,
  type RecordingDebugEventSource,
} from "@/lib/debug/recording-debug";
import {
  getVideoProvider,
  getVoximplantRecordingWebhookSecret,
} from "@/lib/env";
import { getVoximplantRecordingWebhookBaseUrl } from "@/lib/voximplant/recording-webhook-url";

/** Read the last synced build ID from the local .vox-scenario-build-id file. */
function getLastSyncedBuildId(): string | null {
  try {
    const buildIdFile = join(process.cwd(), ".vox-scenario-build-id");
    if (!existsSync(buildIdFile)) return null;
    return readFileSync(buildIdFile, "utf8").trim() || null;
  } catch {
    return null;
  }
}
import {
  buildVoximplantRecordingDispatch,
  upsertVoximplantRecordingOnStart,
  upsertVoximplantRecordingOnStop,
} from "@/lib/voximplant/recording-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

// ─── Dev gate ─────────────────────────────────────────────────────────────────

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

// ─── Pipeline checklist ───────────────────────────────────────────────────────

const EXPECTED_PIPELINE = [
  "Session exists in DB",
  "Recording row created",
  "Start API called",
  "Start scenarioMessage returned",
  "Start message sent to VoxEngine",
  "Recording status STARTING/RECORDING",
  "Stop API called",
  "Stop scenarioMessage returned",
  "Stop message sent to VoxEngine",
  "Recording status STOPPED",
  "Webhook hit",
  "Webhook signature valid",
  "fileKey received",
  "Recording COMPLETED",
] as const;

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_request: Request, context: RouteContext) {
  if (!isRecordingDebugEnabled()) return notFound();

  const { sessionId } = await context.params;

  const webhookBaseUrl = await getVoximplantRecordingWebhookBaseUrl();

  // Fetch DB snapshot (non-sensitive fields only).
  const [session, recording] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.recording.findUnique({
      where: { sessionId },
      select: {
        id: true,
        status: true,
        fileKey: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const events = getRecordingDebugEvents(sessionId);

  return NextResponse.json({
    ok: true,
    enabled: true,
    sessionId,
    env: {
      nodeEnv: process.env.NODE_ENV,
      videoProvider: getVideoProvider(),
      voximplantScenarioName: process.env.VOXIMPLANT_SCENARIO_NAME ?? null,
      voximplantRuleName: process.env.VOXIMPLANT_RULE_NAME ?? null,
      webhookBaseUrl: webhookBaseUrl ?? null,
      diagnosticsEnabled: true,
      webhookSecretConfigured: Boolean(getVoximplantRecordingWebhookSecret()),
      // Stage 5.4.9: last buildId written by vox:scenario:prepare (from .vox-scenario-build-id).
      // null when scenario has never been prepared locally.
      voximplantLastSyncedBuildId: getLastSyncedBuildId(),
    },
    db: {
      session: session
        ? {
            id: session.id,
            status: session.status,
            updatedAt: session.updatedAt.toISOString(),
          }
        : null,
      recording: recording
        ? {
            id: recording.id,
            status: recording.status,
            fileKey: null, // never expose raw fileKey
            fileKeyPresent: Boolean(recording.fileKey),
            errorMessage: recording.errorMessage,
            createdAt: recording.createdAt.toISOString(),
            updatedAt: recording.updatedAt.toISOString(),
          }
        : null,
    },
    expectedPipeline: EXPECTED_PIPELINE,
    events,
  });
}

// ─── POST (append client event OR smoke recording-control action) ─────────────

const clientEventSchema = z.object({
  source: z
    .enum([
      "client",
      "recording-control",
      "control",
      "webhook",
      "refresh-recording",
      "materials-status",
      "db",
      "scenario-message",
      "smoke-test",
    ])
    .default("client"),
  level: z.enum(["info", "warn", "error", "success"]).default("info"),
  step: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Smoke recording-control schema. When `smokeAction` is present, the handler
 * bypasses participant auth and invokes the same server helpers as recording-control.
 * Requires RECORDING_DEBUG_PANEL=true — never active in production.
 */
const smokeActionSchema = z.object({
  smokeAction: z.enum(["start", "stop"]),
  participantId: z.string().min(1).default("smoke-facilitator"),
});

export async function POST(request: Request, context: RouteContext) {
  if (!isRecordingDebugEnabled()) return notFound();

  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Check if this is a smoke recording action.
  if (
    body !== null &&
    typeof body === "object" &&
    "smokeAction" in (body as Record<string, unknown>)
  ) {
    const parsedSmoke = smokeActionSchema.safeParse(body);
    if (!parsedSmoke.success) {
      return NextResponse.json(
        { error: parsedSmoke.error.issues[0]?.message ?? "Invalid smoke action." },
        { status: 400 },
      );
    }

    const { smokeAction, participantId } = parsedSmoke.data;

    appendRecordingDebugEvent({
      sessionId,
      source: "smoke-test",
      level: "info",
      step: `smoke:recording-control:${smokeAction}`,
      message: `smoke ${smokeAction} invoked`,
      data: { participantId },
    });

    try {
      const dispatch = await buildVoximplantRecordingDispatch(smokeAction, {
        sessionId,
        participantId,
      });

      const persisted =
        smokeAction === "start"
          ? await upsertVoximplantRecordingOnStart(sessionId)
          : await upsertVoximplantRecordingOnStop(sessionId);

      appendRecordingDebugEvent({
        sessionId,
        source: "smoke-test",
        level: "success",
        step: `smoke:recording-control:${smokeAction}:db`,
        message: `smoke ${smokeAction} DB: recordingId=${persisted.id} status=${persisted.status}`,
        data: { recordingId: persisted.id, status: persisted.status },
      });

      return NextResponse.json({
        ok: dispatch.ok,
        provider: "voximplant",
        scenarioMessage: dispatch.scenarioMessage,
        recordingConfig: dispatch.recordingConfig,
        recording: {
          id: persisted.id,
          status: persisted.status,
          errorMessage: persisted.errorMessage,
        },
        fileKeyHandoff: "webhook",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Smoke action failed.";
      appendRecordingDebugEvent({
        sessionId,
        source: "smoke-test",
        level: "error",
        step: `smoke:recording-control:${smokeAction}:error`,
        message: msg,
      });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Regular client debug event.
  const parsed = clientEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid event." },
      { status: 400 },
    );
  }

  appendRecordingDebugEvent({
    sessionId,
    source: parsed.data.source as RecordingDebugEventSource,
    level: parsed.data.level as RecordingDebugEventLevel,
    step: parsed.data.step,
    message: parsed.data.message,
    data: parsed.data.data as Record<string, unknown> | undefined,
  });

  return NextResponse.json({ ok: true });
}

// ─── DELETE (clear events) ────────────────────────────────────────────────────

export async function DELETE(_request: Request, context: RouteContext) {
  if (!isRecordingDebugEnabled()) return notFound();

  const { sessionId } = await context.params;
  clearRecordingDebugEvents(sessionId);
  return NextResponse.json({ ok: true, cleared: true });
}
