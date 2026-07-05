import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  event: z.enum(["SPEAKING_START", "SPEAKING_END"]),
  participantIdentity: z.string().trim().min(1).optional(),
  clientTimestamp: z.string().optional(),
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

  const {
    event,
    participantIdentity,
    clientTimestamp,
    offsetSeconds,
    audioLevel,
  } = parsed.data;
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

  const now = new Date();
  const eventTimeCandidate = clientTimestamp ? new Date(clientTimestamp) : now;
  const eventTime = Number.isNaN(eventTimeCandidate.getTime()) ? now : eventTimeCandidate;
  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: { startedAt: true, endedAt: true },
  });
  const recordingStartMs = recording?.startedAt?.getTime() ?? null;
  const derivedOffsetSeconds =
    recordingStartMs == null
      ? null
      : Math.max(
          0,
          Math.round(((eventTime.getTime() - recordingStartMs) / 1000) * 1000) / 1000,
        );
  const resolvedOffsetSeconds = offsetSeconds ?? derivedOffsetSeconds;
  const recordingDurationSeconds =
    recording?.startedAt && recording?.endedAt
      ? Math.max(0, (recording.endedAt.getTime() - recording.startedAt.getTime()) / 1000)
      : null;
  const normalizedOffsetSeconds =
    typeof resolvedOffsetSeconds === "number"
      ? Math.max(
          0,
          recordingDurationSeconds == null
            ? resolvedOffsetSeconds
            : Math.min(resolvedOffsetSeconds, recordingDurationSeconds),
        )
      : null;

  if (event === "SPEAKING_START") {
    await prisma.sessionParticipantAudioActivity.create({
      data: {
        sessionId,
        sessionParticipantId: participant.id,
        participantIdentity: participantIdentity ?? null,
        startedAt: eventTime,
        startedOffsetSeconds: normalizedOffsetSeconds,
        source,
        confidence: typeof audioLevel === "number" ? audioLevel : null,
      },
    });
    logAudioActivity("accepted", {
      sessionId,
      sessionParticipantId: participant.id,
      source,
      hasOffsets: normalizedOffsetSeconds != null,
      reason: "start_recorded",
      intervalDurationMs: null,
    });

    return NextResponse.json({ ok: true, event: "SPEAKING_START" });
  }

  if (event === "SPEAKING_END") {
    // Find the most recent open activity for this participant
    const openActivity = await prisma.sessionParticipantAudioActivity.findFirst({
      where: {
        sessionId,
        sessionParticipantId: participant.id,
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });

    if (openActivity) {
      const endedOffsetSeconds =
        normalizedOffsetSeconds == null
          ? null
          : openActivity.startedOffsetSeconds != null
            ? Math.max(normalizedOffsetSeconds, openActivity.startedOffsetSeconds)
            : normalizedOffsetSeconds;
      const intervalDurationMs = Math.max(
        0,
        eventTime.getTime() - openActivity.startedAt.getTime(),
      );
      await prisma.sessionParticipantAudioActivity.update({
        where: { id: openActivity.id },
        data: {
          endedAt: eventTime,
          endedOffsetSeconds,
          startedOffsetSeconds:
            openActivity.startedOffsetSeconds ??
            (recordingStartMs == null
              ? null
              : Math.max(
                  0,
                  Math.round(
                    ((openActivity.startedAt.getTime() - recordingStartMs) / 1000) * 1000,
                  ) / 1000,
                )),
        },
      });
      logAudioActivity("accepted", {
        sessionId,
        sessionParticipantId: participant.id,
        source,
        hasOffsets: endedOffsetSeconds != null,
        reason: "end_recorded",
        intervalDurationMs,
      });
    } else {
      logAudioActivity("rejected", {
        sessionId,
        sessionParticipantId: participant.id,
        source,
        hasOffsets: normalizedOffsetSeconds != null,
        reason: "no_open_interval_for_end",
      });
    }

    return NextResponse.json({ ok: true, event: "SPEAKING_END" });
  }

  logAudioActivity("rejected", {
    sessionId,
    sessionParticipantId: participant.id,
    source,
    reason: "unknown_event",
  });
  return NextResponse.json({ error: "Unknown event." }, { status: 400 });
}
