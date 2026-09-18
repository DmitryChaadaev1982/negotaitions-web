import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType, Prisma, TranscriptSource } from "@/app/generated/prisma/client";
import { applyFacilitatorMaterialInputChange, materialChangeGuardErrorBody } from "@/lib/ai/material-input-invalidation";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";
import { resolveSegmentEnhancementProvenance } from "@/lib/post-processing/enhancement-ux-presentation";
import {
  LexicalSaveIdentityError,
  parseTranscriptEnhancementPublication,
  planLexicalSaveSegments,
  processingMetadataAfterLexicalSave,
  resolveQualityTextAfterLexicalSave,
} from "@/lib/services/transcript-enhancement-publication";

export const runtime = "nodejs";

const turnSchema = z.object({
  id: z.string().nullish(),
  participantId: z.string(),
  text: z.string(),
  startSeconds: z.number().nullable().optional(),
  endSeconds: z.number().nullable().optional(),
}).superRefine((turn, ctx) => {
  const hasId = typeof turn.id === "string" && turn.id.trim().length > 0;
  if (!hasId && turn.text.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Turn text is required",
      path: ["text"],
    });
  }
  if (turn.text.trim().length > 0 && turn.participantId.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Participant is required",
      path: ["participantId"],
    });
  }
});

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  turns: z.array(turnSchema).min(1, "At least one turn is required"),
  confirmRewindPublication: z.boolean().optional(),
}).refine((data) => Boolean(data.joinToken || data.participantId), {
  message: "joinToken or participantId is required",
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

  const { turns, confirmRewindPublication } = parsed.data;

  const facilitator = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
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
    const participantId = turn.participantId.trim();
    if (participantId && !participantById.has(participantId)) {
      return NextResponse.json({ error: "Unknown participant in turns." }, { status: 400 });
    }
  }

  const uniqueParticipantOrder: string[] = [];
  for (const turn of turns) {
    const participantId = turn.participantId.trim();
    if (participantId && !uniqueParticipantOrder.includes(participantId)) {
      uniqueParticipantOrder.push(participantId);
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

  const lexicalTurns = turns.filter((turn) => turn.text.trim().length > 0);
  const plainText = lexicalTurns.map((turn) => turn.text.trim()).join("\n\n");
  const diarizedText = buildCanonicalDiarizedText({
    segments: lexicalTurns.map((turn, orderIndex) => ({
      speakerLabel: speakerLabelByParticipantId.get(turn.participantId.trim()) ?? null,
      displaySpeakerLabel: null,
      startSeconds: turn.startSeconds ?? null,
      endSeconds: turn.endSeconds ?? null,
      text: turn.text.trim(),
      orderIndex,
    })),
    speakerMapping: mapping,
    participants: participants.map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      type: participant.type,
      roleName: participant.sessionRole?.name ?? null,
    })),
  });

  let change;
  try {
    change = await applyFacilitatorMaterialInputChange({
    sessionId,
    confirmRewindPublication,
    mutate: async (tx) => {
    const existing = await tx.transcript.findUnique({
      where: { sessionId },
      include: {
        segments: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            text: true,
            orderIndex: true,
          },
        },
      },
    });
    const existingSegments = existing?.segments ?? [];
    const existingById = new Map(existingSegments.map((segment) => [segment.id, segment]));
    const plan = planLexicalSaveSegments({
      existingSegments,
      submittedSegmentIds: turns.map((turn) => turn.id),
    });
    if (!plan.ok) {
      throw new LexicalSaveIdentityError(plan.reason);
    }
    const publicationMode = plan.publicationMode;
    const processingMetadata = processingMetadataAfterLexicalSave({
      metadata: existing?.processingMetadata,
      mode: publicationMode,
      retainedSegments: plan.retainedSegments,
    }) as Prisma.InputJsonValue;
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
        processingMetadata,
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
        processingMetadata,
      },
    });

    if (plan.deleteIds.length > 0) {
      await tx.transcriptSegment.deleteMany({
        where: { transcriptId: saved.id, id: { in: plan.deleteIds } },
      });
    }

    const creates = plan.operations.flatMap((operation) => {
      if (operation.type !== "create") {
        return [];
      }
      const turn = turns[operation.orderIndex];
      if (!turn) {
        return [];
      }
      return [{
        transcriptId: saved.id,
        speakerLabel: speakerLabelByParticipantId.get(turn.participantId.trim()) ?? null,
        mappedParticipantId: turn.participantId.trim(),
        startSeconds: turn.startSeconds ?? null,
        endSeconds: turn.endSeconds ?? null,
        text: turn.text.trim(),
        qualityText: resolveQualityTextAfterLexicalSave({
          matchedExistingSegment: false,
        }),
        orderIndex: operation.orderIndex,
      }];
    });
    if (creates.length > 0) {
      await tx.transcriptSegment.createMany({ data: creates });
    }

    for (const operation of plan.operations) {
      if (operation.type !== "update") {
        continue;
      }
      const turn = turns.find((candidate) => candidate.id?.trim() === operation.id);
      if (!turn) {
        continue;
      }
      const existingSegment = existingById.get(operation.id);
      const nextText = turn.text;
      const participantId = turn.participantId.trim();
      await tx.transcriptSegment.update({
        where: { id: operation.id },
        data: {
          ...(participantId
            ? {
                speakerLabel: speakerLabelByParticipantId.get(participantId) ?? null,
                mappedParticipantId: participantId,
              }
            : {}),
          startSeconds: turn.startSeconds ?? null,
          endSeconds: turn.endSeconds ?? null,
          ...(existingSegment && nextText === existingSegment.text ? {} : { text: nextText }),
          orderIndex: operation.orderIndex,
        },
      });
    }

    return tx.transcript.findUniqueOrThrow({
      where: { id: saved.id },
      include: {
        segments: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    },
    });
  } catch (error) {
    if (error instanceof LexicalSaveIdentityError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  if (!change.ok) {
    return NextResponse.json(materialChangeGuardErrorBody(change), {
      status: change.status,
    });
  }
  const transcript = change.result;
  const publication = parseTranscriptEnhancementPublication(transcript.processingMetadata);
  const currentRetranscribeCount = transcript.retranscribeCount ?? 0;

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
      retranscribeCount: currentRetranscribeCount,
      updatedAt: transcript.updatedAt.toISOString(),
      segments: transcript.segments.map((segment) => ({
        id: segment.id,
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        orderIndex: segment.orderIndex,
        enhancementProvenance: resolveSegmentEnhancementProvenance({
          publication,
          currentRetranscribeCount,
          orderIndex: segment.orderIndex,
          publishedText: segment.text,
          rawText: segment.qualityText,
        }),
      })),
    },
    publicationRevoked: change.publicationRevoked,
  });
}
