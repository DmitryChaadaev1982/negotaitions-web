/**
 * Second-process provider-slot holder for the BUG02 Slice B cross-process cap
 * test. This is test infrastructure, not Product runtime: it exercises the same
 * `lib/services/transcript-enhancement-provider-slots` authority that the
 * application and the maintenance/recovery process use, so the two processes
 * must contend on the same database rows.
 *
 * Usage: node --import tsx tests/pg-race/provider-slot-holder.ts
 * Env: E2E_DATABASE_URL, HOLDER_JOB_ID, HOLDER_RUN_ID, HOLDER_SLOT_COUNT,
 *      HOLDER_TTL_MS, optional HOLDER_GLOBAL_CAP, HOLDER_PER_JOB_CAP,
 *      HOLDER_DISTINCT_JOB_COUNT
 * Protocol: prints one JSON line `{"acquired":n}` on stdout once the requested
 * slots are held, then holds them until killed.
 */
import { acquireProviderSlot } from "@/lib/services/transcript-enhancement-provider-slots";
import { createE2ePrisma } from "./e2e-prisma";

async function main(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL?.trim();
  if (!url) throw new Error("E2E_DATABASE_URL is required");
  const jobId = process.env.HOLDER_JOB_ID?.trim() || "holder-job";
  const runId = process.env.HOLDER_RUN_ID?.trim() || "holder-run";
  const slotCount = Number(process.env.HOLDER_SLOT_COUNT ?? "8");
  const ttlMs = Number(process.env.HOLDER_TTL_MS ?? "8000");
  const distinctJobCount = Math.max(
    1,
    Math.round(Number(process.env.HOLDER_DISTINCT_JOB_COUNT ?? "1")) || 1,
  );
  const globalCapRaw = process.env.HOLDER_GLOBAL_CAP;
  const globalCap =
    globalCapRaw != null && globalCapRaw.trim() !== ""
      ? Number(globalCapRaw)
      : undefined;
  const perJobCapRaw = process.env.HOLDER_PER_JOB_CAP;
  const perJobCap =
    perJobCapRaw != null && perJobCapRaw.trim() !== ""
      ? Number(perJobCapRaw)
      : slotCount;
  const { prisma, pool } = createE2ePrisma(url);

  let acquired = 0;
  for (let i = 0; i < slotCount; i += 1) {
    const heldJobId = distinctJobCount > 1 ? `${jobId}-${i % distinctJobCount}` : jobId;
    const lease = await acquireProviderSlot({
      db: prisma,
      jobId: heldJobId,
      runId: distinctJobCount > 1 ? `${heldJobId}-run` : runId,
      ttlMs,
      perJobCap,
      ...(Number.isFinite(globalCap) ? { globalCap } : {}),
    });
    if (!lease) break;
    acquired += 1;
  }
  process.stdout.write(`${JSON.stringify({ acquired })}\n`);

  // Hold the leases without releasing. The parent kills this process to
  // simulate a crash; capacity must come back only through lease expiry.
  await new Promise<void>(() => {});
  await pool.end();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
