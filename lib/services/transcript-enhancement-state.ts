import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildCanonicalDiarizedText,
  toParticipantDisplayInfo,
} from "@/lib/transcription/canonical-diarized-text";
import {
  asProcessingMetadata,
  type ProcessingMetadata,
} from "@/lib/transcription/processing-metadata";
import {
  buildTranscriptEnhancementPublication,
  mergeTranscriptEnhancementPublication,
} from "@/lib/services/transcript-enhancement-publication";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";
import {
  buildSegmentEnhancementUpdates,
  shouldPersistEnhancedText,
} from "@/lib/services/transcript-enhancement-persistence";
import {
  chunkKey,
  computeEnhancementProgress,
  computePublicationEligible,
  deriveEnhancementTerminalQuality,
  isCancelledForPublication,
  isD1EnhancementJob,
  isExecutionInFlight,
  isUnfinishedChunkStatus,
  leaseIsExpired,
  mergeEnhancementJobIntoMetadata,
  parseTranscriptEnhancementJob,
  reconcileIllegalInFlightIneligibleJob,
  terminalizeEnhancementJob,
  type TranscriptEnhancementCancelReason,
  type TranscriptEnhancementDurableChunk,
  type TranscriptEnhancementJob,
  type TranscriptEnhancementPublicationOutcome,
  type TranscriptEnhancementTerminalQuality,
} from "@/lib/services/transcript-enhancement-job";
import { lockTranscriptRowForUpdate } from "@/lib/transcription/transcript-row-lock";
import { getProviderPostAttemptBudget } from "@/lib/services/transcript-enhancement-retry";
import {
  type EnhancementChunkStartDecision,
  type EnhancementChunkStartRejectionReason,
} from "@/lib/services/transcript-enhancement-start-decision";

export type TranscriptEnhancementStateDb = {
  transcript: {
    findUnique: typeof prisma.transcript.findUnique;
    update: typeof prisma.transcript.update;
  };
  transcriptSegment: {
    update: typeof prisma.transcriptSegment.update;
  };
  $transaction: typeof prisma.$transaction;
  $queryRaw?: typeof prisma.$queryRaw;
};

export type EnhancementOwnerContext = {
  runId: string;
  leaseToken: string;
  inputIdentity?: string | null;
  retranscribeCount?: number | null;
};

async function lockTranscriptRowIfSupported(
  db: { $queryRaw?: typeof prisma.$queryRaw },
  transcriptId: string,
) {
  await lockTranscriptRowForUpdate(db, transcriptId);
}

function ownerMatches(job: TranscriptEnhancementJob, owner: EnhancementOwnerContext): boolean {
  return job.runId === owner.runId && job.leaseToken === owner.leaseToken;
}

function generationMatches(
  job: TranscriptEnhancementJob,
  latestRetranscribeCount: number | null | undefined,
  owner: EnhancementOwnerContext,
): boolean {
  if (owner.inputIdentity != null && job.inputIdentity !== owner.inputIdentity) {
    return false;
  }
  if (
    owner.retranscribeCount !== undefined &&
    latestRetranscribeCount !== owner.retranscribeCount
  ) {
    return false;
  }
  if (
    job.retranscribeCount != null &&
    latestRetranscribeCount != null &&
    job.retranscribeCount !== latestRetranscribeCount
  ) {
    return false;
  }
  return true;
}

export type EnhancementJobPatchClient = {
  transcript: {
    findUnique: TranscriptEnhancementStateDb["transcript"]["findUnique"];
    update: TranscriptEnhancementStateDb["transcript"]["update"];
  };
  $queryRaw?: TranscriptEnhancementStateDb["$queryRaw"];
};

