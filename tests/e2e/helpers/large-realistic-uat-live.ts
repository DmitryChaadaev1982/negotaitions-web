import { enhanceTranscriptWithYandexAi } from "@/lib/services/yandex-transcript-enhancement";
import { buildTranscriptEnhancementChunks } from "@/lib/services/yandex-transcript-enhancement";
import {
  chunkKey,
  computeEnhancementProgress,
  mergeEnhancementJobIntoMetadata,
  parseTranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import { executeTranscriptEnhancement } from "@/lib/services/transcript-enhancement-orchestration";
import { runAdmittedEnhancementJob } from "@/lib/services/transcript-enhancement-orchestration";
import { runTranscriptEnhancementRecoveryTick } from "@/lib/services/transcript-enhancement-recovery";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asProcessingMetadata } from "@/lib/transcription/processing-metadata";

import { toEnhancementInput } from "./large-realistic-uat-preflight";
import {
  installYandexFetchInterceptor,
  summarizeCallLatencies,
  type ProviderCallRecord,
} from "./large-realistic-uat-metrics";
import {
  completedChunksCalledAgain,
  controlledRecoveryLeaseExpiresAt,
} from "./large-realistic-uat-skip-resume";
import { loadTranscriptObservation } from "./large-realistic-uat-observe";
import type { LargeRealisticUatSeededSession } from "./large-realistic-uat-seed";

const REAL_PRODUCT_PROVIDER_PATH =
  "executeTranscriptEnhancement -> runAdmittedEnhancementJob -> enhanceTranscriptWithYandexAi";

export type LiveEnhancementRun = {
  seeded: LargeRealisticUatSeededSession;
  startedAtMs: number;
  finishedAtMs: number;
  totalT2Ms: number;
  admitOutcome: string;
  calls: ReturnType<typeof summarizeCallLatencies>;
  records: ProviderCallRecord[];
  observation: Awaited<ReturnType<typeof loadTranscriptObservation>>;
  realProductProviderPath: typeof REAL_PRODUCT_PROVIDER_PATH;
  realYandex: true;
};

function wrapEnhanceWithCallRecording(params: {
  phase: () => "initial" | "resume" | "full";
  initialCallChunks: number[];
  resumeCallChunks: number[];
  skipFromIndex?: number | null;
}): typeof enhanceTranscriptWithYandexAi {
  return async (input, options) => {
    const planned = buildTranscriptEnhancementChunks(input);
    const extraSkip = new Set<number>();
    if (params.phase() === "initial" && params.skipFromIndex != null) {
      for (const chunk of planned) {
        if (chunk.chunkIndex >= params.skipFromIndex) extraSkip.add(chunk.chunkIndex);
      }
    }
    const skip = new Set([...(options?.skipChunkIndexes ?? []), ...extraSkip]);
    return enhanceTranscriptWithYandexAi(input, {
      ...options,
      skipChunkIndexes: skip,
      onChunkStart: async (chunk) => {
        if (params.phase() === "resume") params.resumeCallChunks.push(chunk.chunkIndex);
        else params.initialCallChunks.push(chunk.chunkIndex);
        await options?.onChunkStart?.(chunk);
      },
    });
  };
}

export async function runBackgroundProviderQualification(
  seeded: LargeRealisticUatSeededSession,
): Promise<LiveEnhancementRun> {
  const interceptor = installYandexFetchInterceptor();
  const startedAtMs = Date.now();
  try {
    const admit = await executeTranscriptEnhancement({
      transcriptId: seeded.transcriptId,
      triggerSource: "manual",
      runInBackground: false,
    });
    const finishedAtMs = Date.now();
    const observation = await loadTranscriptObservation(seeded.transcriptId);
    return {
      seeded,
      startedAtMs,
      finishedAtMs,
      totalT2Ms: finishedAtMs - startedAtMs,
      admitOutcome: admit.outcome,
      calls: summarizeCallLatencies(interceptor.records),
      records: interceptor.records,
      observation,
      realProductProviderPath: REAL_PRODUCT_PROVIDER_PATH,
      realYandex: true,
    };
  } finally {
    interceptor.restore();
  }
}

