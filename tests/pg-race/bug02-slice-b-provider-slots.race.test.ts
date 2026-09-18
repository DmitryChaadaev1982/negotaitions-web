import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";

import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  acquireProviderSlot,
  acquireProviderSlotWithWait,
  countActiveProviderSlots,
  ensureProviderSlotInventory,
  getProviderSlotLeaseTtlMs,
  getProviderSlotPerJobCap,
  resolveProviderSlotAdmissionCaps,
  ProviderSlotUnavailableError,
  releaseProviderSlot,
  TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
  withProviderSlotLease,
  type ProviderSlotLease,
} from "@/lib/services/transcript-enhancement-provider-slots";
import { createPgTestClient, endPgTestResources } from "@/lib/test-helpers/pg-coordination";
import { requirePgDatabase } from "@/lib/test-helpers/pg-test-gate";
import {
  assertIsolatedE2eDatabase,
  isE2eDatabaseConfigured,
} from "../e2e/helpers/e2e-database";
import { createE2ePrisma } from "./e2e-prisma";

const SKIP_REASON = "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";
const TEST_TTL_MS = 2_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withSlotHarness(
  t: { skip: (reason: string) => void },
  run: (params: { prisma: PrismaClient; url: string }) => Promise<void>,
) {
  if (!requirePgDatabase(t, {
    databaseReady: isE2eDatabaseConfigured(),
    unavailableReason: SKIP_REASON,
  })) {
    return;
  }
  const url = assertIsolatedE2eDatabase();
  const setup = createPgTestClient(url);
  const { prisma, pool } = createE2ePrisma(url);
  await setup.connect();
  try {
    // Leave no lease from an earlier suite behind.
    await setup.query(`UPDATE "TranscriptEnhancementProviderSlot"
      SET "jobId" = NULL, "runId" = NULL, "leaseToken" = NULL,
          "acquiredAt" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = NOW()`);
    await run({ prisma, url });
  } finally {
    await setup.query(`UPDATE "TranscriptEnhancementProviderSlot"
      SET "jobId" = NULL, "runId" = NULL, "leaseToken" = NULL,
          "acquiredAt" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = NOW()`);
    await endPgTestResources([prisma, pool, setup]);
  }
}

async function spawnHolder(params: {
  url: string;
  jobId: string;
  slotCount: number;
  ttlMs: number;
  globalCap?: number;
  perJobCap?: number;
  distinctJobCount?: number;
}): Promise<{ child: ChildProcess; acquired: number }> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join("tests", "pg-race", "provider-slot-holder.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        E2E_DATABASE_URL: params.url,
        HOLDER_JOB_ID: params.jobId,
        HOLDER_RUN_ID: `${params.jobId}-run`,
        HOLDER_SLOT_COUNT: String(params.slotCount),
        HOLDER_TTL_MS: String(params.ttlMs),
        ...(params.globalCap != null
          ? { HOLDER_GLOBAL_CAP: String(params.globalCap) }
          : {}),
        ...(params.perJobCap != null
          ? { HOLDER_PER_JOB_CAP: String(params.perJobCap) }
          : {}),
        ...(params.distinctJobCount != null
          ? { HOLDER_DISTINCT_JOB_COUNT: String(params.distinctJobCount) }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  if (!childStdout || !childStderr) {
    throw new Error("holder process is missing piped stdio");
  }

  const acquired = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("holder process did not report in time")), 30_000);
    let buffer = "";
    let stderr = "";
    childStdout.setEncoding("utf8");
    childStderr.setEncoding("utf8");
    childStdout.on("data", (piece: string) => {
      buffer += piece;
      const line = buffer.split("\n").find((candidate) => candidate.trim().startsWith("{"));
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as { acquired?: number };
        if (typeof parsed.acquired === "number") {
          clearTimeout(timeout);
          resolve(parsed.acquired);
        }
      } catch {
        // Wait for a complete line.
      }
    });
    childStderr.on("data", (piece: string) => {
      stderr += piece;
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`holder exited early with code ${code}: ${stderr}`));
    });
  });

  return { child, acquired };
}