export async function applyEnhancementJobPatchOnClient(params: {
  tx: EnhancementJobPatchClient;
  transcriptId: string;
  owner?: EnhancementOwnerContext | null;
  requireOwner?: boolean;
  allowExpiredLeaseClaim?: boolean;
  nowMs?: number;
  build: (job: TranscriptEnhancementJob, metadata: ProcessingMetadata) => TranscriptEnhancementJob | null;
}): Promise<TranscriptEnhancementJob | null> {
  const nowMs = params.nowMs ?? Date.now();
  await lockTranscriptRowIfSupported(params.tx, params.transcriptId);
  const latest = await params.tx.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true, retranscribeCount: true },
  });
  if (!latest) return null;
  const metadata = asProcessingMetadata(latest.processingMetadata);
  const job = parseTranscriptEnhancementJob(metadata);
  if (params.requireOwner && params.owner) {
    if (!ownerMatches(job, params.owner)) {
      return null;
    }
  }
  if (params.allowExpiredLeaseClaim) {
    const expired = leaseIsExpired(job.leaseExpiresAt, nowMs);
    if (!expired && job.leaseToken) {
      if (!params.owner || job.leaseToken !== params.owner.leaseToken) {
        return null;
      }
    }
  }
  if (params.owner && !generationMatches(job, latest.retranscribeCount, params.owner)) {
    return null;
  }
  const next = params.build(job, metadata);
  if (!next) return next;
  await params.tx.transcript.update({
    where: { id: params.transcriptId },
    data: {
      processingMetadata: mergeEnhancementJobIntoMetadata(metadata, next) as Prisma.InputJsonValue,
    },
  });
  return next;
}

export async function patchEnhancementJob(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  owner?: EnhancementOwnerContext | null;
  requireOwner?: boolean;
  allowExpiredLeaseClaim?: boolean;
  nowMs?: number;
  build: (job: TranscriptEnhancementJob, metadata: ProcessingMetadata) => TranscriptEnhancementJob | null;
}): Promise<TranscriptEnhancementJob | null> {
  return params.db.$transaction(async (tx) =>
    applyEnhancementJobPatchOnClient({
      tx,
      transcriptId: params.transcriptId,
      owner: params.owner,
      requireOwner: params.requireOwner,
      allowExpiredLeaseClaim: params.allowExpiredLeaseClaim,
      nowMs: params.nowMs,
      build: params.build,
    }),
  );
}

export async function heartbeatEnhancementLease(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  owner: EnhancementOwnerContext;
  leaseExpiresAt: string;
  nowMs?: number;
}): Promise<boolean> {
  const next = await patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    owner: params.owner,
    requireOwner: true,
    nowMs: params.nowMs,
    build: (job) => {
      if (!isExecutionInFlight(job.executionStatus)) return null;
      return { ...job, leaseExpiresAt: params.leaseExpiresAt };
    },
  });
  return next != null;
}

export async function checkpointEnhancementChunk(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  owner: EnhancementOwnerContext;
  chunk: TranscriptEnhancementDurableChunk;
  extra?: Partial<TranscriptEnhancementJob>;
  nowMs?: number;
}): Promise<TranscriptEnhancementJob | null> {
  const nowMs = params.nowMs ?? Date.now();
  return patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    owner: params.owner,
    requireOwner: true,
    nowMs,
    build: (job) => {
      if (!isExecutionInFlight(job.executionStatus)) {
        return null;
      }
      const chunks = { ...job.chunks, [chunkKey(params.chunk.chunkIndex)]: params.chunk };
      const unpublishedByOrderIndex = { ...job.unpublishedByOrderIndex };
      if (params.chunk.status === "COMPLETED") {
        Object.assign(unpublishedByOrderIndex, params.chunk.unpublishedByOrderIndex);
      }
      const progress = computeEnhancementProgress(chunks);
      if (progress.permanentFailedChunks > 0) {
        return terminalizeEnhancementJob({
          job: {
            ...job,
            ...params.extra,
            chunks,
            unpublishedByOrderIndex,
            progress,
          },
          nowMs,
          cancelReason: job.cancelReason ?? "permanent_chunk_failure",
        });
      }
      const publicationEligible = computePublicationEligible({
        executionStatus: job.executionStatus === "QUEUED" ? "RUNNING" : job.executionStatus,
        permanentFailedChunks: progress.permanentFailedChunks,
        cancelReason: job.cancelReason,
      });
      return {
        ...job,
        ...params.extra,
        chunks,
        unpublishedByOrderIndex,
        progress,
        terminalQuality: null,
        publicationEligible,
        executionStatus: job.executionStatus === "QUEUED" ? "RUNNING" : job.executionStatus,
      };
    },
  });
}

