import {
  asProcessingMetadata,
  getTranscriptEnhancementNamespace,
  mergeProcessingMetadata,
  type ProcessingMetadata,
} from "@/lib/transcription/processing-metadata";

export const ENHANCEMENT_D1_SCHEMA_VERSION = "d1-v1";

export type TranscriptEnhancementExecutionStatus =
  | "NOT_STARTED"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED_FOR_PUBLICATION";

export type TranscriptEnhancementTerminalQuality = "COMPLETED" | "PARTIAL" | "FAILED";

export type TranscriptEnhancementChunkStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "RETRYABLE_FAILED"
  | "FAILED";

export type TranscriptEnhancementCancelReason =
  | "continue_with_current"
  | "lexical_save"
  | "retranscription"
  | "identity_mismatch"
  | "permanent_chunk_failure"
  | "published"
  | "terminal_failure"
  | "undurable_legacy_running"
  | "t3_safety_deadline";

export type TranscriptEnhancementPublicationOutcome =
  | "published"
  | "rejected_stale"
  | "cancelled_continue"
  | "not_eligible"
  | "partial_not_published"
  | "failed_not_published";

export type TranscriptEnhancementProgress = {
  totalChunks: number;
  completedChunks: number;
  runningChunks: number;
  pendingChunks: number;
  retryableFailedChunks: number;
  permanentFailedChunks: number;
};

export type TranscriptEnhancementDurablePiece = {
  index: number;
  sourceIndex: number;
  pieceIndex: number;
  pieceCount: number;
  prefixText: string;
  separatorAfter: string;
};

export type TranscriptEnhancementDurableChunk = {
  chunkIndex: number;
  status: TranscriptEnhancementChunkStatus;
  targetIndexes: number[];
  targetPieces?: TranscriptEnhancementDurablePiece[];
  attemptCount: number;
  unpublishedByOrderIndex: Record<string, string>;
  lastErrorClass: string | null;
  lastHttpClass: string | null;
  lastSchemaResult: string | null;
  providerDurationMs: number | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  usageTotalTokens: number | null;
  usageClassification: "provider" | "unknown" | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TranscriptEnhancementJob = {
  schemaVersion: typeof ENHANCEMENT_D1_SCHEMA_VERSION | "legacy";
  jobId: string | null;
  runId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  executionStatus: TranscriptEnhancementExecutionStatus;
  publicationEligible: boolean;
  terminalQuality: TranscriptEnhancementTerminalQuality | null;
  inputIdentity: string | null;
  retranscribeCount: number | null;
  triggerSource: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  publicationOutcome: TranscriptEnhancementPublicationOutcome | null;
  progress: TranscriptEnhancementProgress;
  chunks: Record<string, TranscriptEnhancementDurableChunk>;
  unpublishedByOrderIndex: Record<string, string>;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  safetyDeadlineAt: string | null;
  skipReason: string | null;
  /** Legacy one-layer status, also mirrored for older readers. */
  status: string | null;
};

export type TranscriptEnhancementStatusProjection = {
  uiStatus:
    | "NOT_AVAILABLE"
    | "IDLE"
    | "SUGGESTED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED"
    | "SKIPPED";
  executionStatus: TranscriptEnhancementExecutionStatus;
  publicationEligible: boolean;
  terminalQuality: TranscriptEnhancementTerminalQuality | null;
  progress: TranscriptEnhancementProgress;
  continueAvailable: boolean;
  improveAvailable: boolean;
  mappingAvailable: boolean;
  lexicalEditAvailable: boolean;
  inProgress: boolean;
  cancelReason: string | null;
  skipReason: string | null;
};

const EMPTY_PROGRESS: TranscriptEnhancementProgress = {
  totalChunks: 0,
  completedChunks: 0,
  runningChunks: 0,
  pendingChunks: 0,
  retryableFailedChunks: 0,
  permanentFailedChunks: 0,
};

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") {
      out[key] = item;
    }
  }
  return out;
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

export function isExecutionInFlight(
  status: TranscriptEnhancementExecutionStatus | string | null | undefined,
): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

export function isLegacyRunningAlias(status: unknown): boolean {
  return status === "RUNNING" || status === "IN_PROGRESS" || status === "QUEUED";
}

