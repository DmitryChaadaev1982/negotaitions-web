export const SKIP_SEMANTICS = {
  operation: "CONTINUE_WITH_CURRENT_TRANSCRIPT",
  uiLabelRu: "Пропустить ИИ-улучшение",
  partialEnhancedTextPublishedAfterSkip: false,
  rawCurrentRemainsAuthoritative: true,
  lateResultCanPublish: false,
  newRunRequiredForNewImprove: true,
  description:
    "Skip abandons publication authority for the current enhancement run. Durable completed chunks are not partially published. A later Improve starts a fresh run.",
} as const;

export const RESUME_SEMANTICS = {
  operation: "RETRY_OR_RECOVERY_RESUME",
  uiLabelRu: "Повторить ИИ-улучшение / enhancement-recovery",
  continuesUnfinishedDurableWork: true,
  completedChunksAreNotResent: true,
  processesUnfinishedOnly: true,
  sameRunId: true,
  trigger: "automatic",
  productPath:
    "materials/status or recording reconcileTranscriptEnhancementTimeout -> runTranscriptEnhancementRecoveryTick (same runId)",
  unfinishedEligible: ["PENDING", "RUNNING", "RETRYABLE_FAILED"] as const,
  description:
    "Resume/retry continues the same eligible D1 job: COMPLETED chunks are skipped, and only RETRYABLE_FAILED, PENDING, or interrupted RUNNING converted to retryable are sent to Yandex.",
} as const;

export const RECOVERY_HANDOFF = {
  mode: "recovery",
  trigger: "automatic",
  operatorAction:
    "Stay on the already-open Product materials page. Do not click Skip. Do not click Improve/Retry. The next materials/status poll recovers the expired lease.",
} as const;

export function intersection<T>(left: readonly T[], right: readonly T[]): T[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

export function completedChunksCalledAgain(params: {
  completedBeforeResume: readonly number[];
  resumeCallChunks: readonly number[];
}): number[] {
  return intersection(params.completedBeforeResume, params.resumeCallChunks);
}

export function controlledRecoveryLeaseExpiresAt(
  nowMs: number,
  lease: "expired" | "held",
): string {
  return new Date(lease === "held" ? nowMs + 2 * 60 * 60 * 1000 : nowMs - 120_000).toISOString();
}

export function formatChunkIndexList(indexes: readonly number[]): string {
  if (indexes.length === 0) return "(none)";
  const sorted = [...new Set(indexes)].sort((left, right) => left - right);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    if (current != null) {
      start = current;
      prev = current;
    }
  }
  return parts.join(",");
}

export function summarizeRecoveryProviderCalls(params: {
  records: ReadonlyArray<{
    runId: string | null;
    chunkIndex: number;
    requestStartedAt: string | null;
  }>;
  runId: string | null;
  recoveryStart: string | null;
  completedBeforeRecovery: readonly number[];
}): {
  recoveryProviderCallChunks: number[];
  recalledCompletedChunks: number[];
} {
  const startMs = params.recoveryStart ? Date.parse(params.recoveryStart) : null;
  const chunks = new Set<number>();
  for (const record of params.records) {
    if (params.runId && record.runId && record.runId !== params.runId) continue;
    const started = record.requestStartedAt ? Date.parse(record.requestStartedAt) : null;
    if (startMs != null && started != null && started < startMs) continue;
    if (startMs != null && started == null) continue;
    chunks.add(record.chunkIndex);
  }
  const recoveryProviderCallChunks = [...chunks].sort((left, right) => left - right);
  return {
    recoveryProviderCallChunks,
    recalledCompletedChunks: completedChunksCalledAgain({
      completedBeforeResume: params.completedBeforeRecovery,
      resumeCallChunks: recoveryProviderCallChunks,
    }),
  };
}
