import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PROVIDER_SLOT_GLOBAL_ADMISSION_LOCK_ID,
  resolveProviderSlotAdmissionCaps,
} from "@/lib/services/transcript-enhancement-provider-slots";

const SLOT_SOURCE = path.join(
  process.cwd(),
  "lib",
  "services",
  "transcript-enhancement-provider-slots.ts",
);

test("GLOBAL-LOWER lock identity is explicit and not derived from jobId", () => {
  assert.equal(
    PROVIDER_SLOT_GLOBAL_ADMISSION_LOCK_ID,
    "transcript-enhancement-provider-slot-global-admission",
  );
  assert.ok(!PROVIDER_SLOT_GLOBAL_ADMISSION_LOCK_ID.includes("jobId"));
});

test("GLOBAL-LOWER admission lock order is GLOBAL then JOB; release takes none", async () => {
  const source = await readFile(SLOT_SOURCE, "utf8");
  const acquireStart = source.indexOf("Canonical admission lock order");
  const helperStart = source.indexOf("async function acquireProviderSlotAdmissionLocks");
  const acquireEnd = source.indexOf("export async function acquireProviderSlot(");
  const releaseStart = source.indexOf("export async function releaseProviderSlot(");
  assert.ok(acquireStart >= 0);
  assert.ok(helperStart > acquireStart);
  assert.ok(acquireEnd > helperStart);
  assert.ok(releaseStart > acquireEnd);

  const lockHelper = source.slice(acquireStart, acquireEnd);
  const globalLock = lockHelper.indexOf("PROVIDER_SLOT_GLOBAL_ADMISSION_LOCK_ID");
  const jobLock = lockHelper.indexOf("hashtext(${jobId})");
  assert.ok(globalLock >= 0, "GLOBAL advisory lock must be acquired first");
  assert.ok(jobLock > globalLock, "JOB advisory lock must follow GLOBAL");
  assert.equal(
    lockHelper.split("pg_advisory_xact_lock").length - 1,
    2,
    "admission helper must take exactly GLOBAL then JOB",
  );
  assert.ok(
    lockHelper.includes("GLOBAL → JOB → SLOT ROW"),
    "canonical lock order must be documented on the helper",
  );

  const acquireFn = source.slice(acquireEnd, releaseStart);
  assert.match(acquireFn, /await acquireProviderSlotAdmissionLocks\(raw, params\.jobId\)/);
  assert.ok(
    !acquireFn.includes("pg_advisory_xact_lock(hashtext(${params.jobId}))"),
    "acquireProviderSlot must not take the JOB lock before the helper",
  );

  const releaseFn = source.slice(releaseStart);
  assert.ok(!releaseFn.includes("pg_advisory"), "ordinary slot release must not take admission locks");
});

test("GLOBAL-LOWER configuration may lower caps and never raise hard ceilings", () => {
  const previousGlobal = process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
  const previousPerJob = process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY = "10";
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "8";
    assert.equal(resolveProviderSlotAdmissionCaps({ globalCap: 1 }).globalCap, 1);
    assert.equal(resolveProviderSlotAdmissionCaps({ globalCap: 2 }).globalCap, 2);
    assert.equal(resolveProviderSlotAdmissionCaps({ globalCap: 4 }).globalCap, 4);
    assert.equal(resolveProviderSlotAdmissionCaps({ globalCap: 10 }).globalCap, 10);
    assert.equal(resolveProviderSlotAdmissionCaps({ globalCap: 100 }).globalCap, 10);
    assert.equal(resolveProviderSlotAdmissionCaps({ perJobCap: 100 }).perJobCap, 8);
    assert.equal(
      resolveProviderSlotAdmissionCaps({ globalCap: 4, perJobCap: 2 }).perJobCap,
      2,
    );
  } finally {
    if (previousGlobal === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY = previousGlobal;
    if (previousPerJob === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = previousPerJob;
  }
});
