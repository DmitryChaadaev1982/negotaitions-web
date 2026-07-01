import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { isYandexTranscriptEnhancementEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import {
  enhanceTranscriptWithYandexAi,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";
import { buildDiarizedText } from "@/lib/transcription/speaker-labels";

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

function mapTranscriptSegmentsToEnhancementInput(
  segments: Array<{
    orderIndex: number;
    speakerLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
  }>,
): TranscriptEnhancementInputSegment[] {
  return segments.map((segment) => ({
    index: segment.orderIndex,
    speakerLabel: segment.speakerLabel ?? "Speaker",
    startMs:
      segment.startSeconds !== null ? Math.round(segment.startSeconds * 1000) : null,
    endMs: segment.endSeconds !== null ? Math.round(segment.endSeconds * 1000) : null,
    originalText: segment.text,
  }));
}

async function runEnhancementJob(params: {
  transcriptId: string;
  initialTranscriptText: string;
  transcriptDiarizedText: string | null;
  transcriptMetadata: ProcessingMetadata;
  transcriptSegments: Array<{
    id: string;
    orderIndex: number;
    speakerLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
  }>;
  enhancementInput: TranscriptEnhancementInputSegment[];
}): Promise<void> {
  const {
    transcriptId,
    initialTranscriptText,
    transcriptDiarizedText,
    transcriptMetadata,
    transcriptSegments,
    enhancementInput,
  } = params;
  const enhancementStartedAt = Date.now();

  try {
    const enhanced = await enhanceTranscriptWithYandexAi(enhancementInput);
    const byIndex = new Map(enhanced.segments.map((segment) => [segment.index, segment]));
    const isValid =
      enhanced.segments.length === enhancementInput.length &&
      enhancementInput.every((segment) => byIndex.has(segment.index));

    if (!isValid) {
      throw new Error("Enhancement validation failed: segment count/index mismatch.");
    }

    const updatedSegments = enhancementInput.map((inputSegment) => ({
      ...inputSegment,
      cleanedText: byIndex.get(inputSegment.index)?.cleanedText ?? inputSegment.originalText,
    }));

    const enhancedTranscriptText = updatedSegments
      .map((segment) => segment.cleanedText.trim())
      .filter(Boolean)
      .join(" ")
      .trim();

    const normalizedSegments = transcriptSegments.map((segment) => {
      const replacement = byIndex.get(segment.orderIndex);
      return {
        speakerLabel: segment.speakerLabel,
        displaySpeakerLabel: null,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: replacement?.cleanedText?.trim() || segment.text,
        orderIndex: segment.orderIndex,
      };
    });
    const diarizedText =
      normalizedSegments.length > 0 ? buildDiarizedText(normalizedSegments) : enhancedTranscriptText;

    await prisma.$transaction(async (tx) => {
      for (const segment of transcriptSegments) {
        const replacement = byIndex.get(segment.orderIndex);
        if (!replacement) continue;
        await tx.transcriptSegment.update({
          where: { id: segment.id },
          data: { text: replacement.cleanedText.trim() || segment.text },
        });
      }

      const fresh = await tx.transcript.findUnique({
        where: { id: transcriptId },
        select: { processingMetadata: true },
      });
      const nextMetadata = asMetadata(fresh?.processingMetadata ?? transcriptMetadata);

      await tx.transcript.update({
        where: { id: transcriptId },
        data: {
          text: enhancedTranscriptText || initialTranscriptText,
          diarizedText: diarizedText || transcriptDiarizedText,
          processingMetadata: {
            ...nextMetadata,
            transcriptEnhancementRecommendation: {
              ...(asMetadata(nextMetadata.transcriptEnhancementRecommendation) ?? {}),
              suggested: false,
              reasons: [],
            },
            transcriptEnhancement: {
              ...(asMetadata(nextMetadata.transcriptEnhancement) ?? {}),
              status: "COMPLETED",
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - enhancementStartedAt,
              error: null,
              meta: enhanced.meta ?? null,
            },
          },
        },
      });
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcript enhancement failed.";
    const fresh = await prisma.transcript.findUnique({
      where: { id: transcriptId },
      select: { processingMetadata: true },
    });
    const nextMetadata = asMetadata(fresh?.processingMetadata ?? transcriptMetadata);
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: {
        processingMetadata: {
          ...nextMetadata,
          transcriptEnhancement: {
            ...(asMetadata(nextMetadata.transcriptEnhancement) ?? {}),
            status: "FAILED",
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - enhancementStartedAt,
            error: message,
          },
        },
      },
    });
  }
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

  const enhancementInput =
    transcript.segments.length > 0
      ? mapTranscriptSegmentsToEnhancementInput(
          transcript.segments.map((segment) => ({
            orderIndex: segment.orderIndex,
            speakerLabel: segment.speakerLabel,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            text: segment.text,
          })),
        )
      : [
          {
            index: 0,
            speakerLabel: "Speaker",
            startMs: null,
            endMs: null,
            originalText: transcript.text,
          },
        ];

  const enhancementStatus = asMetadata(metadata.transcriptEnhancement).status;
  if (enhancementStatus === "IN_PROGRESS") {
    return NextResponse.json(
      { error: "Transcript enhancement is already in progress." },
      { status: 409 },
    );
  }

  await prisma.transcript.update({
    where: { id: transcript.id },
    data: {
      processingMetadata: {
        ...metadata,
        transcriptEnhancement: {
          ...(asMetadata(metadata.transcriptEnhancement) ?? {}),
          status: "IN_PROGRESS",
          startedAt: new Date().toISOString(),
          completedAt: null,
          durationMs: null,
          error: null,
          meta: null,
        },
      },
    },
  });

  void runEnhancementJob({
    transcriptId: transcript.id,
    initialTranscriptText: transcript.text,
    transcriptDiarizedText: transcript.diarizedText,
    transcriptMetadata: metadata,
    transcriptSegments: transcript.segments.map((segment) => ({
      id: segment.id,
      orderIndex: segment.orderIndex,
      speakerLabel: segment.speakerLabel,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
    enhancementInput,
  });

  return NextResponse.json(
    {
      transcriptId: transcript.id,
      enhancementStatus: "IN_PROGRESS",
      queued: true,
    },
    { status: 202 },
  );
}