test("SLOT-01 fixed inventory bootstrap is idempotent", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const first = await ensureProviderSlotInventory({ db: prisma });
    const second = await ensureProviderSlotInventory({ db: prisma });
    assert.equal(first, 0, "migration already seeded the inventory");
    assert.equal(second, 0);
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "count" FROM "TranscriptEnhancementProviderSlot"`,
    )) as Array<{ count: number }>;
    assert.equal(rows[0]?.count, TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT);
  });
});

test("SLOT-02 global cap holds and per-job cap reserves capacity for other jobs", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobA = `job-a-${randomUUID()}`;
    const jobB = `job-b-${randomUUID()}`;
    const perJobCap = getProviderSlotPerJobCap();
    assert.equal(perJobCap, 8);

    const jobALeases = [];
    for (let i = 0; i < perJobCap + 3; i += 1) {
      const lease = await acquireProviderSlot({
        db: prisma,
        jobId: jobA,
        runId: `${jobA}-run`,
        ttlMs: TEST_TTL_MS,
      });
      if (!lease) break;
      jobALeases.push(lease);
    }
    assert.equal(jobALeases.length, perJobCap, "job A must never exceed the per-job cap");
    assert.equal(await countActiveProviderSlots({ db: prisma, jobId: jobA }), perJobCap);

    const jobBLeases = [];
    for (let i = 0; i < 5; i += 1) {
      const lease = await acquireProviderSlot({
        db: prisma,
        jobId: jobB,
        runId: `${jobB}-run`,
        ttlMs: TEST_TTL_MS,
      });
      if (!lease) break;
      jobBLeases.push(lease);
    }
    assert.equal(
      jobBLeases.length,
      TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT - perJobCap,
      "reserved slots must remain available to a second job",
    );
    assert.equal(
      await countActiveProviderSlots({ db: prisma }),
      TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
    );

    await releaseProviderSlot({
      db: prisma,
      slotIndex: jobALeases[0]!.slotIndex,
      leaseToken: jobALeases[0]!.leaseToken,
    });
    assert.equal(
      await countActiveProviderSlots({ db: prisma }),
      TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT - 1,
    );
  });
});

test("SLOT-03 concurrent acquisition never exceeds the global cap", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobs = Array.from({ length: 6 }, () => `job-${randomUUID()}`);
    const results = await Promise.all(
      jobs.flatMap((jobId) =>
        Array.from({ length: 4 }, () =>
          acquireProviderSlot({ db: prisma, jobId, runId: `${jobId}-run`, ttlMs: TEST_TTL_MS }),
        ),
      ),
    );
    const granted = results.filter((lease) => lease !== null);
    assert.equal(granted.length, TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT);
    assert.equal(
      new Set(granted.map((lease) => lease!.slotIndex)).size,
      TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
      "each granted lease must own a distinct slot",
    );
    assert.equal(
      await countActiveProviderSlots({ db: prisma }),
      TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
    );
  });
});

test("SLOT-04 stale owner cannot release a slot re-acquired by a new owner", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobA = `stale-a-${randomUUID()}`;
    const jobB = `stale-b-${randomUUID()}`;
    const ownerA = await acquireProviderSlot({
      db: prisma,
      jobId: jobA,
      runId: `${jobA}-run`,
      ttlMs: 50,
    });
    assert.ok(ownerA);
    await delay(120);

    const ownerB = await acquireProviderSlot({
      db: prisma,
      jobId: jobB,
      runId: `${jobB}-run`,
      ttlMs: TEST_TTL_MS,
    });
    assert.ok(ownerB);
    assert.equal(ownerB!.slotIndex, ownerA!.slotIndex, "expired slot is reused first");

    const staleRelease = await releaseProviderSlot({
      db: prisma,
      slotIndex: ownerA!.slotIndex,
      leaseToken: ownerA!.leaseToken,
    });
    assert.equal(staleRelease, false, "stale owner must not clear the new lease");
    assert.equal(await countActiveProviderSlots({ db: prisma, jobId: jobB }), 1);

    const ownRelease = await releaseProviderSlot({
      db: prisma,
      slotIndex: ownerB!.slotIndex,
      leaseToken: ownerB!.leaseToken,
    });
    assert.equal(ownRelease, true);
    assert.equal(await countActiveProviderSlots({ db: prisma }), 0);
  });
});

test("SLOT-05 saturated capacity fails closed instead of bypassing the limiter", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const holder = `hold-${randomUUID()}`;
    for (let i = 0; i < TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT; i += 1) {
      const lease = await acquireProviderSlot({
        db: prisma,
        jobId: `${holder}-${i}`,
        runId: `${holder}-run`,
        ttlMs: TEST_TTL_MS,
      });
      assert.ok(lease);
    }
    let providerCalls = 0;
    await assert.rejects(
      () =>
        withProviderSlotLease(
          {
            db: prisma,
            jobId: `blocked-${randomUUID()}`,
            runId: "blocked-run",
            ttlMs: TEST_TTL_MS,
            maxWaitMs: 150,
            sleep: (ms) => delay(ms),
          },
          async () => {
            providerCalls += 1;
          },
        ),
      (error: unknown) => error instanceof ProviderSlotUnavailableError,
    );
    assert.equal(providerCalls, 0, "no provider call may happen without a slot");
  });
});

test("SLOT-06 clean release returns capacity immediately", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobId = `clean-${randomUUID()}`;
    let observedActive = 0;
    await withProviderSlotLease(
      { db: prisma, jobId, runId: `${jobId}-run`, ttlMs: TEST_TTL_MS },
      async () => {
        observedActive = await countActiveProviderSlots({ db: prisma });
      },
    );
    assert.equal(observedActive, 1);
    assert.equal(await countActiveProviderSlots({ db: prisma }), 0);
  });
});

test("SLOT-07 provider slot lease TTL covers the provider timeout plus slack", async (t) => {
  await withSlotHarness(t, async () => {
    assert.ok(
      getProviderSlotLeaseTtlMs() >= 15_000,
      `lease TTL must include slack, got ${getProviderSlotLeaseTtlMs()}`,
    );
  });
});

test("CAP-01/02/03 DB admission clamps per-job overrides of 9/10/100 to 8", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    assert.equal(resolveProviderSlotAdmissionCaps({ perJobCap: 9 }).perJobCap, 8);
    assert.equal(resolveProviderSlotAdmissionCaps({ perJobCap: 10 }).perJobCap, 8);
    assert.equal(resolveProviderSlotAdmissionCaps({ perJobCap: 100 }).perJobCap, 8);

    const jobId = `cap-override-${randomUUID()}`;
    const leases = [];
    for (let i = 0; i < 12; i += 1) {
      const lease = await acquireProviderSlot({
        db: prisma,
        jobId,
        runId: `${jobId}-run`,
        ttlMs: TEST_TTL_MS,
        perJobCap: 100,
      });
      if (!lease) break;
      leases.push(lease);
    }
    assert.equal(leases.length, 8);
    assert.equal(await countActiveProviderSlots({ db: prisma, jobId }), 8);
  });
});

test("CAP-04 same-process concurrent acquisition with override >8 stays at 8", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobId = `cap-concurrent-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        acquireProviderSlot({
          db: prisma,
          jobId,
          runId: `${jobId}-run`,
          ttlMs: TEST_TTL_MS,
          perJobCap: 100,
        }),
      ),
    );
    const granted = results.filter((lease) => lease !== null);
    assert.equal(granted.length, 8);
    assert.equal(await countActiveProviderSlots({ db: prisma, jobId }), 8);
  });
});

