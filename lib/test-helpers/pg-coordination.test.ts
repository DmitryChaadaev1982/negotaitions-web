import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPgLockingSessionSafety,
  applyPgSetupSessionGuards,
  awaitSignalOrFailure,
  createCoordinationBarrier,
  createCoordinationSignal,
  createPgTestClient,
  createPgTestPool,
  endPgTestResources,
  PG_TEST_CONNECTION_TIMEOUT_MS,
  PG_TEST_LOCK_TIMEOUT_SAFETY_MS,
  PG_TEST_LOCK_TIMEOUT_SAFETY_SQL,
  PG_TEST_SETUP_STATEMENT_TIMEOUT_SQL,
  PG_TEST_STATEMENT_TIMEOUT_MS,
} from "./pg-coordination";

test("PG01 mutation rejection before mutationLocked unblocks the waiter", async () => {
  const mutationLocked = createCoordinationSignal({
    timeoutMs: 2_000,
    label: "mutationLocked",
  });
  const mutationPromise = (async () => {
    throw new Error("Prisma.sql is not a function");
  })();

  await assert.rejects(
    () => awaitSignalOrFailure(mutationLocked.promise, mutationPromise),
    /Prisma\.sql is not a function/,
  );
  assert.equal(mutationLocked.isSettled(), false);
});

test("PG02 finalization rejection before finalizationAboutToLock unblocks the waiter", async () => {
  const finalizationAboutToLock = createCoordinationSignal({
    timeoutMs: 2_000,
    label: "finalizationAboutToLock",
  });
  const finalizationPromise = Promise.reject(new Error("finalization setup failed"));

  await assert.rejects(
    () =>
      awaitSignalOrFailure(finalizationAboutToLock.promise, finalizationPromise),
    /finalization setup failed/,
  );
});

test("PG03 coordination barrier timeout fails deterministically", async () => {
  const signal = createCoordinationSignal({
    timeoutMs: 40,
    label: "orphan-wait",
  });
  const started = Date.now();
  await assert.rejects(
    () => signal.promise,
    /Coordination signal timed out after 40ms: orphan-wait/,
  );
  assert.ok(Date.now() - started < 1_000);
});

test("PG04 every opened client is offered cleanup after mutation failure", async () => {
  const ended: string[] = [];
  const clients = ["setup", "mutation", "finalization"].map((name) => ({
    end: async () => {
      ended.push(name);
    },
  }));

  const mutationLocked = createCoordinationSignal({ timeoutMs: 500 });
  await assert.rejects(
    () =>
      awaitSignalOrFailure(
        mutationLocked.promise,
        Promise.reject(new Error("mutation failed")),
      ),
    /mutation failed/,
  );
  await endPgTestResources(clients);
  assert.deepEqual(ended, ["setup", "mutation", "finalization"]);
});

test("PG05 one client cleanup failure does not prevent other cleanup attempts", async () => {
  const ended: string[] = [];
  await endPgTestResources([
    {
      end: async () => {
        ended.push("setup");
        throw new Error("setup end failed");
      },
    },
    {
      end: async () => {
        ended.push("mutation");
      },
    },
    {
      $disconnect: async () => {
        ended.push("prisma");
      },
    },
  ]);
  assert.deepEqual(ended, ["setup", "mutation", "prisma"]);
});

test("PG06 test clients configure connectionTimeoutMillis", () => {
  const client = createPgTestClient("postgres://127.0.0.1:1/unused");
  const pool = createPgTestPool("postgres://127.0.0.1:1/unused");
  assert.equal(PG_TEST_CONNECTION_TIMEOUT_MS, 5_000);
  assert.equal(
    (client as { _connectionTimeoutMillis?: number })._connectionTimeoutMillis,
    PG_TEST_CONNECTION_TIMEOUT_MS,
  );
  assert.equal(client.connectionParameters.connect_timeout, 5);
  assert.equal(pool.options.connectionTimeoutMillis, PG_TEST_CONNECTION_TIMEOUT_MS);
});

test("PG07 statement/lock timeout contract preserves intended locking", () => {
  assert.equal(PG_TEST_STATEMENT_TIMEOUT_MS, 10_000);
  assert.equal(PG_TEST_LOCK_TIMEOUT_SAFETY_MS, 20_000);
  assert.match(PG_TEST_SETUP_STATEMENT_TIMEOUT_SQL, /statement_timeout = '10000ms'/);
  assert.match(PG_TEST_LOCK_TIMEOUT_SAFETY_SQL, /lock_timeout = '20000ms'/);
  assert.doesNotMatch(PG_TEST_LOCK_TIMEOUT_SAFETY_SQL, /statement_timeout/);
  assert.equal(typeof applyPgSetupSessionGuards, "function");
  assert.equal(typeof applyPgLockingSessionSafety, "function");
});

test("PG08 lifecycle barrier cannot hang on upstream failure", async () => {
  const finalizeHold = createCoordinationBarrier({
    timeoutMs: 2_000,
    label: "finalizationAboutToLock",
  });
  const finalizationPromise = (async () => {
    throw new Error("finalizer rejected before lock hook");
  })();

  await assert.rejects(
    () => awaitSignalOrFailure(finalizeHold.arrived, finalizationPromise),
    /finalizer rejected before lock hook/,
  );
  finalizeHold.reject(new Error("finalizer rejected before lock hook"));
  await assert.rejects(() => finalizeHold.wait(), /finalizer rejected before lock hook/);
});
