import { createHash } from "node:crypto";

import {
  isExecutionInFlight,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import {
  asProcessingMetadata,
  PROCESSING_METADATA_ENHANCEMENT_PUBLICATION_NAMESPACE,
  patchProcessingMetadataNamespace,
  type ProcessingMetadata,
} from "@/lib/transcription/processing-metadata";

/**
 * Successful atomic publication identity for the CURRENT published lexical
 * text. Independent from `processingMetadata.transcriptEnhancement`, which
 * is the latest enhancement attempt.
 */
export type TranscriptEnhancementPublication = {
  runId: string;
  retranscribeCount: number;
  inputIdentity: string;
  publishedAt: string;
  segmentDigestByOrderIndex: Record<string, string>;
};

export function digestPublishedSegmentText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.length > 0) {
      record[key] = entry;
    }
  }
  return record;
}

export function parseTranscriptEnhancementPublication(
  processingMetadata: unknown,
): TranscriptEnhancementPublication | null {
  const ns = asProcessingMetadata(
    asProcessingMetadata(processingMetadata)[
      PROCESSING_METADATA_ENHANCEMENT_PUBLICATION_NAMESPACE
    ],
  );
  const runId = typeof ns.runId === "string" ? ns.runId.trim() : "";
  const inputIdentity = typeof ns.inputIdentity === "string" ? ns.inputIdentity.trim() : "";
  const publishedAt = typeof ns.publishedAt === "string" ? ns.publishedAt : "";
  const retranscribeCount =
    typeof ns.retranscribeCount === "number" && Number.isFinite(ns.retranscribeCount)
      ? ns.retranscribeCount
      : null;
  if (!runId || !inputIdentity || !publishedAt || retranscribeCount == null) {
    return null;
  }
  return {
    runId,
    retranscribeCount,
    inputIdentity,
    publishedAt,
    segmentDigestByOrderIndex: asStringRecord(ns.segmentDigestByOrderIndex),
  };
}

/**
 * Record a publication digest unless this is SpeechKit copy-through:
 * current published text equals a real raw baseline. No-raw manual
 * segments (`originalText == null`) still receive a digest, including
 * when the model copied the manual input through unchanged.
 */
export function shouldRecordPublishedSegmentDigest(params: {
  publishedText: string;
  originalText: string | null;
}): boolean {
  if (params.originalText == null) {
    return true;
  }
  return params.publishedText !== params.originalText;
}

export function buildTranscriptEnhancementPublication(params: {
  runId: string;
  retranscribeCount: number;
  inputIdentity: string;
  publishedAt: string;
  segments: ReadonlyArray<{
    orderIndex: number;
    publishedText: string;
    /**
     * SpeechKit raw authority only. Null for manual segments. Do not pass
     * the transient provider-input fallback (`qualityText ?? text`) here.
     */
    originalText: string | null;
  }>;
}): TranscriptEnhancementPublication {
  const segmentDigestByOrderIndex: Record<string, string> = {};
  for (const segment of params.segments) {
    if (
      !shouldRecordPublishedSegmentDigest({
        publishedText: segment.publishedText,
        originalText: segment.originalText,
      })
    ) {
      continue;
    }
    segmentDigestByOrderIndex[String(segment.orderIndex)] = digestPublishedSegmentText(
      segment.publishedText,
    );
  }
  return {
    runId: params.runId,
    retranscribeCount: params.retranscribeCount,
    inputIdentity: params.inputIdentity,
    publishedAt: params.publishedAt,
    segmentDigestByOrderIndex,
  };
}

export function mergeTranscriptEnhancementPublication(
  current: unknown,
  publication: TranscriptEnhancementPublication | null,
): ProcessingMetadata {
  return patchProcessingMetadataNamespace(
    current,
    PROCESSING_METADATA_ENHANCEMENT_PUBLICATION_NAMESPACE,
    publication,
  );
}

export function clearTranscriptEnhancementPublication(
  current: unknown,
): ProcessingMetadata {
  return mergeTranscriptEnhancementPublication(current, null);
}

/**
 * Fail-closed fence for leftover order-index keys that no longer have a
 * stable-ID owner. Retranscription still clears the sibling. Lexical
 * insert/delete/reorder remaps by stable ID instead of wiping remaining
 * publication evidence.
 */
