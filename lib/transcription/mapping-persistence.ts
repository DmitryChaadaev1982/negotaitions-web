import { Prisma } from "@/app/generated/prisma/client";

import {
  buildCanonicalDiarizedText,
  toParticipantDisplayInfo,
} from "@/lib/transcription/canonical-diarized-text";
import {
  PROCESSING_METADATA_MAPPING_NAMESPACE,
  patchProcessingMetadataNamespace,
} from "@/lib/transcription/processing-metadata";
import { getDisplaySpeakerLabel, getUniqueSpeakerLabels, type SpeakerMapping } from "@/lib/transcription/speaker-labels";
import { lockTranscriptRowForUpdate } from "@/lib/transcription/transcript-row-lock";

export const MAPPING_GENERATION_MISMATCH = "generation_mismatch" as const;

export class MappingGenerationMismatchError extends Error {
  readonly errorCode: typeof MAPPING_GENERATION_MISMATCH = MAPPING_GENERATION_MISMATCH;
  constructor(message = "Speaker mapping is out of date. Refresh the transcript and try again.") {
    super(message);
    this.name = "MappingGenerationMismatchError";
  }
}

export class MappingIncompleteError extends Error {
  constructor(message = "Assign all detected speakers before confirming mapping.") {
    super(message);
    this.name = "MappingIncompleteError";
  }
}

export function mappingGenerationMismatchBody(): {
  error: string;
  errorCode: typeof MAPPING_GENERATION_MISMATCH;
} {
  return {
    error: "Speaker mapping is out of date. Refresh the transcript and try again.",
    errorCode: MAPPING_GENERATION_MISMATCH,
  };
}

export type MappingOwnedColumnPatch = {
  speakerMapping?: SpeakerMapping | typeof Prisma.JsonNull;
  speakerMappingStatus?: string;
  speakerMappingConfirmedAt?: Date | null;
  speakerMappingConfirmedBy?: string | null;
  mappingSuggestion?: unknown;
};

export type MappingSegmentFieldUpdate = {
  orderIndex: number;
  mappedParticipantId: string | null;
  mappingSource?: string | null;
  mappingLocked?: boolean;
  mappingConfidence?: number | null;
  skipIfLocked?: boolean;
  forceOverrideLocked?: boolean;
};

export function sanitizeSpeakerMappingAgainstCurrentLabels(params: {
  requested: Record<string, string | null>;
  speakerLabels: string[];
  allowedParticipantIds: ReadonlySet<string>;
}): SpeakerMapping {
  const sanitized: SpeakerMapping = {};
  for (const speakerLabel of params.speakerLabels) {
    const participantId = params.requested[speakerLabel];
    sanitized[speakerLabel] =
      typeof participantId === "string" &&
      participantId.trim().length > 0 &&
      params.allowedParticipantIds.has(participantId)
        ? participantId
        : null;
  }
  return sanitized;
}

export type MappingPersistResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "generation_mismatch" | "incomplete_mapping" };

/**
 * Mapping-owned Transcript mutation under the canonical Transcript lock.
 * Rereads current lexical `TranscriptSegment.text`, patches only mapping
 * columns / `mappingSuggestion`, and rebuilds `diarizedText` from that
 * current text plus the mapping being persisted. Does not write
 * `transcriptEnhancement`, `transcriptEnhancementPublication`, or other
 * sibling namespaces.
 */
