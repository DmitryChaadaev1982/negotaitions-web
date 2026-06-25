import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveRoomParticipantFromParsedBody,
  resolveRoomParticipantFromQuery,
} from "@/lib/room-participant-resolver";
import {
  applySpeakerMapping,
  buildDiarizedText,
  getUniqueSpeakerLabels,
  getDisplaySpeakerLabel,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";
import { suggestSpeakerMapping } from "@/lib/transcription/auto-speaker-mapping";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const joinToken = url.searchParams.get("joinToken");
  const participantId = url.searchParams.get("participantId");

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken or participantId is required." }, { status: 400 });
  }

  const participant = await resolveRoomParticipantFromQuery(url, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const isFacilitator = participant.type === ParticipantType.FACILITATOR;

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    include: {
      segments: { orderBy: { orderIndex: "asc" } },
    },
  });

  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  const sessionParticipants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: {
      sessionRole: { select: { name: true } },
    },
  });

  const existingMapping = (transcript.speakerMapping as SpeakerMapping | null) ?? {};
  const labelOrder = getUniqueSpeakerLabels(
    transcript.segments.map((s) => ({
      speakerLabel: s.speakerLabel,
      displaySpeakerLabel: s.speakerLabel
        ? getDisplaySpeakerLabel(
            s.speakerLabel,
            transcript.segments
              .map((seg) => seg.speakerLabel)
              .filter((l): l is string => Boolean(l)),
          )
        : null,
    })),
  );

  const detectedSpeakers = labelOrder.map((label) => ({
    speakerLabel: label.speakerLabel,
    displaySpeakerLabel: label.displaySpeakerLabel,
    suggestedParticipantId: existingMapping[label.speakerLabel] ?? null,
    mappedParticipantId: existingMapping[label.speakerLabel] ?? null,
    confidence: null as number | null,
    evidence: null as string | null,
  }));

  const participants = sessionParticipants.map((p) => ({
    sessionParticipantId: p.id,
    displayName: p.displayName,
    participantType: p.type,
    roleName: p.sessionRole?.name ?? null,
  }));

  return NextResponse.json({
    transcriptId: transcript.id,
    speakerMappingStatus: transcript.speakerMappingStatus,
    speakerMappingConfirmedAt: transcript.speakerMappingConfirmedAt?.toISOString() ?? null,
    speakerMappingConfirmedBy: transcript.speakerMappingConfirmedBy ?? null,
    hasSpeakerDiarization: transcript.hasSpeakerDiarization,
    diarizationStatus: transcript.diarizationStatus ?? null,
    detectedSpeakers,
    participants,
    canEdit: isFacilitator,
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────

const speakerMappingSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  transcriptId: z.string().optional(),
  mapping: z.record(z.string(), z.string().nullable()).optional().default({}),
  confirm: z.boolean().optional().default(false),
  applyToTranscript: z.boolean().optional().default(true),
  suggestAutomatically: z.boolean().optional().default(false),
  /** When true, overwrite locked manual overrides with new cluster mapping */
  forceOverrideLocked: z.boolean().optional().default(false),
  /** Legacy: applyOnly means re-apply existing saved mapping, not save new one */
  applyOnly: z.boolean().optional(),
}).refine((data) => Boolean(data.joinToken || data.participantId), {
  message: "joinToken or participantId is required",
});

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

  const { mapping, confirm, applyToTranscript, applyOnly, suggestAutomatically, forceOverrideLocked } = parsed.data;

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
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
      segments: { orderBy: { orderIndex: "asc" } },
    },
  });

  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  const sessionParticipants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: {
      sessionRole: { select: { name: true } },
    },
  });

  // ── Suggest automatically ────────────────────────────────────────────────
  if (suggestAutomatically) {
    const suggestion = await suggestSpeakerMapping(sessionId, transcript);

    return NextResponse.json({
      suggestedMapping: suggestion.mapping,
      confidence: suggestion.confidence,
      available: suggestion.available,
      unavailableReason: suggestion.unavailableReason,
    });
  }

  // ── Build sanitized mapping ───────────────────────────────────────────────
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

  // Determine new mapping status
  let newMappingStatus: string = transcript.speakerMappingStatus;
  let confirmedAt: Date | null = transcript.speakerMappingConfirmedAt;
  let confirmedBy: string | null = transcript.speakerMappingConfirmedBy;

  if (!applyOnly) {
    if (confirm) {
      newMappingStatus = "CONFIRMED";
      confirmedAt = new Date();
      confirmedBy = participant.id;
    } else if (newMappingStatus !== "CONFIRMED") {
      // Saved but not yet confirmed
      newMappingStatus = "AUTO_SUGGESTED";
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (!applyOnly) {
      await tx.transcript.update({
        where: { id: transcript.id },
        data: {
          speakerMapping: sanitizedMapping,
          diarizedText: applyToTranscript ? diarizedText : undefined,
          speakerMappingStatus: newMappingStatus,
          speakerMappingConfirmedAt: confirmedAt,
          speakerMappingConfirmedBy: confirmedBy,
        },
      });

      for (const segment of mappedSegments) {
        const dbSegment = transcript.segments.find(
          (item) => item.orderIndex === segment.orderIndex,
        );
        if (!dbSegment) continue;

        // Skip locked segments unless facilitator explicitly requests override
        if (dbSegment.mappingLocked && !forceOverrideLocked) continue;

        await tx.transcriptSegment.update({
          where: { id: dbSegment.id },
          data: {
            mappedParticipantId: segment.mappedParticipantId,
            mappingSource: "CLUSTER_MAPPING",
            mappingLocked: false,
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
        segments: { orderBy: { orderIndex: "asc" } },
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
      speakerMappingStatus: updated.speakerMappingStatus,
      speakerMappingConfirmedAt: updated.speakerMappingConfirmedAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt.toISOString(),
      segments: updated.segments.map((segment) => ({
        id: segment.id,
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        orderIndex: segment.orderIndex,
        mappingSource: segment.mappingSource ?? null,
        mappingLocked: segment.mappingLocked,
        mappingConfidence: segment.mappingConfidence ?? null,
      })),
    },
    confirmed: confirm,
  });
}
