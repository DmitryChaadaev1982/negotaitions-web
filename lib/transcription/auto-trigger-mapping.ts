import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { suggestSpeakerMapping } from "@/lib/transcription/auto-speaker-mapping";
import {
  applySpeakerMapping,
  buildDiarizedText,
  getDisplaySpeakerLabel,
  getUniqueSpeakerLabels,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";

/**
 * Minimum per-speaker overlap confidence required to prefill a suggested
 * mapping as AUTO_SUGGESTED (and apply it to segments). Below this, the
 * suggestion is still stored (so the UI can prefill dropdowns) but the status
 * stays REQUIRED so the facilitator must review/complete it.
 */
export const AUTO_MAPPING_HIGH_CONFIDENCE = 0.6;

export type AutoMappingTriggerDiagnostics = {
  attempted: boolean;
  available: boolean;
  unavailableReason: string | null;
  uniqueSpeakerCount: number;
  suggestedSpeakerCount: number;
  minConfidence: number | null;
  appliedStatus: string | null;
  reason: string;
  computedAt: string;
};

function notAttempted(reason: string): AutoMappingTriggerDiagnostics {
  return {
    attempted: false,
    available: false,
    unavailableReason: null,
    uniqueSpeakerCount: 0,
    suggestedSpeakerCount: 0,
    minConfidence: null,
    appliedStatus: null,
    reason,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Phase 4 — auto-trigger speaker mapping after transcription completes.
 *
 * Runs the existing telemetry-overlap suggestion logic and persists the
 * result. It never auto-confirms: high-confidence suggestions become
 * AUTO_SUGGESTED (prefilled + applied to segments); low-confidence or partial
 * suggestions are stored for UI prefill but leave the status REQUIRED.
 *
 * Resilient: callers should treat a thrown error as non-fatal for the run.
 * Returns diagnostics for logging / processingMetadata.
 */
export async function autoTriggerSpeakerMappingAfterTranscription(
  sessionId: string,
): Promise<AutoMappingTriggerDiagnostics> {
  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    include: { segments: { orderBy: { orderIndex: "asc" } } },
  });

  if (!transcript) return notAttempted("no_transcript");
  if (!transcript.hasSpeakerDiarization) return notAttempted("no_diarization");
  if (transcript.speakerMappingStatus === "CONFIRMED") {
    return notAttempted("already_confirmed");
  }

  const suggestion = await suggestSpeakerMapping(sessionId, {
    id: transcript.id,
    segments: transcript.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    })),
  });

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

  const existingMetadata =
    transcript.processingMetadata && typeof transcript.processingMetadata === "object"
      ? (transcript.processingMetadata as Record<string, unknown>)
      : {};

  const persistDiagnostics = async (diag: AutoMappingTriggerDiagnostics) => {
    await prisma.transcript.update({
      where: { id: transcript.id },
      data: {
        processingMetadata: {
          ...existingMetadata,
          mappingSuggestion: diag,
        } as Prisma.InputJsonValue,
      },
    });
  };

  if (!suggestion.available) {
    const diag: AutoMappingTriggerDiagnostics = {
      attempted: true,
      available: false,
      unavailableReason: suggestion.unavailableReason,
      uniqueSpeakerCount: labelOrder.length,
      suggestedSpeakerCount: 0,
      minConfidence: null,
      appliedStatus: null,
      reason: `unavailable:${suggestion.unavailableReason ?? "unknown"}`,
      computedAt: new Date().toISOString(),
    };
    await persistDiagnostics(diag);
    return diag;
  }

  const suggestedLabels = Object.keys(suggestion.mapping).filter(
    (label) => suggestion.mapping[label],
  );
  const confidences = suggestedLabels
    .map((label) => suggestion.confidence[label])
    .filter((value): value is number => typeof value === "number");
  const minConfidence = confidences.length > 0 ? Math.min(...confidences) : null;

  const allSpeakersCovered =
    labelOrder.length > 0 &&
    labelOrder.every((label) => Boolean(suggestion.mapping[label]));
  const highConfidence =
    minConfidence !== null && minConfidence >= AUTO_MAPPING_HIGH_CONFIDENCE;
  const shouldApply = allSpeakersCovered && highConfidence;

  // Sanitized mapping (only real participant ids).
  const sanitizedMapping: SpeakerMapping = {};
  for (const label of labelOrder) {
    sanitizedMapping[label] = suggestion.mapping[label] ?? null;
  }

  if (!shouldApply) {
    // Store suggestion for UI prefill, but keep REQUIRED so facilitator reviews.
    const diag: AutoMappingTriggerDiagnostics = {
      attempted: true,
      available: true,
      unavailableReason: null,
      uniqueSpeakerCount: labelOrder.length,
      suggestedSpeakerCount: suggestedLabels.length,
      minConfidence,
      appliedStatus: transcript.speakerMappingStatus,
      reason: allSpeakersCovered ? "low_confidence_review_required" : "partial_mapping_review_required",
      computedAt: new Date().toISOString(),
    };
    await prisma.transcript.update({
      where: { id: transcript.id },
      data: {
        speakerMapping: sanitizedMapping as Prisma.InputJsonValue,
        processingMetadata: {
          ...existingMetadata,
          mappingSuggestion: diag,
        } as Prisma.InputJsonValue,
      },
    });
    return diag;
  }

  // High-confidence, complete suggestion → prefill as AUTO_SUGGESTED and apply.
  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: { sessionRole: { select: { name: true } } },
  });
  const participantDisplayInfo = participants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    type: p.type,
    roleName: p.sessionRole?.name ?? null,
  }));

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
  const mappedSegments = applySpeakerMapping(normalizedSegments, sanitizedMapping);
  const diarizedText = buildDiarizedText(
    normalizedSegments,
    sanitizedMapping,
    participantDisplayInfo,
  );

  const diag: AutoMappingTriggerDiagnostics = {
    attempted: true,
    available: true,
    unavailableReason: null,
    uniqueSpeakerCount: labelOrder.length,
    suggestedSpeakerCount: suggestedLabels.length,
    minConfidence,
    appliedStatus: "AUTO_SUGGESTED",
    reason: "high_confidence_prefilled",
    computedAt: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.transcript.update({
      where: { id: transcript.id },
      data: {
        speakerMapping: sanitizedMapping as Prisma.InputJsonValue,
        speakerMappingStatus: "AUTO_SUGGESTED",
        diarizedText,
        processingMetadata: {
          ...existingMetadata,
          mappingSuggestion: diag,
        } as Prisma.InputJsonValue,
      },
    });

    for (const segment of mappedSegments) {
      const dbSegment = transcript.segments.find(
        (item) => item.orderIndex === segment.orderIndex,
      );
      if (!dbSegment || dbSegment.mappingLocked) continue;
      await tx.transcriptSegment.update({
        where: { id: dbSegment.id },
        data: {
          mappedParticipantId: segment.mappedParticipantId,
          mappingSource: "MIC_ACTIVITY",
          mappingConfidence:
            segment.speakerLabel && typeof suggestion.confidence[segment.speakerLabel] === "number"
              ? suggestion.confidence[segment.speakerLabel]
              : null,
        },
      });
    }
  });

  return diag;
}