export function computeEnhancementProgress(
  chunks: Record<string, TranscriptEnhancementDurableChunk>,
): TranscriptEnhancementProgress {
  const values = Object.values(chunks);
  const progress: TranscriptEnhancementProgress = {
    totalChunks: values.length,
    completedChunks: 0,
    runningChunks: 0,
    pendingChunks: 0,
    retryableFailedChunks: 0,
    permanentFailedChunks: 0,
  };
  for (const chunk of values) {
    if (chunk.status === "COMPLETED") progress.completedChunks += 1;
    else if (chunk.status === "RUNNING") progress.runningChunks += 1;
    else if (chunk.status === "PENDING") progress.pendingChunks += 1;
    else if (chunk.status === "RETRYABLE_FAILED") progress.retryableFailedChunks += 1;
    else if (chunk.status === "FAILED") progress.permanentFailedChunks += 1;
  }
  return progress;
}

export function computePublicationEligible(params: {
  executionStatus: TranscriptEnhancementExecutionStatus;
  permanentFailedChunks: number;
  cancelReason?: string | null;
}): boolean {
  return (
    isExecutionInFlight(params.executionStatus) &&
    params.permanentFailedChunks === 0 &&
    !params.cancelReason
  );
}

export function unfinishedEnhancementChunkCount(
  progress: TranscriptEnhancementProgress,
): number {
  return progress.pendingChunks + progress.runningChunks + progress.retryableFailedChunks;
}

export function failUnfinishedEnhancementChunks(
  chunks: Record<string, TranscriptEnhancementDurableChunk>,
  nowIso: string,
): Record<string, TranscriptEnhancementDurableChunk> {
  const next = { ...chunks };
  for (const [key, chunk] of Object.entries(next)) {
    if (isUnfinishedChunkStatus(chunk.status)) {
      next[key] = {
        ...chunk,
        status: "FAILED",
        finishedAt: chunk.finishedAt ?? nowIso,
      };
    }
  }
  return next;
}

/**
 * Terminal quality after unfinished buckets have been converted to FAILED.
 * Never returns COMPLETED while unfinished work remains.
 */
export function deriveEnhancementTerminalQuality(
  progress: TranscriptEnhancementProgress,
): TranscriptEnhancementTerminalQuality {
  const unfinished = unfinishedEnhancementChunkCount(progress);
  if (unfinished > 0) {
    return "FAILED";
  }
  if (progress.totalChunks === 0) {
    return "FAILED";
  }
  if (progress.permanentFailedChunks === 0 && progress.completedChunks === progress.totalChunks) {
    return "COMPLETED";
  }
  if (progress.completedChunks > 0 && progress.permanentFailedChunks > 0) {
    return "PARTIAL";
  }
  return "FAILED";
}

export function isCancelledForPublication(job: Pick<
  TranscriptEnhancementJob,
  "executionStatus"
>): boolean {
  return job.executionStatus === "CANCELLED_FOR_PUBLICATION";
}

export function isIllegalInFlightIneligible(job: Pick<
  TranscriptEnhancementJob,
  "executionStatus" | "publicationEligible"
>): boolean {
  return isExecutionInFlight(job.executionStatus) && job.publicationEligible === false;
}

export function terminalizeEnhancementJob(params: {
  job: TranscriptEnhancementJob;
  nowMs: number;
  cancelReason?: TranscriptEnhancementCancelReason | string | null;
}): TranscriptEnhancementJob {
  const nowIso = new Date(params.nowMs).toISOString();
  const chunks = failUnfinishedEnhancementChunks(params.job.chunks, nowIso);
  const progress = computeEnhancementProgress(chunks);
  const terminalQuality = deriveEnhancementTerminalQuality(progress);
  const cancelReason =
    params.cancelReason ??
    params.job.cancelReason ??
    (terminalQuality === "PARTIAL" ? "permanent_chunk_failure" : "terminal_failure");
  return {
    ...params.job,
    chunks,
    progress,
    executionStatus: "FAILED",
    publicationEligible: false,
    terminalQuality,
    finishedAt: nowIso,
    cancelReason,
    publicationOutcome:
      terminalQuality === "PARTIAL" ? "partial_not_published" : "failed_not_published",
    status: terminalQuality === "PARTIAL" ? "PARTIAL" : "FAILED",
  };
}

/**
 * Historical RUNNING/QUEUED + publicationEligible=false must not stay
 * abandoned. Do not re-enable publication eligibility.
 */