export function invalidatePublicationAfterBroadLexicalRewrite(
  current: unknown,
): ProcessingMetadata {
  return clearTranscriptEnhancementPublication(current);
}

export type LexicalSaveRetainedSegment = {
  id: string;
  previousOrderIndex: number;
  nextOrderIndex: number;
};

/**
 * Move published digests with their stable `TranscriptSegment.id`.
 * Deleted IDs drop their digest. Inserts receive no digest. A later
 * occupant of an orderIndex cannot inherit the previous occupant's
 * digest. Publication `runId` / generation identity stay intact.
 */
export function remapPublicationDigestsByStableId(params: {
  metadata: unknown;
  retainedSegments: ReadonlyArray<LexicalSaveRetainedSegment>;
}): ProcessingMetadata {
  const publication = parseTranscriptEnhancementPublication(params.metadata);
  if (!publication) {
    return asProcessingMetadata(params.metadata);
  }
  const nextDigests: Record<string, string> = {};
  for (const segment of params.retainedSegments) {
    const digest = publication.segmentDigestByOrderIndex[String(segment.previousOrderIndex)];
    if (digest) {
      nextDigests[String(segment.nextOrderIndex)] = digest;
    }
  }
  return mergeTranscriptEnhancementPublication(params.metadata, {
    ...publication,
    segmentDigestByOrderIndex: nextDigests,
  });
}

export type LexicalSavePublicationMode = "preserve" | "invalidate_structure";
export type LexicalSaveIdentityFailure = "duplicate_segment_id" | "unknown_segment_id";

export class LexicalSaveIdentityError extends Error {
  readonly reason: LexicalSaveIdentityFailure;

  constructor(reason: LexicalSaveIdentityFailure) {
    super(
      reason === "duplicate_segment_id"
        ? "Duplicate segment identity in turns."
        : "Unknown segment identity in turns.",
    );
    this.name = "LexicalSaveIdentityError";
    this.reason = reason;
  }
}

export function normalizeSubmittedSegmentId(
  id: string | null | undefined,
): string | null {
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateSubmittedLexicalSegmentIds(params: {
  existingSegmentIds: ReadonlyArray<string>;
  submittedSegmentIds: ReadonlyArray<string | null | undefined>;
}): { ok: true } | { ok: false; reason: LexicalSaveIdentityFailure } {
  const existing = new Set(params.existingSegmentIds);
  const seen = new Set<string>();
  for (const raw of params.submittedSegmentIds) {
    const id = normalizeSubmittedSegmentId(raw);
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      return { ok: false, reason: "duplicate_segment_id" };
    }
    seen.add(id);
    if (!existing.has(id)) {
      return { ok: false, reason: "unknown_segment_id" };
    }
  }
  return { ok: true };
}

/**
 * Same-structure means the submitted sequence maps 1:1 onto the existing
 * sequence by stable `TranscriptSegment.id` in the same order.
 * Insert/delete/reorder is `invalidate_structure` only as a signal to
 * compact `orderIndex` and remap publication digests by stable ID.
 * It does not wipe remaining publication evidence.
 *
 * Existing segments whose current text is empty/whitespace may be omitted
 * from the editor payload without becoming a delete.
 */
export function decideLexicalSavePublicationMode(params: {
  previousSegmentIds: ReadonlyArray<string>;
  submittedSegmentIds: ReadonlyArray<string | null | undefined>;
}): LexicalSavePublicationMode {
  if (params.previousSegmentIds.length !== params.submittedSegmentIds.length) {
    return "invalidate_structure";
  }
  for (let index = 0; index < params.previousSegmentIds.length; index += 1) {
    const submittedId = normalizeSubmittedSegmentId(params.submittedSegmentIds[index]);
    if (!submittedId || submittedId !== params.previousSegmentIds[index]) {
      return "invalidate_structure";
    }
  }
  return "preserve";
}

export type LexicalSaveExistingSegment = {
  id: string;
  text?: string;
  orderIndex?: number;
};

export function isTrimEmptyLexicalSegmentText(text: string | undefined): boolean {
  return typeof text === "string" && text.trim().length === 0;
}

