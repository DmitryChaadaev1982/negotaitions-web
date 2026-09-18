import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runD1PersistenceStress } from "./d1-persistence";
import { inspectBenchSafety } from "./env-safety";
import { FairGlobalLimiter, summarizeFairness } from "./fairness";
import { runLiveEnhancementJob } from "./live-runner";
import {
  buildExecutionBudget,
  expectedWaves,
  planChunks,
  percentile,
  resolveCharBoundSegmentCap,
} from "./planner";
import type {
  BenchWorkload,
  Bug02WorkloadId,
  LiveRunSummary,
  OperatingPoint,
} from "./types";
import {
  PHASE_A_CHUNK_CHAR_CANDIDATES,
  PHASE_B_CONCURRENCY_CANDIDATES,
} from "./types";
import { createAllBenchWorkloads } from "./workloads";

export const BUG02_CP_BENCH_ARTIFACT_DIR = path.join(
  process.cwd(),
  "tmp",
  "bug02-cp-bench",
);

export function sanitizeLiveRun(run: LiveRunSummary): LiveRunSummary {
  return {
    ...run,
    providerCalls: run.providerCalls.map((call) => ({
      ...call,
    })),
  };
}

function callP95(run: LiveRunSummary): number | null {
  return percentile(run.callLatencyMs, 95);
}

function isHealthyRun(run: LiveRunSummary): boolean {
  return (
    run.quality.verdict === "PASS" &&
    run.http429 === 0 &&
    run.http5xx === 0 &&
    run.networkFailures === 0 &&
    run.overallStatus !== "FAILED"
  );
}

export function selectPhaseAPolicies(runs: LiveRunSummary[]): number[] {
  const byChars = new Map<number, LiveRunSummary[]>();
  for (const run of runs) {
    const list = byChars.get(run.maxChars) ?? [];
    list.push(run);
    byChars.set(run.maxChars, list);
  }
  const scored = [...byChars.entries()].map(([maxChars, group]) => {
    const rejected = group.some((run) => run.quality.verdict === "REJECT");
    const fallback = group.reduce((sum, run) => sum + run.fallbackSegmentCount, 0);
    const wall = group.reduce((sum, run) => sum + run.wallClockMs, 0);
    const chunks = group.reduce((sum, run) => sum + run.chunkCount, 0);
    return { maxChars, rejected, fallback, wall, chunks };
  });
  const passing = scored.filter((item) => !item.rejected).sort((a, b) => {
    if (a.fallback !== b.fallback) return a.fallback - b.fallback;
    if (a.chunks !== b.chunks) return a.chunks - b.chunks;
    return a.wall - b.wall;
  });
  if (passing.length === 0) return [];
  const selected = [passing[0].maxChars];
  const runnerUp = passing[1];
  if (
    runnerUp &&
    runnerUp.fallback === passing[0].fallback &&
    Math.abs(runnerUp.wall - passing[0].wall) / Math.max(1, passing[0].wall) < 0.35
  ) {
    selected.push(runnerUp.maxChars);
  }
  return selected;
}

export function selectPerJobConcurrency(runs: LiveRunSummary[]): number {
  const xlConcurrencies = new Set(
    runs.filter((run) => run.workloadId === "XL").map((run) => run.concurrency),
  );
  const byConc = new Map<number, LiveRunSummary[]>();
  for (const run of runs) {
    const list = byConc.get(run.concurrency) ?? [];
    list.push(run);
    byConc.set(run.concurrency, list);
  }
  const ranked = [...byConc.entries()]
    .map(([concurrency, group]) => {
      const p95s = group.map(callP95).filter((value): value is number => value !== null);
      const p95 = percentile(p95s, 95) ?? Number.POSITIVE_INFINITY;
      const errors = group.reduce(
        (sum, run) => sum + run.http429 + run.http5xx + run.networkFailures,
        0,
      );
      const testedOnXl = xlConcurrencies.size === 0 || xlConcurrencies.has(concurrency);
      return { concurrency, p95, errors, testedOnXl };
    })
    .filter((item) => item.concurrency <= 8 || item.testedOnXl);
  const eight = ranked.find((item) => item.concurrency === 8 && item.errors === 0);
  if (eight) {
    return 8;
  }
  ranked.sort((a, b) => {
    if (a.errors !== b.errors) return a.errors - b.errors;
    if (a.testedOnXl !== b.testedOnXl) return a.testedOnXl ? -1 : 1;
    return a.p95 - b.p95;
  });
  return ranked[0]?.concurrency ?? 4;
}