export function assertDurableCompletedChunkOutput(params: {
  job: ReturnType<typeof parseTranscriptEnhancementJob>;
  expectedIndexes: readonly number[];
}): void {
  for (const index of params.expectedIndexes) {
    const chunk = params.job.chunks[chunkKey(index)];
    if (!chunk || chunk.status !== "COMPLETED") {
      throw new Error(`Controlled recovery expected durable COMPLETED chunk ${index}.`);
    }
    const unpublished = chunk.unpublishedByOrderIndex ?? {};
    const texts = Object.values(unpublished).filter(
      (text) => typeof text === "string" && text.trim().length > 0,
    );
    if (texts.length === 0) {
      throw new Error(
        `COMPLETED chunk ${index} has no structurally valid unpublished output.`,
      );
    }
  }
}

export async function injectControlledUnfinishedState(
  transcriptId: string,
  options?: { lease?: "expired" | "held" },
): Promise<{
  completedBeforeResume: number[];
  retryableFailed: number[];
  pending: number[];
}> {
  const latest = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    select: { processingMetadata: true },
  });
  if (!latest) {
    throw new Error(`Transcript ${transcriptId} missing while injecting resume state.`);
  }
  const metadata = asProcessingMetadata(latest.processingMetadata);
  const job = parseTranscriptEnhancementJob(metadata);
  const chunks = { ...job.chunks };
  const pending = Object.values(chunks)
    .filter((chunk) => chunk.status === "PENDING")
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
  if (pending.length === 0) {
    throw new Error("Controlled resume injection found no PENDING chunks.");
  }
  const target = pending[pending.length - 1]!;
  chunks[chunkKey(target.chunkIndex)] = {
    ...target,
    status: "RETRYABLE_FAILED",
    lastErrorClass: "uat_controlled_interrupt",
  };
  const next = {
    ...job,
    chunks,
    progress: computeEnhancementProgress(chunks),
    leaseExpiresAt: controlledRecoveryLeaseExpiresAt(Date.now(), options?.lease ?? "expired"),
    executionStatus: "RUNNING" as const,
    publicationEligible: true,
    finishedAt: null,
    terminalQuality: null,
  };
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: {
      processingMetadata: mergeEnhancementJobIntoMetadata(
        metadata,
        next,
      ) as Prisma.InputJsonValue,
    },
  });
  const after = parseTranscriptEnhancementJob(
    (
      await prisma.transcript.findUnique({
        where: { id: transcriptId },
        select: { processingMetadata: true },
      })
    )?.processingMetadata,
  );
  return {
    completedBeforeResume: Object.values(after.chunks)
      .filter((chunk) => chunk.status === "COMPLETED")
      .map((chunk) => chunk.chunkIndex)
      .sort((left, right) => left - right),
    retryableFailed: Object.values(after.chunks)
      .filter((chunk) => chunk.status === "RETRYABLE_FAILED")
      .map((chunk) => chunk.chunkIndex),
    pending: Object.values(after.chunks)
      .filter((chunk) => chunk.status === "PENDING")
      .map((chunk) => chunk.chunkIndex),
  };
}

export async function expireControlledEnhancementLease(transcriptId: string): Promise<string> {
  const latest = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    select: { processingMetadata: true },
  });
  if (!latest) {
    throw new Error(`Transcript ${transcriptId} missing while expiring recovery lease.`);
  }
  const metadata = asProcessingMetadata(latest.processingMetadata);
  const job = parseTranscriptEnhancementJob(metadata);
  const leaseExpiresAt = controlledRecoveryLeaseExpiresAt(Date.now(), "expired");
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: {
      processingMetadata: mergeEnhancementJobIntoMetadata(metadata, {
        ...job,
        leaseExpiresAt,
        executionStatus: "RUNNING",
        publicationEligible: true,
        finishedAt: null,
        terminalQuality: null,
      }) as Prisma.InputJsonValue,
    },
  });
  return leaseExpiresAt;
}

export type ControlledRecoveryPrepareResult = {
  completedBeforeResume: number[];
  retryableFailed: number[];
  pending: number[];
  runId: string | null;
  executionStatus: string;
  publicationEligible: boolean;
  terminalQuality: string | null;
  publicationOutcome: string | null;
  leaseExpiresAt: string | null;
};

