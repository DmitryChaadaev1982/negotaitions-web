import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { isYandexTranscriptEnhancementEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { executeTranscriptEnhancement } from "@/lib/services/transcript-enhancement-orchestration";

export const runtime = "nodejs";

const schema = z
  .object({
    joinToken: z.string().trim().min(1).optional(),
    participantId: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.joinToken || data.participantId), {
    message: "joinToken or participantId is required",
  });

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type ProcessingMetadata = Record<string, unknown>;

function asMetadata(value: unknown): ProcessingMetadata {
  return value && typeof value === "object" ? (value as ProcessingMetadata) : {};
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!isYandexTranscriptEnhancementEnabled()) {
    return NextResponse.json(
      { error: "Transcript enhancement is disabled by configuration." },
      { status: 400 },
    );
  }

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    include: {
      segments: {
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  const metadata = asMetadata(transcript.processingMetadata);
  const provider =
    typeof metadata.transcriptionProvider === "string"
      ? metadata.transcriptionProvider
      : null;
  if (provider !== "yandex_speechkit") {
    return NextResponse.json(
      { error: "Transcript enhancement is available only for Yandex transcripts." },
      { status: 400 },
    );
  }

  if (!transcript.text.trim() && transcript.segments.length === 0) {
    return NextResponse.json(
      { error: "Transcript is empty. Nothing to enhance." },
      { status: 400 },
    );
  }

  const enhancementStatus = asMetadata(metadata.transcriptEnhancement).status;
  if (enhancementStatus === "IN_PROGRESS" || enhancementStatus === "RUNNING") {
    return NextResponse.json(
      { error: "Transcript enhancement is already in progress." },
      { status: 409 },
    );
  }

  const triggerSource =
    enhancementStatus === "COMPLETED" ||
    enhancementStatus === "PARTIAL" ||
    enhancementStatus === "FAILED" ||
    enhancementStatus === "SKIPPED"
      ? "manual_reenhancement"
      : "manual";

  const runResult = await executeTranscriptEnhancement({
    transcriptId: transcript.id,
    triggerSource,
    forceReenhancement: triggerSource === "manual_reenhancement",
    runInBackground: true,
  });

  if (runResult.outcome === "already_running") {
    return NextResponse.json(
      { error: "Transcript enhancement is already in progress." },
      { status: 409 },
    );
  }

  if (runResult.outcome === "skipped") {
    return NextResponse.json(
      { error: "Transcript enhancement run was skipped." },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      transcriptId: transcript.id,
      enhancementStatus: "RUNNING",
      queued: true,
    },
    { status: 202 },
  );
}