/**
 * Authoritative pre-POST start checkpoint.
 *
 * ACCEPTED persists `attemptCount` for this authorized POST immediately before
 * the caller is allowed to open the provider socket. If the process crashes
 * after this increment and before the HTTP request is created, recovery treats
 * the attempt as consumed (fail-safe). No compensating extra attempt is added,
 * and the ≤2 POST bound is unchanged.
 *
 * REJECTED leaves attemptCount unchanged and grants no POST authority.
 */
export async function authorizeEnhancementChunkStart(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  owner: EnhancementOwnerContext;
  chunk: TranscriptEnhancementDurableChunk;
  extra?: Partial<TranscriptEnhancementJob>;
  nowMs?: number;
  attemptBudget?: number;
}): Promise<EnhancementChunkStartDecision> {
  const budget = params.attemptBudget ?? getProviderPostAttemptBudget();
  let rejection: EnhancementChunkStartRejectionReason | null = null;

  const accepted = await params.db.$transaction(async (tx) => {
    await lockTranscriptRowIfSupported(tx, params.transcriptId);
    const latest = await tx.transcript.findUnique({
      where: { id: params.transcriptId },
      select: { processingMetadata: true, retranscribeCount: true },
    });
    if (!latest) {
      rejection = "JOB_TERMINAL";
      return null;
    }
    const metadata = asProcessingMetadata(latest.processingMetadata);
    const job = parseTranscriptEnhancementJob(metadata);
    if (!ownerMatches(job, params.owner)) {
      rejection = "OWNER_STALE";
      return null;
    }
    if (!generationMatches(job, latest.retranscribeCount, params.owner)) {
      rejection = "GENERATION_STALE";
      return null;
    }
    if (isCancelledForPublication(job)) {
      rejection = "CANCELLED";
      return null;
    }
    if (!isExecutionInFlight(job.executionStatus)) {
      rejection = "JOB_TERMINAL";
      return null;
    }
    const existing = job.chunks[chunkKey(params.chunk.chunkIndex)];
    if (existing?.status === "COMPLETED") {
      rejection = "ALREADY_COMPLETE";
      return null;
    }
    if (Math.max(0, existing?.attemptCount ?? 0) >= budget) {
      rejection = "ATTEMPT_BUDGET_EXHAUSTED";
      return null;
    }

    const chunks = { ...job.chunks, [chunkKey(params.chunk.chunkIndex)]: params.chunk };
    const progress = computeEnhancementProgress(chunks);
    const publicationEligible = computePublicationEligible({
      executionStatus: job.executionStatus === "QUEUED" ? "RUNNING" : job.executionStatus,
      permanentFailedChunks: progress.permanentFailedChunks,
      cancelReason: job.cancelReason,
    });
    const next: TranscriptEnhancementJob = {
      ...job,
      ...params.extra,
      chunks,
      unpublishedByOrderIndex: job.unpublishedByOrderIndex,
      progress,
      terminalQuality: null,
      publicationEligible,
      executionStatus: job.executionStatus === "QUEUED" ? "RUNNING" : job.executionStatus,
    };
    await tx.transcript.update({
      where: { id: params.transcriptId },
      data: {
        processingMetadata: mergeEnhancementJobIntoMetadata(metadata, next) as Prisma.InputJsonValue,
      },
    });
    return next;
  });

  if (rejection) {
    return { status: "REJECTED", reason: rejection };
  }
  if (!accepted) {
    return { status: "REJECTED", reason: "JOB_TERMINAL" };
  }
  return { status: "ACCEPTED" };
}

export function finalizeTerminalQuality(progress: {
  completedChunks: number;
  permanentFailedChunks: number;
  totalChunks: number;
  runningChunks?: number;
  pendingChunks?: number;
  retryableFailedChunks?: number;
}): TranscriptEnhancementTerminalQuality {
  return deriveEnhancementTerminalQuality({
    totalChunks: progress.totalChunks,
    completedChunks: progress.completedChunks,
    runningChunks: progress.runningChunks ?? 0,
    pendingChunks: progress.pendingChunks ?? 0,
    retryableFailedChunks: progress.retryableFailedChunks ?? 0,
    permanentFailedChunks: progress.permanentFailedChunks,
  });
}