export async function prepareControlledRecoveryState(
  seeded: LargeRealisticUatSeededSession,
  options?: {
    lease?: "expired" | "held";
    runChunkedEnhancement?: typeof enhanceTranscriptWithYandexAi;
    initialCallChunks?: number[];
  },
): Promise<ControlledRecoveryPrepareResult> {
  const planned = buildTranscriptEnhancementChunks(toEnhancementInput());
  const skipFromIndex = Math.min(3, Math.max(1, planned.length - 2));
  const initialCallChunks = options?.initialCallChunks ?? [];
  const wrapped =
    options?.runChunkedEnhancement ??
    wrapEnhanceWithCallRecording({
      phase: () => "initial",
      initialCallChunks,
      resumeCallChunks: [],
      skipFromIndex,
    });
  await executeTranscriptEnhancement({
    transcriptId: seeded.transcriptId,
    triggerSource: "manual",
    runInBackground: false,
    dependencies: { runChunkedEnhancement: wrapped },
  });
  const before = await injectControlledUnfinishedState(seeded.transcriptId, {
    lease: options?.lease ?? "expired",
  });
  const observation = await loadTranscriptObservation(seeded.transcriptId);
  assertDurableCompletedChunkOutput({
    job: observation.job,
    expectedIndexes: before.completedBeforeResume,
  });
  if (observation.summary.publicationOutcome != null) {
    throw new Error(
      `Controlled recovery prepare published unexpectedly (${observation.summary.publicationOutcome}).`,
    );
  }
  if (observation.textChange.segmentsTextChanged !== 0) {
    throw new Error("Controlled recovery prepare changed published lexical text before handoff.");
  }
  return {
    ...before,
    runId: observation.summary.runId,
    executionStatus: observation.summary.executionStatus,
    publicationEligible: observation.summary.publicationEligible,
    terminalQuality: observation.summary.terminalQuality,
    publicationOutcome: observation.summary.publicationOutcome,
    leaseExpiresAt: observation.job.leaseExpiresAt,
  };
}

export type ResumeHarnessResult = LiveEnhancementRun & {
  initialCallChunks: number[];
  resumeCallChunks: number[];
  completedBeforeResume: number[];
  retryableFailedBeforeResume: number[];
  pendingBeforeResume: number[];
  completedChunksCalledAgain: number[];
  mechanism: string;
};

export async function runControlledResumeHarness(
  seeded: LargeRealisticUatSeededSession,
): Promise<ResumeHarnessResult> {
  const planned = buildTranscriptEnhancementChunks(toEnhancementInput());
  const skipFromIndex = Math.min(3, Math.max(1, planned.length - 2));
  const initialCallChunks: number[] = [];
  const resumeCallChunks: number[] = [];
  let phase: "initial" | "resume" | "full" = "initial";
  const wrapped = wrapEnhanceWithCallRecording({
    phase: () => phase,
    initialCallChunks,
    resumeCallChunks,
    skipFromIndex,
  });
  const interceptor = installYandexFetchInterceptor();
  const startedAtMs = Date.now();
  try {
    const before = await prepareControlledRecoveryState(seeded, {
      lease: "expired",
      runChunkedEnhancement: wrapped,
      initialCallChunks,
    });
    phase = "resume";
    const recovery = await runTranscriptEnhancementRecoveryTick({
      transcriptIds: [seeded.transcriptId],
      resume: true,
      runJob: (params) =>
        runAdmittedEnhancementJob({
          ...params,
          dependencies: {
            ...params.dependencies,
            runChunkedEnhancement: wrapped,
          },
        }),
    });
    if (recovery.resumed < 1) {
      throw new Error(
        `Controlled resume recovery did not resume the job (claimed=${recovery.claimed}, resumed=${recovery.resumed}, skippedActiveLease=${recovery.skippedActiveLease}).`,
      );
    }
    const finishedAtMs = Date.now();
    const observation = await loadTranscriptObservation(seeded.transcriptId);
    return {
      seeded,
      startedAtMs,
      finishedAtMs,
      totalT2Ms: finishedAtMs - startedAtMs,
      admitOutcome: "started",
      calls: summarizeCallLatencies(interceptor.records),
      records: interceptor.records,
      observation,
      realProductProviderPath: REAL_PRODUCT_PROVIDER_PATH,
      realYandex: true,
      initialCallChunks: [...new Set(initialCallChunks)].sort((left, right) => left - right),
      resumeCallChunks: [...new Set(resumeCallChunks)].sort((left, right) => left - right),
      completedBeforeResume: before.completedBeforeResume,
      retryableFailedBeforeResume: before.retryableFailed,
      pendingBeforeResume: before.pending,
      completedChunksCalledAgain: completedChunksCalledAgain({
        completedBeforeResume: before.completedBeforeResume,
        resumeCallChunks,
      }),
      mechanism:
        "Real Yandex for first N chunks via skipChunkIndexes on remaining PENDING; mark one PENDING as RETRYABLE_FAILED; expire lease; runTranscriptEnhancementRecoveryTick.",
    };
  } finally {
    interceptor.restore();
  }
}
