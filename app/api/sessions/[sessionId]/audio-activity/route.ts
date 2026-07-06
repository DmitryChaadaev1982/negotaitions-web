import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import { processAudioActivityEvent } from "@/lib/telemetry/audio-activity-event-processor";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  event: z.enum(["SPEAKING_START", "SPEAKING_END", "speaking_interval"]),
  sessionParticipantId: z.string().trim().min(1).optional(),
  participantIdentity: z.string().trim().min(1).optional(),
  clientTimestamp: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  offsetSeconds: z.number().optional(),
  // Provider/source of the activity signal. Defaults to LiveKit for backward
  // compatibility. Voximplant clients pass "VOXIMPLANT_MIC_ACTIVITY".
  source: z.string().trim().min(1).max(64).optional(),
  // Local meter level 0..100. Metadata-only; no audio is sent/stored.
  audioLevel: z.number().min(0).max(100).optional(),
  telemetryCalibration: z
    .object({
      speakingOnLevel: z.number().optional(),
      speakingOffLevel: z.number().optional(),
      endDebounceMs: z.number().optional(),
      recordingActiveClientSide: z.boolean().optional(),
      audioProcessingEnabled: z.boolean().nullable().optional(),
    })
    .optional(),
}).refine(
  (data) => Boolean(data.joinToken ?? data.participantId),
  { message: "joinToken or participantId is required" },
);

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function logAudioActivity(
  level: "accepted" | "rejected",
  payload: {
    sessionId: string;
    sessionParticipantId?: string | null;
    source?: string | null;
    hasOffsets?: boolean;
    reason?: string;
    intervalDurationMs?: number | null;
  },
) {
  const fields = {
    sessionId: payload.sessionId,
    sessionParticipantId: payload.sessionParticipantId ?? null,
    source: payload.source ?? null,
    hasOffsets: payload.hasOffsets ?? false,
    reason: payload.reason ?? null,
    intervalDurationMs: payload.intervalDurationMs ?? null,
  };
  console.info(`[audio-activity] ${level}`, fields);
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logAudioActivity("rejected", { sessionId, reason: "invalid_json_body" });
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logAudioActivity("rejected", {
      sessionId,
      reason: parsed.error.issues[0]?.message ?? "invalid_request",
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { event, participantIdentity, clientTimestamp, offsetSeconds, audioLevel } = parsed.data;
  const source = parsed.data.source ?? "LIVEKIT_ACTIVE_SPEAKER";

  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );
  if (!participant) {
    logAudioActivity("rejected", {
      sessionId,
      source,
      reason: "participant_forbidden_or_not_found",
    });
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const result = await processAudioActivityEvent(
    {
      findRecordingWindow: async (targetSessionId) =>
        prisma.recording.findUnique({
          where: { sessionId: targetSessionId },
          select: { startedAt: true, endedAt: true },
        }),
      createActivity: async (data) => {
        await prisma.sessionParticipantAudioActivity.create({ data });
      },
      findLatestOpenActivity: async (targetSessionId, sessionParticipantId) =>
        prisma.sessionParticipantAudioActivity.findFirst({
          where: {
            sessionId: targetSessionId,
            sessionParticipantId,
            endedAt: null,
          },
          orderBy: { startedAt: "desc" },
          select: { id: true, startedAt: true, startedOffsetSeconds: true },
        }),
      updateActivity: async (id, data) => {
        await prisma.sessionParticipantAudioActivity.update({
          where: { id },
          data,
        });
      },
    },
    {
      sessionId,
      event,
      resolvedSessionParticipantId: participant.id,
      sessionParticipantId: parsed.data.sessionParticipantId,
      source,
      participantIdentity,
      clientTimestamp,
      offsetSeconds,
      audioLevel,
      startedAt: parsed.data.startedAt,
      endedAt: parsed.data.endedAt,
    },
  );

  logAudioActivity(result.accepted ? "accepted" : "rejected", {
    sessionId,
    sessionParticipantId: participant.id,
    source,
    hasOffsets: result.hasOffsets,
    reason: result.reason,
    intervalDurationMs: result.intervalDurationMs,
  });

  return NextResponse.json(
    { ok: result.accepted, event, reason: result.reason },
    { status: result.httpStatus },
  );
}