export function freezeOperatingPoint(params: {
  workloads: Record<Bug02WorkloadId, BenchWorkload>;
  chunkMaxChars: number;
  perJobConcurrency: number;
  globalConcurrency: number;
  persistence: "D1" | "D2";
  perCallP95Ms: number;
}): OperatingPoint {
  const chunkMaxSegments = resolveCharBoundSegmentCap(params.chunkMaxChars);
  const t2ByWorkload = {
    S: { expectedWaves: 0, expectedMs: 0 },
    M: { expectedWaves: 0, expectedMs: 0 },
    L: { expectedWaves: 0, expectedMs: 0 },
    XL: { expectedWaves: 0, expectedMs: 0 },
  } as OperatingPoint["t2ByWorkload"];
  for (const id of ["S", "M", "L", "XL"] as const) {
    const plan = planChunks(params.workloads[id], params.chunkMaxChars);
    const waves = expectedWaves(plan.chunkCount, params.perJobConcurrency);
    t2ByWorkload[id] = {
      expectedWaves: waves,
      expectedMs: waves * params.perCallP95Ms,
    };
  }
  return {
    chunkMaxChars: params.chunkMaxChars,
    chunkMaxSegments,
    perJobConcurrency: params.perJobConcurrency,
    globalConcurrency: params.globalConcurrency,
    fairnessPolicy: "reserved_slot",
    retryPolicy: {
      emptyOutputAttempts: 2,
      retryableHttp: "429/5xx/network",
      backoff: "exponential_jitter",
      maxRetries: 2,
    },
    t2ByWorkload,
    t3Policy: {
      formula: "clamp(expectedMs * 4, 120000, 1800000)",
      minMs: 120000,
      maxMs: 1800000,
      safetyFactor: 4,
    },
    persistence: params.persistence,
    authorityTimeoutMsRetained: false,
  };
}

