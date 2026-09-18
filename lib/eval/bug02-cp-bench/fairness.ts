export type FairnessPolicyId = "reserved_slot" | "half_share";

export function resolveMaxPerJobShare(params: {
  globalCap: number;
  perJobCap: number;
  policy: FairnessPolicyId;
}): number {
  const { globalCap, perJobCap, policy } = params;
  if (globalCap <= 1) {
    return 1;
  }
  const policyCap =
    policy === "half_share"
      ? Math.max(1, Math.floor(globalCap / 2))
      : Math.max(1, globalCap - 1);
  return Math.min(perJobCap, policyCap);
}

export function assertNoMonopoly(params: {
  globalCap: number;
  maxPerJob: number;
}): void {
  if (params.globalCap > 1 && params.maxPerJob >= params.globalCap) {
    throw new Error("PER_JOB_SHARE_VIOLATION: one job can consume the whole global cap");
  }
}

export class FairGlobalLimiter {
  private globalInFlight = 0;
  private readonly perJobInFlight = new Map<string, number>();
  private readonly waiters: Array<() => void> = [];
  readonly samples: Array<{
    atMs: number;
    globalInFlight: number;
    perJobInFlight: Record<string, number>;
  }> = [];

  constructor(
    readonly globalCap: number,
    readonly perJobCap: number,
    readonly policy: FairnessPolicyId,
  ) {
    const maxPerJob = resolveMaxPerJobShare({
      globalCap,
      perJobCap,
      policy,
    });
    assertNoMonopoly({ globalCap, maxPerJob });
  }

  maxPerJob(): number {
    return resolveMaxPerJobShare({
      globalCap: this.globalCap,
      perJobCap: this.perJobCap,
      policy: this.policy,
    });
  }

  snapshot(): { globalInFlight: number; perJobInFlight: Record<string, number> } {
    return {
      globalInFlight: this.globalInFlight,
      perJobInFlight: Object.fromEntries(this.perJobInFlight.entries()),
    };
  }

  async withSlot<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(jobId);
    try {
      return await fn();
    } finally {
      this.release(jobId);
    }
  }

  private canAcquire(jobId: string): boolean {
    const jobCount = this.perJobInFlight.get(jobId) ?? 0;
    return this.globalInFlight < this.globalCap && jobCount < this.maxPerJob();
  }

  private async acquire(jobId: string): Promise<void> {
    while (!this.canAcquire(jobId)) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.globalInFlight += 1;
    this.perJobInFlight.set(jobId, (this.perJobInFlight.get(jobId) ?? 0) + 1);
    this.samples.push({ atMs: Date.now(), ...this.snapshot() });
  }

  private release(jobId: string): void {
    const current = this.perJobInFlight.get(jobId) ?? 1;
    if (current <= 1) this.perJobInFlight.delete(jobId);
    else this.perJobInFlight.set(jobId, current - 1);
    this.globalInFlight = Math.max(0, this.globalInFlight - 1);
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter();
  }
}

export function summarizeFairness(samples: FairGlobalLimiter["samples"], jobIds: string[]) {
  const maxGlobal = samples.reduce((max, sample) => Math.max(max, sample.globalInFlight), 0);
  const maxPerJob = Object.fromEntries(
    jobIds.map((jobId) => [
      jobId,
      samples.reduce((max, sample) => Math.max(max, sample.perJobInFlight[jobId] ?? 0), 0),
    ]),
  );
  const starved = jobIds.filter((jobId) => (maxPerJob[jobId] ?? 0) === 0);
  return {
    maxGlobalInFlight: maxGlobal,
    maxPerJobInFlight: maxPerJob,
    starvedJobs: starved,
    sampleCount: samples.length,
  };
}