export function reconcileIllegalInFlightIneligibleJob(
  job: TranscriptEnhancementJob,
  nowMs: number,
): TranscriptEnhancementJob | null {
  if (!isIllegalInFlightIneligible(job)) {
    return null;
  }
  const skipLike =
    job.cancelReason === "continue_with_current" ||
    job.cancelReason === "lexical_save" ||
    job.cancelReason === "retranscription";
  if (skipLike) {
    const nowIso = new Date(nowMs).toISOString();
    return {
      ...job,
      executionStatus: "CANCELLED_FOR_PUBLICATION",
      publicationEligible: false,
      terminalQuality: null,
      finishedAt: job.finishedAt ?? nowIso,
      cancelledAt: job.cancelledAt ?? nowIso,
      status: "SKIPPED",
    };
  }
  return terminalizeEnhancementJob({
    job,
    nowMs,
    cancelReason: job.cancelReason ?? "permanent_chunk_failure",
  });
}

export function mirrorLegacyStatus(job: Pick<
  TranscriptEnhancementJob,
  "executionStatus" | "terminalQuality" | "skipReason" | "status"
>): string {
  if (job.executionStatus === "QUEUED" || job.executionStatus === "RUNNING") {
    return "RUNNING";
  }
  if (job.executionStatus === "CANCELLED_FOR_PUBLICATION") {
    return "SKIPPED";
  }
  if (job.executionStatus === "FAILED") {
    if (job.terminalQuality === "PARTIAL") return "PARTIAL";
    return "FAILED";
  }
  if (job.executionStatus === "COMPLETED") {
    if (job.terminalQuality === "PARTIAL") return "PARTIAL";
    if (job.terminalQuality === "FAILED") return "FAILED";
    return "COMPLETED";
  }
  if (job.skipReason) return "SKIPPED";
  return job.status ?? "NOT_STARTED";
}

function parseTargetPieces(raw: unknown): TranscriptEnhancementDurablePiece[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const pieces: TranscriptEnhancementDurablePiece[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const index = asFiniteNumber(record.index);
    const sourceIndex = asFiniteNumber(record.sourceIndex);
    const pieceIndex = asFiniteNumber(record.pieceIndex);
    const pieceCount = asFiniteNumber(record.pieceCount);
    if (
      index == null ||
      sourceIndex == null ||
      pieceIndex == null ||
      pieceCount == null
    ) {
      continue;
    }
    pieces.push({
      index,
      sourceIndex,
      pieceIndex,
      pieceCount,
      prefixText: typeof record.prefixText === "string" ? record.prefixText : "",
      separatorAfter:
        typeof record.separatorAfter === "string" ? record.separatorAfter : "",
    });
  }
  return pieces;
}

function parseChunk(raw: unknown, fallbackIndex: number): TranscriptEnhancementDurableChunk {
  const record = asProcessingMetadata(raw);
  const chunkIndex = asFiniteNumber(record.chunkIndex) ?? fallbackIndex;
  const statusRaw = record.status;
  const status: TranscriptEnhancementChunkStatus =
    statusRaw === "RUNNING" ||
    statusRaw === "COMPLETED" ||
    statusRaw === "RETRYABLE_FAILED" ||
    statusRaw === "FAILED" ||
    statusRaw === "PENDING"
      ? statusRaw
      : "PENDING";
  return {
    chunkIndex,
    status,
    targetIndexes: asNumberArray(record.targetIndexes),
    targetPieces: parseTargetPieces(record.targetPieces),
    attemptCount: asFiniteNumber(record.attemptCount) ?? 0,
    unpublishedByOrderIndex: asStringRecord(record.unpublishedByOrderIndex),
    lastErrorClass: asIsoString(record.lastErrorClass) ?? asIsoString(record.errorClass),
    lastHttpClass: asIsoString(record.lastHttpClass),
    lastSchemaResult: asIsoString(record.lastSchemaResult),
    providerDurationMs: asFiniteNumber(record.providerDurationMs),
    usageInputTokens: asFiniteNumber(record.usageInputTokens),
    usageOutputTokens: asFiniteNumber(record.usageOutputTokens),
    usageTotalTokens: asFiniteNumber(record.usageTotalTokens),
    usageClassification:
      record.usageClassification === "provider" || record.usageClassification === "unknown"
        ? record.usageClassification
        : null,
    startedAt: asIsoString(record.startedAt),
    finishedAt: asIsoString(record.finishedAt),
  };
}

function parseChunks(raw: unknown): Record<string, TranscriptEnhancementDurableChunk> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, TranscriptEnhancementDurableChunk> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = Number(key);
    out[key] = parseChunk(value, Number.isFinite(numeric) ? numeric : 0);
  }
  return out;
}

