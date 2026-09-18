import { buildTranscriptEnhancementChunks } from "@/lib/services/yandex-transcript-enhancement";

import type {
  BenchExecutionBudget,
  BenchWorkload,
  Bug02WorkloadId,
  ChunkPlan,
} from "./types";
import { toEnhancementInput } from "./workloads";

/**
 * Char budget is the Phase A decision variable. The historical 6-segment cap
 * would hide larger char envelopes on short turns (~130 chars), so the segment
 * cap is raised just enough for chars to bind.
 */
export function resolveCharBoundSegmentCap(maxChars: number): number {
  return Math.max(6, Math.ceil(maxChars / 100));
}

export function planChunks(workload: BenchWorkload, maxChars: number): ChunkPlan {
  const maxSegments = resolveCharBoundSegmentCap(maxChars);
  const chunks = buildTranscriptEnhancementChunks(toEnhancementInput(workload), {
    maxCharsPerChunk: maxChars,
    maxSegmentsPerChunk: maxSegments,
    contextNeighbors: 1,
  });
  const targetIndexSets = chunks.map((chunk) =>
    chunk.targets.map((target) => target.index),
  );
  const seen = new Set<number>();
  const overlappingTargetIndexes: number[] = [];
  for (const indexes of targetIndexSets) {
    for (const index of indexes) {
      if (seen.has(index)) {
        overlappingTargetIndexes.push(index);
      }
      seen.add(index);
    }
  }
  return {
    workloadId: workload.id,
    maxChars,
    maxSegments,
    chunkCount: chunks.length,
    targetCharCounts: chunks.map((chunk) =>
      chunk.targets.reduce((sum, target) => sum + target.originalText.length, 0),
    ),
    targetIndexSets,
    overlappingTargetIndexes,
  };
}

export function expectedWaves(chunkCount: number, concurrency: number): number {
  return Math.ceil(chunkCount / Math.max(1, concurrency));
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function summarizePercentiles(values: number[]): {
  p50: number | null;
  p95: number | null;
  max: number | null;
} {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : null,
  };
}

export function buildExecutionBudget(params: {
  workloads: Record<Bug02WorkloadId, BenchWorkload>;
  phaseAChars: readonly number[];
  phaseAWorkloads: readonly Bug02WorkloadId[];
  phaseBConcurrencies: readonly number[];
  phaseBWorkloads: readonly Bug02WorkloadId[];
  selectedChunkPolicies: number;
  phaseCJobs: number;
  phaseCGlobalCaps: number;
  liveYandexUsed: boolean;
}): BenchExecutionBudget {
  let plannedProviderCalls = 0;
  let plannedLiveJobs = 0;

  for (const workloadId of params.phaseAWorkloads) {
    for (const maxChars of params.phaseAChars) {
      const plan = planChunks(params.workloads[workloadId], maxChars);
      plannedLiveJobs += 1;
      plannedProviderCalls += plan.chunkCount;
    }
  }

  const selectedChars = params.phaseAChars.slice(0, Math.max(1, params.selectedChunkPolicies));
  for (const maxChars of selectedChars) {
    for (const workloadId of params.phaseBWorkloads) {
      const plan = planChunks(params.workloads[workloadId], maxChars);
      const concValues =
        workloadId === "XL" && plan.chunkCount > 24
          ? params.phaseBConcurrencies.slice(0, 1)
          : params.phaseBConcurrencies;
      for (const _concurrency of concValues) {
        plannedLiveJobs += 1;
        plannedProviderCalls += plan.chunkCount;
      }
    }
  }

  const phaseCWorkloads: Bug02WorkloadId[] = ["S", "M", "L"];
  const primaryChars = selectedChars[0] ?? 1800;
  for (let cap = 0; cap < params.phaseCGlobalCaps; cap += 1) {
    for (const workloadId of phaseCWorkloads.slice(0, params.phaseCJobs)) {
      plannedLiveJobs += 1;
      plannedProviderCalls += planChunks(params.workloads[workloadId], primaryChars).chunkCount;
    }
  }

  return {
    syntheticWorkloads: ["S", "M", "L", "XL"],
    plannedLiveJobs,
    plannedProviderCalls,
    liveYandexUsed: params.liveYandexUsed,
    productionDataUsed: false,
    productionHostOrDbContacted: false,
    pricingAvailable: false,
  };
}