export async function persistMappingOwnedTranscriptUpdate(params: {
  tx: Prisma.TransactionClient;
  transcriptId: string;
  expectedTranscriptId?: string;
  expectedRetranscribeCount?: number;
  patch?: MappingOwnedColumnPatch;
  rebuildDiarizedText: boolean;
  requestedMapping?: Record<string, string | null>;
  allowedParticipantIds?: ReadonlySet<string> | string[];
  requireCompleteMapping?: boolean;
  forceOverrideLocked?: boolean;
  participants?: Array<{
    id: string;
    displayName: string;
    type: string;
    sessionRole?: { name: string } | null;
    roleName?: string | null;
  }>;
  segmentUpdates?: MappingSegmentFieldUpdate[];
}): Promise<MappingPersistResult> {
  const locked = await lockTranscriptRowForUpdate(params.tx, params.transcriptId);
  if (!locked) {
    return { ok: false, reason: "missing" };
  }
  const latest = await params.tx.transcript.findUnique({
    where: { id: params.transcriptId },
    select: {
      id: true,
      processingMetadata: true,
      retranscribeCount: true,
      speakerMapping: true,
      diarizedText: true,
      segments: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          speakerLabel: true,
          startSeconds: true,
          endSeconds: true,
          text: true,
          mappingLocked: true,
        },
      },
    },
  });
  if (!latest) {
    return { ok: false, reason: "missing" };
  }
  if (params.expectedTranscriptId != null && latest.id !== params.expectedTranscriptId) {
    return { ok: false, reason: "generation_mismatch" };
  }
  if (
    params.expectedRetranscribeCount != null &&
    latest.retranscribeCount !== params.expectedRetranscribeCount
  ) {
    return { ok: false, reason: "generation_mismatch" };
  }

  const labelOrder = getUniqueSpeakerLabels(
    latest.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel: segment.speakerLabel
        ? getDisplaySpeakerLabel(
            segment.speakerLabel,
            latest.segments
              .map((item) => item.speakerLabel)
              .filter((label): label is string => Boolean(label)),
          )
        : null,
    })),
  ).map((label) => label.speakerLabel);

  let patch = params.patch ?? {};
  let segmentUpdates = params.segmentUpdates;
  if (params.requestedMapping) {
    const allowed = new Set(
      params.allowedParticipantIds
        ? Array.from(params.allowedParticipantIds)
        : (params.participants ?? []).map((participant) => participant.id),
    );
    const sanitized = sanitizeSpeakerMappingAgainstCurrentLabels({
      requested: params.requestedMapping,
      speakerLabels: labelOrder,
      allowedParticipantIds: allowed,
    });
    if (params.requireCompleteMapping && labelOrder.some((label) => !sanitized[label])) {
      return { ok: false, reason: "incomplete_mapping" };
    }
    patch = { ...patch, speakerMapping: sanitized };
    if (!segmentUpdates) {
      segmentUpdates = latest.segments.map((segment) => ({
        orderIndex: segment.orderIndex,
        mappedParticipantId: segment.speakerLabel
          ? (sanitized[segment.speakerLabel] ?? null)
          : null,
        mappingSource: "CLUSTER_MAPPING",
        mappingLocked: false,
        skipIfLocked: true,
        forceOverrideLocked: params.forceOverrideLocked,
      }));
    }
  }

  const nextMapping = patch.speakerMapping;
  const clearsMapping = nextMapping === Prisma.JsonNull;
  const currentMapping: SpeakerMapping =
    latest.speakerMapping &&
    typeof latest.speakerMapping === "object" &&
    !Array.isArray(latest.speakerMapping)
      ? (latest.speakerMapping as SpeakerMapping)
      : {};
  const mappingForDiarized: SpeakerMapping = clearsMapping
    ? {}
    : ((nextMapping as SpeakerMapping | undefined) ?? currentMapping);

  const diarizedText = params.rebuildDiarizedText
    ? buildCanonicalDiarizedText({
        segments: latest.segments.map((segment) => ({
          speakerLabel: segment.speakerLabel,
          displaySpeakerLabel: segment.speakerLabel
            ? getDisplaySpeakerLabel(segment.speakerLabel, labelOrder)
            : null,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          text: segment.text,
          orderIndex: segment.orderIndex,
        })),
        speakerMapping: mappingForDiarized,
        participants: (params.participants ?? []).map(toParticipantDisplayInfo),
      })
    : undefined;

  const data: Prisma.TranscriptUpdateInput = {};
  if (patch.speakerMapping !== undefined) {
    data.speakerMapping =
      patch.speakerMapping === Prisma.JsonNull
        ? Prisma.JsonNull
        : (patch.speakerMapping as Prisma.InputJsonValue);
  }
  if (patch.speakerMappingStatus !== undefined) {
    data.speakerMappingStatus = patch.speakerMappingStatus;
  }
  if (patch.speakerMappingConfirmedAt !== undefined) {
    data.speakerMappingConfirmedAt = patch.speakerMappingConfirmedAt;
  }
  if (patch.speakerMappingConfirmedBy !== undefined) {
    data.speakerMappingConfirmedBy = patch.speakerMappingConfirmedBy;
  }
  if (diarizedText !== undefined) {
    data.diarizedText = diarizedText;
  }
  if (patch.mappingSuggestion !== undefined) {
    data.processingMetadata = patchProcessingMetadataNamespace(
      latest.processingMetadata,
      PROCESSING_METADATA_MAPPING_NAMESPACE,
      patch.mappingSuggestion,
    ) as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length > 0) {
    await params.tx.transcript.update({
      where: { id: params.transcriptId },
      data,
    });
  }

  if (segmentUpdates) {
    for (const update of segmentUpdates) {
      const dbSegment = latest.segments.find((item) => item.orderIndex === update.orderIndex);
      if (!dbSegment) continue;
      if (dbSegment.mappingLocked && update.skipIfLocked && !update.forceOverrideLocked) {
        continue;
      }
      await params.tx.transcriptSegment.update({
        where: { id: dbSegment.id },
        data: {
          mappedParticipantId: update.mappedParticipantId,
          ...(update.mappingSource !== undefined ? { mappingSource: update.mappingSource } : {}),
          ...(update.mappingLocked !== undefined ? { mappingLocked: update.mappingLocked } : {}),
          ...(update.mappingConfidence !== undefined
            ? { mappingConfidence: update.mappingConfidence }
            : {}),
        },
      });
    }
  }

  return { ok: true };
}