test("CAP-05/06 second process cannot raise the same-job cap; reserved capacity stays available", async (t) => {
  await withSlotHarness(t, async ({ prisma, url }) => {
    const jobA = `cap-p1-${randomUUID()}`;
    const jobB = `cap-p2-${randomUUID()}`;
    const { child, acquired } = await spawnHolder({
      url,
      jobId: jobA,
      slotCount: 10,
      ttlMs: TEST_TTL_MS,
    });
    try {
      assert.equal(acquired, 8, "cross-process override >8 must still acquire at most 8");
      assert.equal(await countActiveProviderSlots({ db: prisma, jobId: jobA }), 8);

      const sameJobExtra = await acquireProviderSlot({
        db: prisma,
        jobId: jobA,
        runId: `${jobA}-extra`,
        ttlMs: TEST_TTL_MS,
        perJobCap: 100,
      });
      assert.equal(sameJobExtra, null, "same job cannot take a 9th slot even with override");

      const otherJob = await acquireProviderSlot({
        db: prisma,
        jobId: jobB,
        runId: `${jobB}-run`,
        ttlMs: TEST_TTL_MS,
        perJobCap: 100,
      });
      assert.ok(otherJob, "reserved capacity must remain available to a second job");
      assert.ok(
        (await countActiveProviderSlots({ db: prisma })) <= TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
      );
      await releaseProviderSlot({
        db: prisma,
        slotIndex: otherJob!.slotIndex,
        leaseToken: otherJob!.leaseToken,
      });
    } finally {
      child.kill("SIGKILL");
    }
  });
});