function parseExecutionStatus(value: unknown): TranscriptEnhancementExecutionStatus | null {
  if (
    value === "NOT_STARTED" ||
    value === "QUEUED" ||
    value === "RUNNING" ||
    value === "COMPLETED" ||
    value === "FAILED" ||
    value === "CANCELLED_FOR_PUBLICATION"
  ) {
    return value;
  }
  return null;
}

function parseTerminalQuality(value: unknown): TranscriptEnhancementTerminalQuality | null {
  if (value === "COMPLETED" || value === "PARTIAL" || value === "FAILED") {
    return value;
  }
  return null;
}

/**
 * Compatibility projection: old one-layer status → three-layer job.
 * Does not mutate the stored JSON.
 */
export function parseTranscriptEnhancementJob(
  processingMetadata: unknown,
): TranscriptEnhancementJob {
  const ns = getTranscriptEnhancementNamespace(processingMetadata);
  const schemaVersion =
    ns.schemaVersion === ENHANCEMENT_D1_SCHEMA_VERSION ? ENHANCEMENT_D1_SCHEMA_VERSION : "legacy";
  const chunks = parseChunks(ns.chunks);
  const unpublishedByOrderIndex = {
    ...asStringRecord(ns.unpublishedByOrderIndex),
  };
  for (const chunk of Object.values(chunks)) {
    if (chunk.status === "COMPLETED") {
      Object.assign(unpublishedByOrderIndex, chunk.unpublishedByOrderIndex);
    }
  }
  const progressFromChunks = computeEnhancementProgress(chunks);
  const storedProgress = asProcessingMetadata(ns.progress);
  const progress: TranscriptEnhancementProgress =
    progressFromChunks.totalChunks > 0
      ? progressFromChunks
      : {
          totalChunks: asFiniteNumber(storedProgress.totalChunks) ?? 0,
          completedChunks: asFiniteNumber(storedProgress.completedChunks) ?? 0,
          runningChunks: asFiniteNumber(storedProgress.runningChunks) ?? 0,
          pendingChunks: asFiniteNumber(storedProgress.pendingChunks) ?? 0,
          retryableFailedChunks: asFiniteNumber(storedProgress.retryableFailedChunks) ?? 0,
          permanentFailedChunks: asFiniteNumber(storedProgress.permanentFailedChunks) ?? 0,
        };

  const executionFromField = parseExecutionStatus(ns.executionStatus);
  const legacyStatus = typeof ns.status === "string" ? ns.status : null;
  let executionStatus: TranscriptEnhancementExecutionStatus = "NOT_STARTED";
  let terminalQuality = parseTerminalQuality(ns.terminalQuality);
  let publicationEligible = asBoolean(ns.publicationEligible, false);
  let skipReason = asIsoString(ns.skipReason);

  if (executionFromField) {
    executionStatus = executionFromField;
    if (ns.publicationEligible === undefined) {
      publicationEligible = computePublicationEligible({
        executionStatus,
        permanentFailedChunks: progress.permanentFailedChunks,
        cancelReason: asIsoString(ns.cancelReason),
      });
    }
  } else if (isLegacyRunningAlias(legacyStatus)) {
    executionStatus = legacyStatus === "QUEUED" ? "QUEUED" : "RUNNING";
    publicationEligible = true;
    terminalQuality = null;
  } else if (legacyStatus === "COMPLETED") {
    executionStatus = "COMPLETED";
    terminalQuality = "COMPLETED";
    publicationEligible = false;
  } else if (legacyStatus === "PARTIAL") {
    executionStatus = "COMPLETED";
    terminalQuality = "PARTIAL";
    publicationEligible = false;
  } else if (legacyStatus === "FAILED") {
    executionStatus = "FAILED";
    terminalQuality = "FAILED";
    publicationEligible = false;
  } else if (legacyStatus === "SKIPPED") {
    executionStatus = "NOT_STARTED";
    publicationEligible = false;
    skipReason = skipReason ?? "historical_skipped";
  }

  return {
    schemaVersion,
    jobId: asIsoString(ns.jobId) ?? asIsoString(ns.runId),
    runId: asIsoString(ns.runId),
    leaseToken: asIsoString(ns.leaseToken),
    leaseExpiresAt: asIsoString(ns.leaseExpiresAt),
    executionStatus,
    publicationEligible,
    terminalQuality,
    inputIdentity: asIsoString(ns.inputIdentity),
    retranscribeCount: asFiniteNumber(ns.retranscribeCount),
    triggerSource: asIsoString(ns.triggerSource),
    cancelReason: asIsoString(ns.cancelReason),
    cancelledAt: asIsoString(ns.cancelledAt),
    publicationOutcome: (asIsoString(ns.publicationOutcome) as TranscriptEnhancementPublicationOutcome | null),
    progress: progress.totalChunks > 0 ? progress : EMPTY_PROGRESS,
    chunks,
    unpublishedByOrderIndex,
    queuedAt: asIsoString(ns.queuedAt),
    startedAt: asIsoString(ns.startedAt),
    finishedAt: asIsoString(ns.finishedAt),
    safetyDeadlineAt: asIsoString(ns.safetyDeadlineAt),
    skipReason,
    status: legacyStatus,
  };
}

