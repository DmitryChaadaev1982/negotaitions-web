import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import {
  applySpeakerMapping,
  buildDiarizedText,
  getUniqueSpeakerLabels,
  getDisplaySpeakerLabel,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";

export const runtime = "nodejs";

const speakerMappingSchema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  mapping: z.record(z.string(), z.string().nullable()),
  applyOnly: z.boolean().optional(),
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

  const parsed = speakerMappingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { joinToken, mapping, applyOnly } = parsed.data;

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: { deletedAt: true },
  });

  if (session?.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
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

  const sessionParticipants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: {
      sessionRole: {
        select: { name: true },
      },
    },
  });

  const participantIds = new Set(sessionParticipants.map((p) => p.id));
  const sanitizedMapping: SpeakerMapping = {};

  for (const [speakerLabel, participantId] of Object.entries(mapping)) {
    if (participantId == null || participantId === "") {
      sanitizedMapping[speakerLabel] = null;
    } else if (participantIds.has(participantId)) {
      sanitizedMapping[speakerLabel] = participantId;
    }
  }

  const labelOrder = getUniqueSpeakerLabels(
    transcript.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel: segment.speakerLabel
        ? getDisplaySpeakerLabel(
            segment.speakerLabel,
            transcript.segments
              .map((s) => s.speakerLabel)
              .filter((label): label is string => Boolean(label)),
          )
        : null,
    })),
  ).map((label) => label.speakerLabel);

  const normalizedSegments = transcript.segments.map((segment) => ({
    speakerLabel: segment.speakerLabel,
    displaySpeakerLabel: segment.speakerLabel
      ? getDisplaySpeakerLabel(segment.speakerLabel, labelOrder)
      : null,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    text: segment.text,
    orderIndex: segment.orderIndex,
  }));

  const mappedSegments = applySpeakerMapping(
    normalizedSegments,
    applyOnly
      ? ((transcript.speakerMapping as SpeakerMapping | null) ?? {})
      : sanitizedMapping,
  );

  const effectiveMapping = applyOnly
    ? ((transcript.speakerMapping as SpeakerMapping | null) ?? {})
    : sanitizedMapping;

  const participantDisplayInfo = sessionParticipants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    type: p.type,
    roleName: p.sessionRole?.name ?? null,
  }));

  const diarizedText = buildDiarizedText(
    normalizedSegments,
    effectiveMapping,
    participantDisplayInfo,
  );

  const updated = await prisma.$transaction(async (tx) => {
    if (!applyOnly) {
      await tx.transcript.update({
        where: { id: transcript.id },
        data: {
          speakerMapping: sanitizedMapping,
          diarizedText,
        },
      });

      for (const segment of mappedSegments) {
        const dbSegment = transcript.segments.find(
          (item) => item.orderIndex === segment.orderIndex,
        );
        if (!dbSegment) continue;

        await tx.transcriptSegment.update({
          where: { id: dbSegment.id },
          data: {
            mappedParticipantId: segment.mappedParticipantId,
          },
        });
      }
    } else {
      await tx.transcript.update({
        where: { id: transcript.id },
        data: { diarizedText },
      });
    }

    return tx.transcript.findUniqueOrThrow({
      where: { id: transcript.id },
      include: {
        segments: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
  });

  return NextResponse.json({
    transcript: {
      id: updated.id,
      source: updated.source,
      text: updated.text,
      diarizedText: updated.diarizedText,
      language: updated.language,
      transcriptionModel: updated.transcriptionModel,
      hasSpeakerDiarization: updated.hasSpeakerDiarization,
      speakerMapping: (updated.speakerMapping as SpeakerMapping | null) ?? null,
      updatedAt: updated.updatedAt.toISOString(),
      segments: updated.segments.map((segment) => ({
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