test("SLOT-08 two real processes share one global cap and crashed capacity expires", async (t) => {
  await withSlotHarness(t, async ({ prisma, url }) => {
    const jobA = `p1-${randomUUID()}`;
    const jobB = `p2-${randomUUID()}`;
    const holderTtlMs = 4_000;
    const { child, acquired } = await spawnHolder({
      url,
      jobId: jobA,
      slotCount: 8,
      ttlMs: holderTtlMs,
    });

    let killed = false;
    try {
      assert.equal(acquired, 8, "process P1 must hold 8 slots");
      assert.equal(await countActiveProviderSlots({ db: prisma, jobId: jobA }), 8);

      const samples: number[] = [];
      const jobBLeases = [];
      for (let i = 0; i < 5; i += 1) {
        const lease = await acquireProviderSlot({
          db: prisma,
          jobId: jobB,
          runId: `${jobB}-run`,
          ttlMs: holderTtlMs,
        });
        samples.push(await countActiveProviderSlots({ db: prisma }));
        if (!lease) break;
        jobBLeases.push(lease);
      }
      assert.equal(jobBLeases.length, 2, "process P2 may only take the 2 reserved slots");
      assert.ok(
        samples.every((count) => count <= TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT),
        `global active leases exceeded the cap: ${samples.join(",")}`,
      );

      for (const lease of jobBLeases) {
        await releaseProviderSlot({
          db: prisma,
          slotIndex: lease.slotIndex,
          leaseToken: lease.leaseToken,
        });
      }

      // Crash P1 without a clean release: capacity must come back only via TTL.
      child.kill("SIGKILL");
      killed = true;
      assert.equal(
        await countActiveProviderSlots({ db: prisma, jobId: jobA }),
        8,
        "a killed process must not silently free its leases",
      );

      await delay(holderTtlMs + 500);
      assert.equal(await countActiveProviderSlots({ db: prisma }), 0);

      const reacquired = [];
      for (let i = 0; i < TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT; i += 1) {
        const lease = await acquireProviderSlotWithWait({
          db: prisma,
          jobId: `${jobB}-recover-${i}`,
          runId: `${jobB}-recover`,
          ttlMs: TEST_TTL_MS,
          maxWaitMs: 100,
          sleep: (ms) => delay(ms),
        });
        if (!lease) break;
        reacquired.push(lease);
      }
      assert.equal(
        reacquired.length,
        TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
        "expired capacity must be fully reusable",
      );
    } finally {
      if (!killed) child.kill("SIGKILL");
    }
  });
});

async function acquireBehindBarrier(params: {
  prisma: PrismaClient;
  jobIds: string[];
  attemptsPerJob: number;
  globalCap?: number;
  perJobCap?: number;
  ttlMs?: number;
}): Promise<Array<ProviderSlotLease | null>> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attempts = params.jobIds.flatMap((jobId) =>
    Array.from({ length: params.attemptsPerJob }, async () => {
      await barrier;
      return acquireProviderSlot({
        db: params.prisma,
        jobId,
        runId: `${jobId}-run`,
        ttlMs: params.ttlMs ?? TEST_TTL_MS,
        globalCap: params.globalCap,
        perJobCap: params.perJobCap,
      });
    }),
  );
  release();
  return Promise.all(attempts);
}

function grantedLeases(results: Array<ProviderSlotLease | null>): ProviderSlotLease[] {
  return results.filter((lease): lease is ProviderSlotLease => lease !== null);
}

test("GLOBAL-LOWER-01 configured global=2 is a hard bound across concurrent different jobs", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobIds = Array.from({ length: 12 }, () => `gl01-${randomUUID()}`);
    const results = await acquireBehindBarrier({
      prisma,
      jobIds,
      attemptsPerJob: 2,
      globalCap: 2,
    });
    const granted = grantedLeases(results);
    const active = await countActiveProviderSlots({ db: prisma });
    assert.ok(granted.length <= 2, `global=2 granted ${granted.length}`);
    assert.ok(active <= 2, `global=2 active ${active}`);
    assert.equal(granted.length, active);
    assert.equal(new Set(granted.map((lease) => lease.slotIndex)).size, granted.length);
  });
});

test("GLOBAL-LOWER-02 configured global=1 admits at most one concurrent grant", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobIds = Array.from({ length: 10 }, () => `gl02-${randomUUID()}`);
    const results = await acquireBehindBarrier({
      prisma,
      jobIds,
      attemptsPerJob: 1,
      globalCap: 1,
    });
    const granted = grantedLeases(results);
    const active = await countActiveProviderSlots({ db: prisma });
    assert.equal(granted.length, 1);
    assert.equal(active, 1);
  });
});