export async function revokeEnhancementPublication(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  reason: TranscriptEnhancementCancelReason;
  nowMs?: number;
  expectedRunId?: string | null;
}): Promise<{
  changed: boolean;
  job: TranscriptEnhancementJob | null;
}> {
  const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
  let changed = false;
  const job = await patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    nowMs: params.nowMs,
    build: (current) => {
      if (params.expectedRunId && current.runId && current.runId !== params.expectedRunId) {
        return current;
      }
      if (!current.publicationEligible && current.executionStatus === "CANCELLED_FOR_PUBLICATION") {
        return current;
      }
      if (!current.publicationEligible && !isExecutionInFlight(current.executionStatus)) {
        return current;
      }
      changed = current.publicationEligible || isExecutionInFlight(current.executionStatus);
      return {
        ...current,
        executionStatus: isExecutionInFlight(current.executionStatus)
          ? "CANCELLED_FOR_PUBLICATION"
          : current.executionStatus,
        publicationEligible: false,
        cancelReason: current.cancelReason ?? params.reason,
        cancelledAt: current.cancelledAt ?? nowIso,
        publicationOutcome:
          params.reason === "continue_with_current"
            ? "cancelled_continue"
            : current.publicationOutcome ?? "not_eligible",
      };
    },
  });
  return { changed, job };
}

export async function continueWithCurrentTranscript(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  nowMs?: number;
}): Promise<{
  outcome: "cancelled" | "already_not_eligible" | "not_found";
  job: TranscriptEnhancementJob | null;
}> {
  let outcome: "cancelled" | "already_not_eligible" = "already_not_eligible";
  const job = await patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    nowMs: params.nowMs,
    build: (current) => {
      if (!current.publicationEligible || !isExecutionInFlight(current.executionStatus)) {
        outcome = "already_not_eligible";
        return current;
      }
      const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
      outcome = "cancelled";
      return {
        ...current,
        executionStatus: "CANCELLED_FOR_PUBLICATION",
        publicationEligible: false,
        cancelReason: current.cancelReason ?? "continue_with_current",
        cancelledAt: current.cancelledAt ?? nowIso,
        publicationOutcome: "cancelled_continue",
      };
    },
  });
  if (!job) {
    return { outcome: "not_found", job: null };
  }
  return { outcome, job };
}

function asSpeakerMapping(value: unknown): SpeakerMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as SpeakerMapping;
}