export function restoreOmittedEmptyLexicalSegmentIds(params: {
  existingSegmentIds: ReadonlyArray<string>;
  submittedSegmentIds: ReadonlyArray<string | null>;
  omittedEmptyIds: ReadonlySet<string>;
}): Array<string | null> {
  const restored: Array<string | null> = [];
  let submittedIndex = 0;
  for (const existingId of params.existingSegmentIds) {
    if (params.omittedEmptyIds.has(existingId)) {
      restored.push(existingId);
      continue;
    }
    restored.push(params.submittedSegmentIds[submittedIndex] ?? null);
    submittedIndex += 1;
  }
  while (submittedIndex < params.submittedSegmentIds.length) {
    restored.push(params.submittedSegmentIds[submittedIndex] ?? null);
    submittedIndex += 1;
  }
  return restored;
}

export type LexicalSaveSegmentOperation =
  | { type: "update"; id: string; orderIndex: number }
  | { type: "create"; orderIndex: number };

export type LexicalSaveSegmentPlan =
  | { ok: false; reason: LexicalSaveIdentityFailure }
  | {
      ok: true;
      publicationMode: LexicalSavePublicationMode;
      operations: LexicalSaveSegmentOperation[];
      deleteIds: string[];
      retainedSegments: LexicalSaveRetainedSegment[];
    };

export function planLexicalSaveSegments(params: {
  existingSegments: ReadonlyArray<LexicalSaveExistingSegment>;
  submittedSegmentIds: ReadonlyArray<string | null | undefined>;
}): LexicalSaveSegmentPlan {
  const existingSegmentIds = params.existingSegments.map((segment) => segment.id);
  const identity = validateSubmittedLexicalSegmentIds({
    existingSegmentIds,
    submittedSegmentIds: params.submittedSegmentIds,
  });
  if (!identity.ok) {
    return identity;
  }

  const submittedIds = params.submittedSegmentIds.map(normalizeSubmittedSegmentId);
  const retained = new Set(submittedIds.filter((id): id is string => id != null));
  const omitted = params.existingSegments.filter((segment) => !retained.has(segment.id));
  const omittedEmptyIds = new Set(
    omitted.filter((segment) => isTrimEmptyLexicalSegmentText(segment.text)).map((segment) => segment.id),
  );
  const restoredSubmittedIds = restoreOmittedEmptyLexicalSegmentIds({
    existingSegmentIds,
    submittedSegmentIds: submittedIds,
    omittedEmptyIds,
  });
  const publicationMode = decideLexicalSavePublicationMode({
    previousSegmentIds: existingSegmentIds,
    submittedSegmentIds: restoredSubmittedIds,
  });
  const existingById = new Map(
    params.existingSegments.map((segment, index) => [
      segment.id,
      { ...segment, orderIndex: segment.orderIndex ?? index },
    ]),
  );
  const operations: LexicalSaveSegmentOperation[] = submittedIds.map((id, submittedIndex) => {
    if (!id) {
      return { type: "create", orderIndex: submittedIndex };
    }
    const existingOrderIndex = existingById.get(id)?.orderIndex;
    return {
      type: "update",
      id,
      orderIndex:
        publicationMode === "preserve" && existingOrderIndex != null
          ? existingOrderIndex
          : submittedIndex,
    };
  });
  const retainedSegments: LexicalSaveRetainedSegment[] = [];
  for (const operation of operations) {
    if (operation.type !== "update") {
      continue;
    }
    const previous = existingById.get(operation.id);
    if (!previous) {
      continue;
    }
    retainedSegments.push({
      id: operation.id,
      previousOrderIndex: previous.orderIndex,
      nextOrderIndex: operation.orderIndex,
    });
  }
  if (publicationMode === "preserve") {
    for (const segment of omitted) {
      if (!omittedEmptyIds.has(segment.id)) {
        continue;
      }
      const previousOrderIndex = existingById.get(segment.id)?.orderIndex;
      if (previousOrderIndex == null) {
        continue;
      }
      retainedSegments.push({
        id: segment.id,
        previousOrderIndex,
        nextOrderIndex: previousOrderIndex,
      });
    }
  }
  return {
    ok: true,
    publicationMode,
    operations,
    deleteIds:
      publicationMode === "preserve"
        ? omitted.filter((segment) => !omittedEmptyIds.has(segment.id)).map((segment) => segment.id)
        : omitted.map((segment) => segment.id),
    retainedSegments,
  };
}