export function isD1EnhancementJob(job: TranscriptEnhancementJob): boolean {
  return job.schemaVersion === ENHANCEMENT_D1_SCHEMA_VERSION && Object.keys(job.chunks).length > 0;
}

export function projectTranscriptEnhancementStatus(
  processingMetadata: unknown,
): TranscriptEnhancementStatusProjection {
  const metadata = asProcessingMetadata(processingMetadata);
  const recommendation = asProcessingMetadata(metadata.transcriptEnhancementRecommendation);
  const job = parseTranscriptEnhancementJob(processingMetadata);
  const inProgress = isExecutionInFlight(job.executionStatus);
  let uiStatus: TranscriptEnhancementStatusProjection["uiStatus"] = "IDLE";
  if (metadata.transcriptionProvider !== "yandex_speechkit" && !job.status && job.executionStatus === "NOT_STARTED") {
    uiStatus = "NOT_AVAILABLE";
  } else if (inProgress) {
    uiStatus = "IN_PROGRESS";
  } else if (job.executionStatus === "CANCELLED_FOR_PUBLICATION") {
    uiStatus = "SKIPPED";
  } else if (job.terminalQuality === "PARTIAL") {
    uiStatus = "PARTIAL";
  } else if (job.executionStatus === "FAILED") {
    uiStatus = "FAILED";
  } else if (job.executionStatus === "COMPLETED") {
    uiStatus = "COMPLETED";
  } else if (job.skipReason || job.status === "SKIPPED") {
    uiStatus = "SKIPPED";
  } else if (recommendation.suggested === true) {
    uiStatus = "SUGGESTED";
  } else if (metadata.transcriptionProvider === "yandex_speechkit") {
    uiStatus = "IDLE";
  }

  const continueAvailable = job.publicationEligible && inProgress;
  const improveAvailable =
    !inProgress &&
    (job.executionStatus === "COMPLETED" ||
      job.executionStatus === "FAILED" ||
      job.executionStatus === "CANCELLED_FOR_PUBLICATION" ||
      job.skipReason === "timeout" ||
      job.status === "SKIPPED" ||
      job.executionStatus === "NOT_STARTED");

  return {
    uiStatus,
    executionStatus: job.executionStatus,
    publicationEligible: job.publicationEligible,
    terminalQuality: inProgress ? null : job.terminalQuality,
    progress: job.progress,
    continueAvailable,
    improveAvailable,
    mappingAvailable: true,
    lexicalEditAvailable: !job.publicationEligible,
    inProgress,
    cancelReason: job.cancelReason,
    skipReason: job.skipReason,
  };
}

export function toDurableEnhancementPieces(
  targets: Array<{
    index: number;
    sourceIndex: number;
    pieceIndex: number;
    pieceCount: number;
    prefixText: string;
    separatorAfter: string;
  }>,
): TranscriptEnhancementDurablePiece[] {
  return targets.map((target) => ({
    index: target.index,
    sourceIndex: target.sourceIndex,
    pieceIndex: target.pieceIndex,
    pieceCount: target.pieceCount,
    prefixText: target.prefixText,
    separatorAfter: target.separatorAfter,
  }));
}

export function collectDurableEnhancementPieces(
  chunks: Record<string, TranscriptEnhancementDurableChunk>,
): TranscriptEnhancementDurablePiece[] {
  return Object.values(chunks).flatMap((chunk) => chunk.targetPieces ?? []);
}

export function unpublishedCoversOwnedSourceIndexes(
  unpublishedByOrderIndex: Record<string, string>,
  ownedSourceIndexes: Iterable<number>,
): boolean {
  const present = new Set<number>();
  for (const key of Object.keys(unpublishedByOrderIndex)) {
    const index = Number(key);
    if (Number.isFinite(index)) {
      present.add(index);
    }
  }
  for (const index of ownedSourceIndexes) {
    if (!present.has(index)) {
      return false;
    }
  }
  return true;
}