export async function publishEnhancementIfEligible(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  owner: EnhancementOwnerContext;
  nowMs?: number;
}): Promise<{
  published: boolean;
  outcome: TranscriptEnhancementPublicationOutcome | "still_running" | "missing";
  job: TranscriptEnhancementJob | null;
}> {
  const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
  return params.db.$transaction(async (tx) => {
    await lockTranscriptRowIfSupported(tx, params.transcriptId);
    const latest = await tx.transcript.findUnique({
      where: { id: params.transcriptId },
      select: {
        processingMetadata: true,
        retranscribeCount: true,
        text: true,
        diarizedText: true,
        speakerMapping: true,
        session: {
          select: {
            participants: {
              select: {
                id: true,
                displayName: true,
                type: true,
                sessionRole: { select: { name: true } },
              },
            },
          },
        },
        segments: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            orderIndex: true,
            speakerLabel: true,
            startSeconds: true,
            endSeconds: true,
            mappedParticipantId: true,
            text: true,
            qualityText: true,
          },
        },
      },
    });
    if (!latest) {
      return { published: false, outcome: "missing" as const, job: null };
    }
    const metadata = asProcessingMetadata(latest.processingMetadata);
    const job = parseTranscriptEnhancementJob(metadata);
    if (!ownerMatches(job, params.owner) || !generationMatches(job, latest.retranscribeCount, params.owner)) {
      return { published: false, outcome: "rejected_stale" as const, job };
    }

    if (isCancelledForPublication(job)) {
      return {
        published: false,
        outcome: (job.publicationOutcome ?? "cancelled_continue") as TranscriptEnhancementPublicationOutcome,
        job,
      };
    }

    const illegal = reconcileIllegalInFlightIneligibleJob(job, params.nowMs ?? Date.now());
    if (illegal) {
      await tx.transcript.update({
        where: { id: params.transcriptId },
        data: {
          processingMetadata: mergeEnhancementJobIntoMetadata(metadata, illegal) as Prisma.InputJsonValue,
        },
      });
      return {
        published: false,
        outcome: illegal.publicationOutcome ?? "not_eligible",
        job: illegal,
      };
    }

    if (job.executionStatus === "FAILED" || job.executionStatus === "COMPLETED") {
      return {
        published: false,
        outcome: job.publicationOutcome ?? "not_eligible",
        job,
      };
    }

    const progress = computeEnhancementProgress(job.chunks);
    const unfinished = Object.values(job.chunks).some((chunk) => isUnfinishedChunkStatus(chunk.status));
    if (unfinished) {
      return { published: false, outcome: "still_running" as const, job };
    }

    const terminalQuality = deriveEnhancementTerminalQuality(progress);
    if (
      !job.publicationEligible ||
      terminalQuality !== "COMPLETED" ||
      !shouldPersistEnhancedText("COMPLETED")
    ) {
      if (!job.publicationEligible && isCancelledForPublication(job)) {
        return {
          published: false,
          outcome: job.publicationOutcome ?? "cancelled_continue",
          job,
        };
      }
      const failed = terminalizeEnhancementJob({
        job: { ...job, progress },
        nowMs: params.nowMs ?? Date.now(),
        cancelReason:
          job.cancelReason ??
          (terminalQuality === "PARTIAL" ? "permanent_chunk_failure" : "terminal_failure"),
      });
      await tx.transcript.update({
        where: { id: params.transcriptId },
        data: {
          processingMetadata: mergeEnhancementJobIntoMetadata(metadata, failed) as Prisma.InputJsonValue,
        },
      });
      return {
        published: false,
        outcome: failed.publicationOutcome ?? "not_eligible",
        job: failed,
      };
    }

    const byIndex = new Map<number, string>();
    for (const [key, text] of Object.entries(job.unpublishedByOrderIndex)) {
      const index = Number(key);
      if (Number.isFinite(index)) {
        byIndex.set(index, text);
      }
    }
    const ownedIndexes = new Set(
      Object.values(job.chunks).flatMap((chunk) => chunk.targetIndexes),
    );
    for (const index of ownedIndexes) {
      if (!byIndex.has(index)) {
        const failed = terminalizeEnhancementJob({
          job: { ...job, progress },
          nowMs: params.nowMs ?? Date.now(),
          cancelReason: job.cancelReason ?? "permanent_chunk_failure",
        });
        await tx.transcript.update({
          where: { id: params.transcriptId },
          data: {
            processingMetadata: mergeEnhancementJobIntoMetadata(metadata, failed) as Prisma.InputJsonValue,
          },
        });
        return { published: false, outcome: "partial_not_published", job: failed };
      }
    }

    const segmentUpdates = buildSegmentEnhancementUpdates(latest.segments, byIndex);
    for (const segmentUpdate of segmentUpdates) {
      await tx.transcriptSegment.update({
        where: { id: segmentUpdate.id },
        data: {
          text: segmentUpdate.text,
          qualityText: segmentUpdate.qualityText,
        },
      });
    }

    const mapping = asSpeakerMapping(latest.speakerMapping);
    const participants = (latest.session?.participants ?? []).map(toParticipantDisplayInfo);
    const publishedSegments = latest.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel: null as string | null,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: byIndex.get(segment.orderIndex)?.trim() || segment.text,
      orderIndex: segment.orderIndex,
    }));
    const enhancedTranscriptText = publishedSegments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    const enhancedDiarizedText =
      publishedSegments.length > 0
        ? buildCanonicalDiarizedText({
            segments: publishedSegments,
            speakerMapping: mapping,
            participants,
          })
        : latest.diarizedText;

    const next: TranscriptEnhancementJob = {
      ...job,
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      finishedAt: nowIso,
      cancelReason: job.cancelReason,
      publicationOutcome: "published",
      progress,
    };
    const publication = buildTranscriptEnhancementPublication({
      runId: next.runId ?? params.owner.runId,
      retranscribeCount: latest.retranscribeCount ?? 0,
      inputIdentity: next.inputIdentity || params.owner.inputIdentity || "",
      publishedAt: nowIso,
      segments: latest.segments.map((segment) => ({
        orderIndex: segment.orderIndex,
        publishedText: byIndex.get(segment.orderIndex)?.trim() || segment.text,
        originalText: segment.qualityText,
      })),
    });
    await tx.transcript.update({
      where: { id: params.transcriptId },
      data: {
        text: enhancedTranscriptText.length > 0 ? enhancedTranscriptText : latest.text,
        diarizedText: enhancedDiarizedText ?? latest.diarizedText,
        processingMetadata: mergeTranscriptEnhancementPublication(
          mergeEnhancementJobIntoMetadata(metadata, next),
          publication,
        ) as Prisma.InputJsonValue,
      },
    });
    return { published: true, outcome: "published" as const, job: next };
  });
}