export async function writeArtifact(name: string, value: unknown): Promise<string> {
  await mkdir(BUG02_CP_BENCH_ARTIFACT_DIR, { recursive: true });
  const filePath = path.join(BUG02_CP_BENCH_ARTIFACT_DIR, name);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

export async function readArtifact<T>(name: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(BUG02_CP_BENCH_ARTIFACT_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadSelectedChunkPolicies(): Promise<number[]> {
  const phaseA = await readArtifact<LiveRunSummary[]>("phase-a-summary.json");
  if (!phaseA || phaseA.length === 0) {
    return [1800];
  }
  const selected = selectPhaseAPolicies(phaseA);
  return selected.length > 0 ? selected : [1800];
}

export function createPlannedBudget(liveYandexUsed: boolean) {
  const workloads = createAllBenchWorkloads();
  const plans = {
    S: PHASE_A_CHUNK_CHAR_CANDIDATES.map((maxChars) => planChunks(workloads.S, maxChars)),
    M: PHASE_A_CHUNK_CHAR_CANDIDATES.map((maxChars) => planChunks(workloads.M, maxChars)),
    L: PHASE_A_CHUNK_CHAR_CANDIDATES.map((maxChars) => planChunks(workloads.L, maxChars)),
    XL: PHASE_A_CHUNK_CHAR_CANDIDATES.map((maxChars) => planChunks(workloads.XL, maxChars)),
  };
  const budget = buildExecutionBudget({
    workloads,
    phaseAChars: PHASE_A_CHUNK_CHAR_CANDIDATES,
    phaseAWorkloads: ["M", "L"],
    phaseBConcurrencies: [4, 6, 8],
    phaseBWorkloads: ["L", "XL"],
    selectedChunkPolicies: 1,
    phaseCJobs: 3,
    phaseCGlobalCaps: 1,
    liveYandexUsed,
  });
  return { workloads, plans, budget };
}

export async function runPhaseA(): Promise<LiveRunSummary[]> {
  const { workloads } = createPlannedBudget(true);
  const runs: LiveRunSummary[] = [];
  for (const workloadId of ["M", "L"] as const) {
    for (const maxChars of PHASE_A_CHUNK_CHAR_CANDIDATES) {
      const run = await runLiveEnhancementJob({
        phase: "A",
        workload: workloads[workloadId],
        maxChars,
        concurrency: 4,
      });
      runs.push(run);
      await writeArtifact(
        `phase-a-${workloadId}-${maxChars}.json`,
        sanitizeLiveRun(run),
      );
    }
  }
  await writeArtifact("phase-a-summary.json", runs.map(sanitizeLiveRun));
  return runs;
}

export async function runPhaseB(selectedChars: number[]): Promise<LiveRunSummary[]> {
  const { workloads } = createPlannedBudget(true);
  const policies = selectedChars.slice(0, 2);
  const runs: LiveRunSummary[] = [];
  for (const maxChars of policies) {
    for (const concurrency of [4, 6, 8] as const) {
      const run = await runLiveEnhancementJob({
        phase: "B",
        workload: workloads.L,
        maxChars,
        concurrency,
      });
      runs.push(run);
      await writeArtifact(`phase-b-L-${maxChars}-c${concurrency}.json`, sanitizeLiveRun(run));
    }
  }
  const winnerChars = policies[0];
  const lAt8 = runs.find((run) => run.maxChars === winnerChars && run.concurrency === 8);
  const try12 = Boolean(lAt8 && isHealthyRun(lAt8) && (callP95(lAt8) ?? 0) < 20000);
  if (try12) {
    const run = await runLiveEnhancementJob({
      phase: "B",
      workload: workloads.L,
      maxChars: winnerChars,
      concurrency: 12,
    });
    runs.push(run);
    await writeArtifact(`phase-b-L-${winnerChars}-c12.json`, sanitizeLiveRun(run));
  }
  const xlPlan = planChunks(workloads.XL, winnerChars);
  const xlConcurrencies = xlPlan.chunkCount <= 24 ? ([4, 8] as const) : ([4] as const);
  for (const concurrency of xlConcurrencies) {
    const run = await runLiveEnhancementJob({
      phase: "B",
      workload: workloads.XL,
      maxChars: winnerChars,
      concurrency,
    });
    runs.push(run);
    await writeArtifact(`phase-b-XL-${winnerChars}-c${concurrency}.json`, sanitizeLiveRun(run));
  }
  await writeArtifact("phase-b-summary.json", runs.map(sanitizeLiveRun));
  void PHASE_B_CONCURRENCY_CANDIDATES;
  return runs;
}

export async function runPhaseC(params: {
  maxChars: number;
  perJobConcurrency: number;
  globalCap: number;
}): Promise<{
  runs: LiveRunSummary[];
  fairness: ReturnType<typeof summarizeFairness>;
}> {
  const { workloads } = createPlannedBudget(true);
  const limiter = new FairGlobalLimiter(
    params.globalCap,
    params.perJobConcurrency,
    "reserved_slot",
  );
  const jobs: Array<{ id: string; workload: BenchWorkload }> = [
    { id: "A", workload: workloads.L },
    { id: "B", workload: workloads.M },
    { id: "C", workload: workloads.S },
  ];
  const runs = await Promise.all(
    jobs.map((job) =>
      runLiveEnhancementJob({
        phase: "C",
        jobId: job.id,
        workload: job.workload,
        maxChars: params.maxChars,
        concurrency: params.perJobConcurrency,
        globalCap: params.globalCap,
        fairnessPolicy: "reserved_slot",
        aroundCall: (fn) => limiter.withSlot(job.id, fn),
      }),
    ),
  );
  const fairness = summarizeFairness(limiter.samples, jobs.map((job) => job.id));
  await writeArtifact("phase-c-summary.json", {
    runs: runs.map(sanitizeLiveRun),
    fairness,
    maxObservedGlobal: fairness.maxGlobalInFlight,
    monopoly: fairness.maxPerJobInFlight,
  });
  return { runs, fairness };
}

export async function runPhaseD() {
  const result = await runD1PersistenceStress({ burstWriters: 8, xlChunkCount: 48 });
  await writeArtifact("phase-d-d1-stress.json", result);
  return result;
}

export async function runCpBench(phase: "plan" | "A" | "B" | "C" | "D" | "E" | "all") {
  const safety = inspectBenchSafety();
  const planned = createPlannedBudget(safety.liveYandexReady);
  await writeArtifact("budget.json", {
    safety,
    workloadShapes: {
      S: { segments: planned.workloads.S.segmentCount, chars: planned.workloads.S.charCount },
      M: { segments: planned.workloads.M.segmentCount, chars: planned.workloads.M.charCount },
      L: { segments: planned.workloads.L.segmentCount, chars: planned.workloads.L.charCount },
      XL: { segments: planned.workloads.XL.segmentCount, chars: planned.workloads.XL.charCount },
    },
    plans: planned.plans,
    budget: planned.budget,
  });

  if (phase === "plan") {
    return { safety, planned };
  }
  if (!safety.e2eIsolated && (phase === "D" || phase === "all" || phase === "E")) {
    throw new Error(safety.blockReason ?? "BUG02_CP_BENCH_BLOCKED: E2E_DATABASE");
  }
  if (!safety.liveYandexReady && ["A", "B", "C", "all", "E"].includes(phase)) {
    throw new Error("BUG02_CP_BENCH_BLOCKED: LIVE_YANDEX_NOT_READY");
  }

  const phaseA =
    phase === "A" || phase === "all"
      ? await runPhaseA()
      : ((await readArtifact<LiveRunSummary[]>("phase-a-summary.json")) ?? []);
  const selectedChars =
    phaseA.length > 0 ? selectPhaseAPolicies(phaseA) : await loadSelectedChunkPolicies();
  const phaseB =
    phase === "B" || phase === "all"
      ? await runPhaseB(selectedChars.length > 0 ? selectedChars : [1800])
      : ((await readArtifact<LiveRunSummary[]>("phase-b-summary.json")) ?? []);
  const selectedPerJob = phaseB.length > 0 ? selectPerJobConcurrency(phaseB) : 4;
  const selectedCharsFinal = selectedChars.includes(1800)
    ? 1800
    : (selectedChars[0] ?? 1800);
  const selectedGlobal = Math.max(selectedPerJob + 2, 8);
  // reserved_slot still prevents monopoly: maxPerJob = min(perJob, global-1).
  const phaseC =
    phase === "C" || phase === "all" || phase === "E"
      ? await runPhaseC({
          maxChars: selectedCharsFinal,
          perJobConcurrency: selectedPerJob,
          globalCap: selectedGlobal,
        })
      : null;
  const phaseD = phase === "D" || phase === "all" || phase === "E" ? await runPhaseD() : null;
  const perCallP95 =
    percentile(
      [...phaseA, ...phaseB, ...(phaseC?.runs ?? [])].flatMap((run) => run.callLatencyMs),
      95,
    ) ?? 8000;
  const operatingPoint = freezeOperatingPoint({
    workloads: planned.workloads,
    chunkMaxChars: selectedCharsFinal,
    perJobConcurrency: selectedPerJob,
    globalConcurrency: selectedGlobal,
    persistence: phaseD?.decision === "D1_PASS" ? "D1" : "D2",
    perCallP95Ms: perCallP95,
  });
  await writeArtifact("phase-e-operating-point.json", {
    selectedChars,
    selectedPerJob,
    selectedGlobal,
    operatingPoint,
  });
  return {
    safety,
    planned,
    phaseA,
    phaseB,
    phaseC,
    phaseD,
    operatingPoint,
  };
}