export function withPreservedTargetPieces(
  incoming: TranscriptEnhancementDurableChunk,
  existing?: TranscriptEnhancementDurableChunk | null,
): TranscriptEnhancementDurableChunk {
  const incomingPieces = incoming.targetPieces ?? [];
  if (incomingPieces.length > 0 || !existing?.targetPieces?.length) {
    return incoming;
  }
  return { ...incoming, targetPieces: existing.targetPieces };
}

export function serializeEnhancementJob(job: TranscriptEnhancementJob): ProcessingMetadata {
  return {
    schemaVersion: job.schemaVersion === "legacy" ? ENHANCEMENT_D1_SCHEMA_VERSION : job.schemaVersion,
    jobId: job.jobId,
    runId: job.runId,
    leaseToken: job.leaseToken,
    leaseExpiresAt: job.leaseExpiresAt,
    executionStatus: job.executionStatus,
    publicationEligible: job.publicationEligible,
    terminalQuality: job.terminalQuality,
    inputIdentity: job.inputIdentity,
    retranscribeCount: job.retranscribeCount,
    triggerSource: job.triggerSource,
    cancelReason: job.cancelReason,
    cancelledAt: job.cancelledAt,
    publicationOutcome: job.publicationOutcome,
    progress: job.progress,
    chunks: job.chunks,
    unpublishedByOrderIndex: job.unpublishedByOrderIndex,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    safetyDeadlineAt: job.safetyDeadlineAt,
    skipReason: job.skipReason,
    status: mirrorLegacyStatus(job),
  };
}

export function mergeEnhancementJobIntoMetadata(
  current: unknown,
  job: TranscriptEnhancementJob,
  extraNamespaceFields?: ProcessingMetadata,
): ProcessingMetadata {
  const currentNs = getTranscriptEnhancementNamespace(current);
  return mergeProcessingMetadata(current, {
    transcriptEnhancement: {
      ...currentNs,
      ...serializeEnhancementJob(job),
      ...extraNamespaceFields,
    },
  });
}

export function fenceEnhancementJobInMetadata(
  current: unknown,
  reason: TranscriptEnhancementCancelReason,
  nowMs = Date.now(),
): ProcessingMetadata {
  const job = parseTranscriptEnhancementJob(current);
  if (!job.publicationEligible && !isExecutionInFlight(job.executionStatus)) {
    return asProcessingMetadata(current);
  }
  const nowIso = new Date(nowMs).toISOString();
  return mergeEnhancementJobIntoMetadata(current, {
    ...job,
    executionStatus: isExecutionInFlight(job.executionStatus)
      ? "CANCELLED_FOR_PUBLICATION"
      : job.executionStatus,
    publicationEligible: false,
    cancelReason: job.cancelReason ?? reason,
    cancelledAt: job.cancelledAt ?? nowIso,
    publicationOutcome:
      reason === "continue_with_current"
        ? "cancelled_continue"
        : job.publicationOutcome ?? "not_eligible",
  });
}

export function shouldFenceEnhancementOnRetranscribe(processingMetadata: unknown): boolean {
  const job = parseTranscriptEnhancementJob(processingMetadata);
  return job.publicationEligible || isExecutionInFlight(job.executionStatus);
}

export function emptyEnhancementProgress(totalChunks = 0): TranscriptEnhancementProgress {
  return {
    ...EMPTY_PROGRESS,
    totalChunks,
    pendingChunks: totalChunks,
  };
}

export function chunkKey(chunkIndex: number): string {
  return String(chunkIndex);
}

export function isUnfinishedChunkStatus(status: TranscriptEnhancementChunkStatus): boolean {
  return status === "PENDING" || status === "RUNNING" || status === "RETRYABLE_FAILED";
}

export function leaseIsExpired(leaseExpiresAt: string | null, nowMs: number): boolean {
  if (!leaseExpiresAt) return true;
  const parsed = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(parsed)) return true;
  return parsed <= nowMs;
}

export const ENHANCEMENT_PUBLICATION_ELIGIBLE_AI_LOCK_MESSAGE =
  "AI analysis cannot start while transcript enhancement is still eligible to publish.";

export const ENHANCEMENT_PUBLICATION_ELIGIBLE_EDIT_MESSAGE =
  "Transcript lexical text cannot be changed while enhancement is still eligible to publish. Use Continue to accept the current transcript, or wait for publication.";