export async function markEnhancementExecutionFailed(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  owner: EnhancementOwnerContext;
  errorMessage?: string | null;
  nowMs?: number;
}): Promise<void> {
  await patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    owner: params.owner,
    requireOwner: true,
    nowMs: params.nowMs,
    build: (job) => {
      if (!isExecutionInFlight(job.executionStatus)) return null;
      return terminalizeEnhancementJob({
        job,
        nowMs: params.nowMs ?? Date.now(),
        cancelReason: job.cancelReason ?? "terminal_failure",
      });
    },
  });
}

export function convertInterruptedRunningChunks(
  chunks: Record<string, TranscriptEnhancementDurableChunk>,
): Record<string, TranscriptEnhancementDurableChunk> {
  const next = { ...chunks };
  for (const [key, chunk] of Object.entries(next)) {
    if (chunk.status === "RUNNING") {
      next[key] = {
        ...chunk,
        status: "RETRYABLE_FAILED",
        finishedAt: chunk.finishedAt,
      };
    }
  }
  return next;
}

export async function fenceEligibleEnhancementOnClient(params: {
  tx: EnhancementJobPatchClient;
  transcriptId: string;
  reason: TranscriptEnhancementCancelReason;
  nowMs?: number;
}): Promise<TranscriptEnhancementJob | null> {
  const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
  return applyEnhancementJobPatchOnClient({
    tx: params.tx,
    transcriptId: params.transcriptId,
    nowMs: params.nowMs,
    build: (current) => {
      if (!current.publicationEligible && !isExecutionInFlight(current.executionStatus)) {
        return null;
      }
      return {
        ...current,
        executionStatus: isExecutionInFlight(current.executionStatus)
          ? "CANCELLED_FOR_PUBLICATION"
          : current.executionStatus,
        publicationEligible: false,
        cancelReason: current.cancelReason ?? params.reason,
        cancelledAt: current.cancelledAt ?? nowIso,
        publicationOutcome:
          params.reason === "continue_with_current"
            ? "cancelled_continue"
            : current.publicationOutcome ?? "not_eligible",
      };
    },
  });
}

export async function claimEnhancementLease(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  newLeaseToken: string;
  leaseExpiresAt: string;
  nowMs?: number;
}): Promise<TranscriptEnhancementJob | null> {
  const nowMs = params.nowMs ?? Date.now();
  return patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    allowExpiredLeaseClaim: true,
    nowMs,
    build: (job) => {
      if (!job.publicationEligible || !isExecutionInFlight(job.executionStatus)) {
        return null;
      }
      if (!leaseIsExpired(job.leaseExpiresAt, nowMs) && job.leaseToken) {
        return null;
      }
      if (!isD1EnhancementJob(job)) {
        return {
          ...job,
          executionStatus: "FAILED",
          publicationEligible: false,
          terminalQuality: "FAILED",
          cancelReason: "undurable_legacy_running",
          cancelledAt: new Date(nowMs).toISOString(),
          finishedAt: new Date(nowMs).toISOString(),
        };
      }
      const chunks = convertInterruptedRunningChunks(job.chunks);
      const progress = computeEnhancementProgress(chunks);
      return {
        ...job,
        leaseToken: params.newLeaseToken,
        leaseExpiresAt: params.leaseExpiresAt,
        chunks,
        progress,
        executionStatus: "RUNNING",
      };
    },
  });
}

export async function reconcileIllegalEnhancementJob(params: {
  db: TranscriptEnhancementStateDb;
  transcriptId: string;
  nowMs?: number;
}): Promise<TranscriptEnhancementJob | null> {
  return patchEnhancementJob({
    db: params.db,
    transcriptId: params.transcriptId,
    nowMs: params.nowMs,
    build: (job) => reconcileIllegalInFlightIneligibleJob(job, params.nowMs ?? Date.now()),
  });
}