import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType, TranscriptSource } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export const runtime = "nodejs";

const turnSchema = z.object({
  participantId: z.string().trim().min(1, "Participant is required"),
  text: z.string().trim().min(1, "Turn text is required"),
  startSeconds: z.number().nullable().optional(),
  endSeconds: z.number().nullable().optional(),
});

const schema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  turns: z.array(turnSchema).min(1, "At least one turn is required"),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

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

  const { joinToken, turns } = parsed.data;

  const facilitator = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!facilitator || facilitator.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: {
      id: true,
      deletedAt: true,
      recording: { select: { id: true } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (session.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
  }

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: { sessionRole: { select: { name: true } } },
  });
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  for (const turn of turns) {
    if (!participantById.has(turn.participantId)) {
      return NextResponse.json({ error: "Unknown participant in turns." }, { status: 400 });
    }
  }

  const uniqueParticipantOrder: string[] = [];
  for (const turn of turns) {
    if (!uniqueParticipantOrder.includes(turn.participantId)) {
      uniqueParticipantOrder.push(turn.participantId);
    }
  }

  const speakerLabelByParticipantId = new Map<string, string>(
    uniqueParticipantOrder.map((participantId, index) => [
      participantId,
      `manual_speaker_${index + 1}`,
    ]),
  );

  const mapping: SpeakerMapping = {};
  for (const participantId of uniqueParticipantOrder) {
    const speakerLabel = speakerLabelByParticipantId.get(participantId);
    if (speakerLabel) {
      mapping[speakerLabel] = participantId;
    }
  }

  const participantLabels = participants.reduce<Record<string, string>>((acc, participant) => {
    const roleSuffix = participant.sessionRole?.name
      ? ` / ${participant.sessionRole.name}`
      : "";
    acc[participant.id] = `${participant.displayName}${roleSuffix}`;
    return acc;
  }, {});

  const plainText = turns.map((turn) => turn.text.trim()).join("\n\n");
  const diarizedText = turns
    .map((turn) => `[${participantLabels[turn.participantId]}] ${turn.text.trim()}`)
    .join("\n\n");

  const transcript = await prisma.$transaction(async (tx) => {
    const saved = await tx.transcript.upsert({
      where: { sessionId },
      create: {
        sessionId,
        recordingId: session.recording?.id,
        source: TranscriptSource.MANUAL,
        text: plainText,
        diarizedText,
        hasSpeakerDiarization: true,
        speakerMapping: mapping,
        speakerMappingStatus: "CONFIRMED",
        speakerMappingConfirmedAt: new Date(),
        speakerMappingConfirmedBy: facilitator.id,
      },
      update: {
        source: TranscriptSource.MANUAL,
        recordingId: session.recording?.id,
        text: plainText,
        diarizedText,
        hasSpeakerDiarization: true,
        speakerMapping: mapping,
        speakerMappingStatus: "CONFIRMED",
        speakerMappingConfirmedAt: new Date(),
        speakerMappingConfirmedBy: facilitator.id,
      },
    });

    await tx.transcriptSegment.deleteMany({
      where: { transcriptId: saved.id },
    });

    await tx.transcriptSegment.createMany({
      data: turns.map((turn, orderIndex) => ({
        transcriptId: saved.id,
        speakerLabel: speakerLabelByParticipantId.get(turn.participantId) ?? null,
        mappedParticipantId: turn.participantId,
        startSeconds: turn.startSeconds ?? null,
        endSeconds: turn.endSeconds ?? null,
        text: turn.text.trim(),
        orderIndex,
      })),
    });

    return tx.transcript.findUniqueOrThrow({
      where: { id: saved.id },
      include: {
        segments: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
  });

  return NextResponse.json({
    transcript: {
      id: transcript.id,
      source: transcript.source,
      text: transcript.text,
      diarizedText: transcript.diarizedText,
      language: transcript.language,
      transcriptionModel: transcript.transcriptionModel,
      hasSpeakerDiarization: transcript.hasSpeakerDiarization,
      speakerMapping: transcript.speakerMapping,
      speakerMappingStatus: transcript.speakerMappingStatus,
      updatedAt: transcript.updatedAt.toISOString(),
      segments: transcript.segments.map((segment) => ({
        id: segment.id,
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        orderIndex: segment.orderIndex,
      })),
    },
  });
}