test("GLOBAL-LOWER-03 configured global=4 admits at most four concurrent grants", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobIds = Array.from({ length: 12 }, () => `gl03-${randomUUID()}`);
    const results = await acquireBehindBarrier({
      prisma,
      jobIds,
      attemptsPerJob: 2,
      globalCap: 4,
    });
    const granted = grantedLeases(results);
    const active = await countActiveProviderSlots({ db: prisma });
    assert.ok(granted.length <= 4, `global=4 granted ${granted.length}`);
    assert.ok(active <= 4, `global=4 active ${active}`);
    assert.equal(granted.length, active);
  });
});

test("GLOBAL-LOWER-04 default global cap remains at most the physical 10", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const { globalCap } = resolveProviderSlotAdmissionCaps();
    const jobIds = Array.from({ length: 8 }, () => `gl04-${randomUUID()}`);
    const results = await acquireBehindBarrier({
      prisma,
      jobIds,
      attemptsPerJob: 3,
    });
    const granted = grantedLeases(results);
    const active = await countActiveProviderSlots({ db: prisma });
    const expected = Math.min(globalCap, TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT);
    assert.ok(granted.length <= TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT);
    assert.equal(granted.length, expected);
    assert.equal(active, expected);
  });
});

test("GLOBAL-LOWER-05 lowered global and per-job caps both hold", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const jobIds = Array.from({ length: 6 }, () => `gl05-${randomUUID()}`);
    const results = await acquireBehindBarrier({
      prisma,
      jobIds,
      attemptsPerJob: 4,
      globalCap: 4,
      perJobCap: 2,
    });
    const granted = grantedLeases(results);
    const active = await countActiveProviderSlots({ db: prisma });
    assert.ok(granted.length <= 4, `global=4 granted ${granted.length}`);
    assert.ok(active <= 4, `global=4 active ${active}`);
    for (const jobId of jobIds) {
      const jobActive = await countActiveProviderSlots({ db: prisma, jobId });
      assert.ok(jobActive <= 2, `${jobId} held ${jobActive}`);
    }
  });
});

test("GLOBAL-LOWER-XPROC second process cannot exceed a shared global=2 cap", async (t) => {
  await withSlotHarness(t, async ({ prisma, url }) => {
    const jobA = `gl-xproc-p1-${randomUUID()}`;
    const { child, acquired } = await spawnHolder({
      url,
      jobId: jobA,
      slotCount: 1,
      ttlMs: TEST_TTL_MS,
      globalCap: 2,
    });
    try {
      assert.equal(acquired, 1, "process P1 must hold one lease under global=2");
      assert.equal(await countActiveProviderSlots({ db: prisma }), 1);

      const jobIds = Array.from({ length: 12 }, () => `gl-xproc-p2-${randomUUID()}`);
      const results = await acquireBehindBarrier({
        prisma,
        jobIds,
        attemptsPerJob: 1,
        globalCap: 2,
      });
      const granted = grantedLeases(results);
      const active = await countActiveProviderSlots({ db: prisma });
      assert.ok(granted.length <= 1, `P2 granted ${granted.length} under remaining global=2`);
      assert.ok(acquired + granted.length <= 2);
      assert.ok(active <= 2, `cross-process active ${active}`);
    } finally {
      child.kill("SIGKILL");
    }
  });
});

test("GLOBAL-LOWER-LOCK same-job, different-job, and mixed admission complete without deadlock", async (t) => {
  await withSlotHarness(t, async ({ prisma }) => {
    const sameJob = `gl-lock-same-${randomUUID()}`;
    const differentJobs = Array.from({ length: 6 }, () => `gl-lock-diff-${randomUUID()}`);
    const mixedJobs = [sameJob, ...differentJobs];
    const results = await Promise.all([
      acquireBehindBarrier({
        prisma,
        jobIds: [sameJob],
        attemptsPerJob: 8,
        globalCap: 4,
        perJobCap: 2,
      }),
      acquireBehindBarrier({
        prisma,
        jobIds: differentJobs,
        attemptsPerJob: 1,
        globalCap: 4,
        perJobCap: 2,
      }),
      acquireBehindBarrier({
        prisma,
        jobIds: mixedJobs,
        attemptsPerJob: 2,
        globalCap: 4,
        perJobCap: 2,
      }),
    ]);
    const granted = results.flatMap(grantedLeases);
    const active = await countActiveProviderSlots({ db: prisma });
    assert.ok(granted.length <= 4);
    assert.ok(active <= 4);
    assert.ok((await countActiveProviderSlots({ db: prisma, jobId: sameJob })) <= 2);
  });
});
