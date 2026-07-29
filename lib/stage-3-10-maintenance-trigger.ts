import { runSessionConnectionExpirySweep } from "@/lib/stage-3-10-maintenance";

let inFlightSweep: Promise<void> | null = null;
let lastSweepStartedAtMs = 0;

export async function triggerStage310ExpiryReconciliation(options?: {
  minIntervalMs?: number;
  limit?: number;
}) {
  const minIntervalMs = Math.max(0, options?.minIntervalMs ?? 2_500);
  const limit = Math.max(1, Math.min(options?.limit ?? 200, 1000));
  const nowMs = Date.now();

  if (inFlightSweep) {
    await inFlightSweep;
    return;
  }
  if (nowMs - lastSweepStartedAtMs < minIntervalMs) {
    return;
  }

  lastSweepStartedAtMs = nowMs;
  inFlightSweep = runSessionConnectionExpirySweep({ limit })
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          area: "stage_3_10_maintenance",
          event: "triggered_expiry_reconciliation_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    })
    .finally(() => {
      inFlightSweep = null;
    });

  await inFlightSweep;
}
