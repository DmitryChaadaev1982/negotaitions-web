/**
 * Stage 3.25A / BUG02 CP-BENCH harness.
 *
 * Non-production only. Live Yandex is opt-in via configured local env.
 * Never logs transcript text, raw provider bodies, or secrets.
 */
import { loadEnvConfig } from "@next/env";

import { runCpBench, runPhaseC, writeArtifact } from "@/lib/eval/bug02-cp-bench/run";

loadEnvConfig(process.cwd());

const phaseArg = process.argv.find((arg) => arg.startsWith("--phase="));
const phase = (phaseArg?.slice("--phase=".length) ?? "all") as
  | "plan"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "all"
  | "C-1800";

async function main() {
  if (phase === "C-1800") {
    const phaseC = await runPhaseC({
      maxChars: 1800,
      perJobConcurrency: 8,
      globalCap: 8,
    });
    await writeArtifact("phase-c-1800-fairness.json", {
      fairness: phaseC.fairness,
      walls: phaseC.runs.map((run) => ({
        jobId: run.jobId,
        workloadId: run.workloadId,
        wallClockMs: run.wallClockMs,
        http429: run.http429,
        verdict: run.quality.verdict,
      })),
    });
    console.log(
      JSON.stringify(
        {
          phase,
          actualProviderCalls: phaseC.runs.reduce((sum, run) => sum + run.providerCalls.length, 0),
          fairness: phaseC.fairness,
        },
        null,
        2,
      ),
    );
    return;
  }
  const result = await runCpBench(phase);
  const plannedCalls = result.planned.budget.plannedProviderCalls;
  const actualCalls = [
    ...(result.phaseA ?? []),
    ...(result.phaseB ?? []),
    ...(result.phaseC?.runs ?? []),
  ].reduce((sum, run) => sum + run.providerCalls.length, 0);
  console.log(
    JSON.stringify(
      {
        phase,
        liveYandexReady: result.safety.liveYandexReady,
        e2eIsolated: result.safety.e2eIsolated,
        plannedProviderCalls: plannedCalls,
        actualProviderCalls: actualCalls,
        selectedChars: result.operatingPoint?.chunkMaxChars ?? null,
        selectedPerJob: result.operatingPoint?.perJobConcurrency ?? null,
        persistence: result.operatingPoint?.persistence ?? result.phaseD?.decision ?? null,
        artifactDir: "tmp/bug02-cp-bench",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(message);
  process.exitCode = 1;
});