export function processingMetadataAfterLexicalSave(params: {
  metadata: unknown;
  mode: LexicalSavePublicationMode;
  retainedSegments?: ReadonlyArray<LexicalSaveRetainedSegment>;
}): ProcessingMetadata {
  if (params.retainedSegments) {
    return remapPublicationDigestsByStableId({
      metadata: params.metadata,
      retainedSegments: params.retainedSegments,
    });
  }
  if (params.mode === "preserve") {
    return asProcessingMetadata(params.metadata);
  }
  return remapPublicationDigestsByStableId({
    metadata: params.metadata,
    retainedSegments: [],
  });
}

/**
 * SpeechKit `qualityText` is the immutable raw backup for an existing
 * SpeechKit-derived segment. Manual text must never become that baseline.
 * New manual segments have no raw source (`null`).
 */
export function resolveQualityTextAfterLexicalSave(params: {
  matchedExistingSegment: boolean;
  previousQualityText?: string | null;
}): string | null {
  if (!params.matchedExistingSegment) {
    return null;
  }
  return params.previousQualityText ?? null;
}

/**
 * Keep only publication digests that still match current segment text.
 * Edited segments lose `applied` provenance; unchanged AI-published
 * segments keep their digest.
 */
export function dropMismatchedPublicationDigests(params: {
  metadata: unknown;
  currentRetranscribeCount: number;
  segments: ReadonlyArray<{ orderIndex: number; text: string }>;
}): ProcessingMetadata {
  const publication = parseTranscriptEnhancementPublication(params.metadata);
  if (!publication) {
    return asProcessingMetadata(params.metadata);
  }
  if (publication.retranscribeCount !== params.currentRetranscribeCount) {
    return clearTranscriptEnhancementPublication(params.metadata);
  }
  const nextDigests: Record<string, string> = {};
  const byOrder = new Map(
    params.segments.map((segment) => [String(segment.orderIndex), segment.text]),
  );
  for (const [key, digest] of Object.entries(publication.segmentDigestByOrderIndex)) {
    const text = byOrder.get(key);
    if (text != null && digestPublishedSegmentText(text) === digest) {
      nextDigests[key] = digest;
    }
  }
  return mergeTranscriptEnhancementPublication(params.metadata, {
    ...publication,
    segmentDigestByOrderIndex: nextDigests,
  });
}

export function jobDescribesSuccessfulLexicalPublication(
  job: TranscriptEnhancementJob,
): boolean {
  if (job.publicationOutcome === "published") {
    return true;
  }
  if (job.terminalQuality === "PARTIAL" || job.terminalQuality === "FAILED") {
    return false;
  }
  if (isExecutionInFlight(job.executionStatus)) {
    return false;
  }
  if (job.executionStatus === "COMPLETED" && job.terminalQuality === "COMPLETED") {
    return true;
  }
  return job.schemaVersion === "legacy" && job.status === "COMPLETED";
}

/**
 * When Repeat Improve starts, keep an already-published provenance sibling.
 * Historical COMPLETED rows without the namespace are snapshotted from current
 * published lexical text so Repeat RUNNING cannot paint them raw.
 */
export function preserveTranscriptEnhancementPublication(params: {
  metadata: unknown;
  job: TranscriptEnhancementJob;
  retranscribeCount: number;
  publishedAt?: string;
  segments: ReadonlyArray<{
    orderIndex: number;
    text: string;
    qualityText: string | null;
  }>;
}): ProcessingMetadata {
  const current = asProcessingMetadata(params.metadata);
  if (parseTranscriptEnhancementPublication(current)) {
    return current;
  }
  if (!jobDescribesSuccessfulLexicalPublication(params.job) || !params.job.runId) {
    return current;
  }
  return mergeTranscriptEnhancementPublication(
    current,
    buildTranscriptEnhancementPublication({
      runId: params.job.runId,
      retranscribeCount: params.retranscribeCount,
      inputIdentity: params.job.inputIdentity || params.job.runId,
      publishedAt: params.publishedAt ?? params.job.finishedAt ?? new Date().toISOString(),
      segments: params.segments.map((segment) => ({
        orderIndex: segment.orderIndex,
        publishedText: segment.text,
        originalText: segment.qualityText,
      })),
    }),
  );
}
