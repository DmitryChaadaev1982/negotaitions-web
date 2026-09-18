import { randomUUID } from "node:crypto";

import {
  getTranscriptEnhancementLeaseTtlMs,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  isD1EnhancementJob,
  isExecutionInFlight,
  isIllegalInFlightIneligible,
  leaseIsExpired,
  parseTranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import {
  runAdmittedEnhancementJob,
  type TranscriptEnhancementDbClient,
} from "@/lib/services/transcript-enhancement-orchestration";
import { resolveEnhancementOriginalText } from "@/lib/services/transcript-enhancement-persistence";
import {
  claimEnhancementLease,
  reconcileIllegalEnhancementJob,
} from "@/lib/services/transcript-enhancement-state";
import type { TranscriptEnhancementInputSegment } from "@/lib/services/yandex-transcript-enhancement";

export type EnhancementRecoveryClock = {
  now: () => number;
};

export type EnhancementRecoveryResult = {
  scanned: number;
  claimed: number;
  resumed: number;
  skippedActiveLease: number;
  skippedCancelled: number;
  skippedUndurable: number;
  reconciledIllegal: number;
  failures: number;
};

function mapSegments(segments: Array<{
  orderIndex: number;
  speakerLabel: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  mappedParticipantId: string | null;
  text: string;
  qualityText: string | null;
  id: string;
}>): TranscriptEnhancementInputSegment[] {
  return segments.map((segment) => ({
    index: segment.orderIndex,
    speakerLabel: segment.speakerLabel ?? "Speaker",
    startMs:
      segment.startSeconds !== null ? Math.round(segment.startSeconds * 1000) : null,
    endMs:
      segment.endSeconds !== null ? Math.round(segment.endSeconds * 1000) : null,
    originalText: resolveEnhancementOriginalText(segment),
    segmentId: segment.id,
    mappedParticipantId: segment.mappedParticipantId,
  }));
}

async function listRecoverableTranscriptIds(params: {
  db: TranscriptEnhancementDbClient;
  nowIso: string;
  limit: number;
  transcriptIds?: string[];
}): Promise<string[]> {
  if (params.transcriptIds) {
    return params.transcriptIds;
  }
  if (typeof params.db.$queryRaw !== "function") {
    return [];
  }
  const rows = await params.db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Transcript"
    WHERE (
      ("processingMetadata"->'transcriptEnhancement'->>'executionStatus') IN ('QUEUED', 'RUNNING')
      OR ("processingMetadata"->'transcriptEnhancement'->>'status') IN ('QUEUED', 'RUNNING', 'IN_PROGRESS')
    )
    AND (
      COALESCE("processingMetadata"->'transcriptEnhancement'->>'publicationEligible', 'true') = 'false'
      OR (
        COALESCE("processingMetadata"->'transcriptEnhancement'->>'publicationEligible', 'true') <> 'false'
        AND (
          "processingMetadata"->'transcriptEnhancement'->>'leaseExpiresAt' IS NULL
          OR ("processingMetadata"->'transcriptEnhancement'->>'leaseExpiresAt') < ${params.nowIso}
        )
      )
    )
    LIMIT ${params.limit}
  `;
  return rows.map((row) => row.id);
}

/**
 * One recovery tick. Deterministic for tests via `now` and optional ids.
 * Does not depend on Materials/status traffic.
 */
export async function runTranscriptEnhancementRecoveryTick(params?: {
  db?: TranscriptEnhancementDbClient;
  now?: () => number;
  limit?: number;
  transcriptIds?: string[];
  resume?: boolean;
  dryRun?: boolean;
  runJob?: typeof runAdmittedEnhancementJob;
}): Promise<EnhancementRecoveryResult> {
  const db = params?.db ?? (prisma as TranscriptEnhancementDbClient);
  const now = params?.now ?? Date.now;
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 500));
  const ids = await listRecoverableTranscriptIds({
    db,
    nowIso,
    limit,
    transcriptIds: params?.transcriptIds,
  });
  const result: EnhancementRecoveryResult = {
    scanned: ids.length,
    claimed: 0,
    resumed: 0,
    skippedActiveLease: 0,
    skippedCancelled: 0,
    skippedUndurable: 0,
    reconciledIllegal: 0,
    failures: 0,
  };
  if (params?.dryRun) {
    return result;
  }

  for (const transcriptId of ids) {
    const latest = await db.transcript.findUnique({
      where: { id: transcriptId },
      select: {
        processingMetadata: true,
        retranscribeCount: true,
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
    if (!latest) continue;
    const job = parseTranscriptEnhancementJob(latest.processingMetadata);
    if (isIllegalInFlightIneligible(job)) {
      const reconciled = await reconcileIllegalEnhancementJob({
        db,
        transcriptId,
        nowMs,
      });
      if (reconciled) {
        result.reconciledIllegal += 1;
      } else {
        result.skippedCancelled += 1;
      }
      continue;
    }
    if (!job.publicationEligible || !isExecutionInFlight(job.executionStatus)) {
      result.skippedCancelled += 1;
      continue;
    }
    if (!leaseIsExpired(job.leaseExpiresAt, nowMs) && job.leaseToken) {
      result.skippedActiveLease += 1;
      continue;
    }
    const newLeaseToken = randomUUID();
    const leaseExpiresAt = new Date(nowMs + getTranscriptEnhancementLeaseTtlMs()).toISOString();
    const claimed = await claimEnhancementLease({
      db,
      transcriptId,
      newLeaseToken,
      leaseExpiresAt,
      nowMs,
    });
    if (!claimed) {
      result.skippedActiveLease += 1;
      continue;
    }
    result.claimed += 1;
    if (!isD1EnhancementJob(claimed) || claimed.executionStatus === "FAILED") {
      result.skippedUndurable += 1;
      continue;
    }
    if (params?.resume === false) {
      continue;
    }
    try {
      const runJob = params?.runJob ?? runAdmittedEnhancementJob;
      await runJob({
        transcriptId,
        runId: claimed.runId ?? claimed.jobId ?? randomUUID(),
        leaseToken: newLeaseToken,
        inputIdentity: claimed.inputIdentity ?? "",
        retranscribeCount: latest.retranscribeCount,
        enhancementInput: mapSegments(latest.segments),
        dependencies: { db, now },
      });
      result.resumed += 1;
    } catch {
      result.failures += 1;
    }
  }
  return result;
}

export async function runTranscriptEnhancementRecoverySweep(params?: {
  dryRun?: boolean;
  limit?: number;
  now?: () => number;
}): Promise<EnhancementRecoveryResult> {
  return runTranscriptEnhancementRecoveryTick({
    dryRun: params?.dryRun,
    limit: params?.limit,
    now: params?.now,
    resume: true,
  });
}
