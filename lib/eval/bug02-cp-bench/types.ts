export const BUG02_CP_BENCH_WORKLOADS = ["S", "M", "L", "XL"] as const;
export type Bug02WorkloadId = (typeof BUG02_CP_BENCH_WORKLOADS)[number];

export const PHASE_A_CHUNK_CHAR_CANDIDATES = [700, 1200, 1800, 2500] as const;
export type PhaseAChunkChars = (typeof PHASE_A_CHUNK_CHAR_CANDIDATES)[number];

export const PHASE_B_CONCURRENCY_CANDIDATES = [4, 6, 8, 12] as const;
export type PhaseBConcurrency = (typeof PHASE_B_CONCURRENCY_CANDIDATES)[number];

export type BenchSegment = {
  index: number;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  originalText: string;
  segmentId: string;
};

export type BenchWorkload = {
  id: Bug02WorkloadId;
  label: string;
  segmentCount: number;
  charCount: number;
  speakerCount: number;
  segments: BenchSegment[];
};

export type ChunkPlan = {
  workloadId: Bug02WorkloadId;
  maxChars: number;
  maxSegments: number;
  chunkCount: number;
  targetCharCounts: number[];
  targetIndexSets: number[][];
  overlappingTargetIndexes: number[];
};

export type QualityVerdict = "PASS" | "REJECT";

export type QualityReport = {
  verdict: QualityVerdict;
  schemaValid: boolean;
  indexPreservation: boolean;
  noLoss: boolean;
  missingIndexes: number[];
  extraIndexes: number[];
  emptyReplacements: number[];
  catastrophicShrinkCount: number;
  expansionAnomalyCount: number;
  changedSegmentCount: number;
  unchangedSegmentCount: number;
  medianLengthRatio: number | null;
  obviousDistortion: string[];
  rejectReasons: string[];
};

export type ProviderCallRecord = {
  startedAtMs: number;
  finishedAtMs: number;
  latencyMs: number;
  httpStatus: number | null;
  ok: boolean;
  errorClass: "none" | "429" | "5xx" | "network" | "other";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  maxTokensInRequest: number | null;
};

export type LiveRunSummary = {
  phase: "A" | "B" | "C";
  runId: string;
  jobId?: string;
  workloadId: Bug02WorkloadId;
  maxChars: number;
  maxSegments: number;
  concurrency: number;
  globalCap?: number;
  fairnessPolicy?: string;
  wallClockMs: number;
  chunkCount: number;
  successfulChunkCount: number;
  failedChunkCount: number;
  fallbackSegmentCount: number;
  retryCount: number;
  overallStatus: string;
  quality: QualityReport;
  providerCalls: ProviderCallRecord[];
  http429: number;
  http5xx: number;
  networkFailures: number;
  callLatencyMs: number[];
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualTotalTokens: number | null;
  configuredMaxTokensSeen: number | null;
  tokensUsedEqualsConfiguredCap: boolean | null;
};

export type Percentiles = {
  p50: number | null;
  p95: number | null;
  max: number | null;
};

export type D1StressResult = {
  checkpointWrites: number;
  checkpointMs: number[];
  checkpoint: Percentiles;
  lockWaitMs: number[];
  lockWait: Percentiles;
  serializationFailures: number;
  deadlocks: number;
  lostChunks: string[];
  lostMapping: boolean;
  lostSibling: boolean;
  staleSnapshotLostChunk: boolean;
  interruptedReadable: boolean;
  xlJsonBytes: number;
  xlUnpublishedMapBytes: number;
  concurrentWriters: number;
  wallClockOverheadMs: number;
  persistenceDominatesProvider: boolean;
  decision: "D1_PASS" | "D1_REJECT";
  rejectReasons: string[];
};

export type OperatingPoint = {
  chunkMaxChars: number;
  chunkMaxSegments: number;
  perJobConcurrency: number;
  globalConcurrency: number;
  fairnessPolicy: "reserved_slot";
  retryPolicy: {
    emptyOutputAttempts: 2;
    retryableHttp: "429/5xx/network";
    backoff: "exponential_jitter";
    maxRetries: 2;
  };
  t2ByWorkload: Record<Bug02WorkloadId, { expectedWaves: number; expectedMs: number }>;
  t3Policy: {
    formula: "clamp(expectedMs * 4, 120000, 1800000)";
    minMs: 120000;
    maxMs: 1800000;
    safetyFactor: 4;
  };
  persistence: "D1" | "D2";
  authorityTimeoutMsRetained: false;
};

export type BenchExecutionBudget = {
  syntheticWorkloads: Bug02WorkloadId[];
  plannedLiveJobs: number;
  plannedProviderCalls: number;
  liveYandexUsed: boolean;
  productionDataUsed: false;
  productionHostOrDbContacted: false;
  pricingAvailable: false;
};
