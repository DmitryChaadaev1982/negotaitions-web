import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisStatus } from "@/app/generated/prisma/client";
import {
  claimAiAnalysisRun,
  completeAiAnalysisRun,
  failAiAnalysisRun,
  persistAiAnalysisProviderResponseId,
  renewAiAnalysisLease,
  type AiAnalysisOperationStore,
  type AiAnalysisRunOwner,
} from "@/lib/ai/analysis-operation";

type Row = NonNullable<
  Awaited<ReturnType<AiAnalysisOperationStore["findBySession"]>>
>;

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function createMemoryStore(initial: Row | null = null) {
  let row = initial ? { ...initial } : null;
  const trace: string[] = [];

  const store: AiAnalysisOperationStore = {
    async findBySession() {
      trace.push("find");
      return row ? { ...row } : null;
    },
    async createClaim(params) {
      trace.push("create");
      if (row) return null;
      row = {
        id: "analysis-1",
        status: AiAnalysisStatus.ANALYZING,
        runToken: params.runToken,
        leaseExpiresAt: params.leaseExpiresAt,
        providerResponseId: null,
        updatedAt: params.now,
      };
      return { ...row };
    },
    async tryClaimExisting(params) {
      trace.push(`claim:${params.runToken}`);
      if (
        !row ||
        row.id !== params.expected.id ||
        row.status !== params.expected.status ||
        row.runToken !== params.expected.runToken ||
        !sameDate(row.leaseExpiresAt, params.expected.leaseExpiresAt) ||
        !sameDate(row.updatedAt, params.expected.updatedAt)
      ) {
        return false;
      }
      row = {
        id: row.id,
        status: AiAnalysisStatus.ANALYZING,
        runToken: params.runToken,
        leaseExpiresAt: params.leaseExpiresAt,
        providerResponseId: row.providerResponseId,
        updatedAt: params.now,
      };
      return true;
    },
    async renew(owner, now, leaseExpiresAt) {
      trace.push(`renew:${owner.runToken}`);
      if (
        !row ||
        row.id !== owner.analysisId ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== owner.runToken ||
        !row.leaseExpiresAt ||
        row.leaseExpiresAt.getTime() !== owner.leaseExpiresAt.getTime() ||
        row.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        return false;
      }
      row = { ...row, leaseExpiresAt, updatedAt: leaseExpiresAt };
      return true;
    },
    async persistProviderResponseId(params) {
      trace.push(`response:${params.owner.runToken}:${params.providerResponseId}`);
      if (
        !row ||
        row.id !== params.owner.analysisId ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken ||
        !row.leaseExpiresAt ||
        row.leaseExpiresAt.getTime() !== params.owner.leaseExpiresAt.getTime() ||
        row.leaseExpiresAt.getTime() <= params.now.getTime()
      ) {
        return false;
      }
      row = { ...row, providerResponseId: params.providerResponseId };
      return true;
    },
    async complete(params) {
      trace.push(`complete:${params.owner.runToken}`);
      if (
        !row ||
        row.id !== params.owner.analysisId ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken
      ) {
        return false;
      }
      row = {
        ...row,
        status: AiAnalysisStatus.COMPLETED,
        leaseExpiresAt: null,
        updatedAt: params.completedAt,
      };
      return true;
    },
    async fail(params) {
      trace.push(`fail:${params.owner.runToken}`);
      if (
        !row ||
        row.id !== params.owner.analysisId ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken
      ) {
        return false;
      }
      row = {
        ...row,
        status: AiAnalysisStatus.FAILED,
        leaseExpiresAt: null,
        updatedAt: params.completedAt,
      };
      return true;
    },
  };

  return {
    store,
    trace,
    get row() {
      return row ? { ...row } : null;
    },
  };
}

const claimInput = {
  sessionId: "session-1",
  transcriptId: "transcript-1",
  transcriptRetranscribeCount: 0,
  language: "en",
  leaseDurationMs: 180_000,
  legacyStaleAfterMs: 30 * 60_000,
};

const successFields = {
  model: "synthetic-model",
  executiveSummary: "Synthetic summary.",
  overallScore: 50,
  analysisJson: { synthetic: true },
  rawModelOutput: { synthetic: true },
};

test("two simultaneous initial claims produce exactly one owner", async () => {
  const memory = createMemoryStore();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const [first, second] = await Promise.all([
    claimAiAnalysisRun({
      ...claimInput,
      now,
      runToken: "token-a",
      store: memory.store,
    }),
    claimAiAnalysisRun({
      ...claimInput,
      now,
      runToken: "token-b",
      store: memory.store,
    }),
  ]);

  assert.equal(
    [first, second].filter((result) => result.state === "claimed").length,
    1,
  );
  assert.equal(
    [first, second].filter((result) => result.state === "active").length,
    1,
  );
});

test("second request while a valid lease is active is busy", async () => {
  const memory = createMemoryStore();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const first = await claimAiAnalysisRun({
    ...claimInput,
    now,
    runToken: "token-a",
    store: memory.store,
  });
  assert.equal(first.state, "claimed");

  const second = await claimAiAnalysisRun({
    ...claimInput,
    now: new Date(now.getTime() + 60_000),
    runToken: "token-b",
    store: memory.store,
  });
  assert.equal(second.state, "active");
});

test("expired stale claim is recoverable with a new token", async () => {
  const startedAt = new Date("2026-08-07T12:00:00.000Z");
  const memory = createMemoryStore({
    id: "analysis-1",
    status: AiAnalysisStatus.ANALYZING,
    runToken: "old-token",
    leaseExpiresAt: new Date(startedAt.getTime() + 180_000),
    providerResponseId: "resp-recoverable",
    updatedAt: startedAt,
  });
  const expiredOwner: AiAnalysisRunOwner = {
    analysisId: "analysis-1",
    runToken: "old-token",
    leaseExpiresAt: new Date(startedAt.getTime() + 180_000),
    providerResponseId: "resp-recoverable",
  };
  const takeoverAt = new Date(startedAt.getTime() + 180_001);

  assert.equal(
    await renewAiAnalysisLease({
      owner: expiredOwner,
      now: takeoverAt,
      store: memory.store,
    }),
    null,
  );

  const recovered = await claimAiAnalysisRun({
    ...claimInput,
    now: takeoverAt,
    runToken: "new-token",
    store: memory.store,
  });
  assert.equal(recovered.state, "claimed");
  assert.equal(recovered.state === "claimed" && recovered.recoveredStaleRun, true);
  assert.equal(memory.row?.runToken, "new-token");
  assert.equal(memory.row?.providerResponseId, "resp-recoverable");
});

test("old token success, failure, and renewal are fenced after takeover", async () => {
  const startedAt = new Date("2026-08-07T12:00:00.000Z");
  const oldOwner: AiAnalysisRunOwner = {
    analysisId: "analysis-1",
    runToken: "old-token",
    leaseExpiresAt: new Date(startedAt.getTime() + 180_000),
    providerResponseId: null,
  };
  const memory = createMemoryStore({
    id: oldOwner.analysisId,
    status: AiAnalysisStatus.ANALYZING,
    runToken: oldOwner.runToken,
    leaseExpiresAt: oldOwner.leaseExpiresAt,
    providerResponseId: null,
    updatedAt: startedAt,
  });
  await claimAiAnalysisRun({
    ...claimInput,
    now: new Date(startedAt.getTime() + 180_001),
    runToken: "new-token",
    store: memory.store,
  });

  assert.equal(
    await completeAiAnalysisRun({
      owner: oldOwner,
      fields: successFields,
      store: memory.store,
    }),
    false,
  );
  assert.equal(
    await failAiAnalysisRun({
      owner: oldOwner,
      errorMessage: "Synthetic failure.",
      store: memory.store,
    }),
    false,
  );
  assert.equal(
    await renewAiAnalysisLease({
      owner: oldOwner,
      now: new Date(startedAt.getTime() + 180_002),
      store: memory.store,
    }),
    null,
  );
  assert.equal(memory.row?.runToken, "new-token");
  assert.equal(memory.row?.status, AiAnalysisStatus.ANALYZING);
});

test("provider response ID persistence is fenced by current run token and lease", async () => {
  const memory = createMemoryStore();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const claimed = await claimAiAnalysisRun({
    ...claimInput,
    now,
    runToken: "token-a",
    store: memory.store,
  });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") return;

  const persisted = await persistAiAnalysisProviderResponseId({
    owner: claimed.owner,
    providerResponseId: "resp_a",
    now: new Date(now.getTime() + 1_000),
    store: memory.store,
  });
  assert.ok(persisted);
  assert.equal(persisted.providerResponseId, "resp_a");
  assert.equal(memory.row?.providerResponseId, "resp_a");

  const stalePersisted = await persistAiAnalysisProviderResponseId({
    owner: { ...claimed.owner, runToken: "stale-token" },
    providerResponseId: "resp_stale",
    now: new Date(now.getTime() + 2_000),
    store: memory.store,
  });
  assert.equal(stalePersisted, null);
  assert.equal(memory.row?.providerResponseId, "resp_a");
});

test("normal FAILED operation can be manually retried", async () => {
  const memory = createMemoryStore();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const first = await claimAiAnalysisRun({
    ...claimInput,
    now,
    runToken: "token-a",
    store: memory.store,
  });
  assert.equal(first.state, "claimed");
  if (first.state !== "claimed") return;
  assert.equal(
    await failAiAnalysisRun({
      owner: first.owner,
      errorMessage: "Synthetic failure.",
      store: memory.store,
    }),
    true,
  );

  const retried = await claimAiAnalysisRun({
    ...claimInput,
    now: new Date(now.getTime() + 1_000),
    runToken: "token-b",
    store: memory.store,
  });
  assert.equal(retried.state, "claimed");
  assert.equal(memory.row?.runToken, "token-b");
});

test("legacy null-ownership ANALYZING row has grace then stale recovery", async () => {
  const updatedAt = new Date("2026-08-07T12:00:00.000Z");
  const memory = createMemoryStore({
    id: "analysis-1",
    status: AiAnalysisStatus.ANALYZING,
    runToken: null,
    leaseExpiresAt: null,
    providerResponseId: null,
    updatedAt,
  });

  const protectedClaim = await claimAiAnalysisRun({
    ...claimInput,
    now: new Date(updatedAt.getTime() + 29 * 60_000),
    runToken: "new-token",
    store: memory.store,
  });
  assert.equal(protectedClaim.state, "active");

  const recovered = await claimAiAnalysisRun({
    ...claimInput,
    now: new Date(updatedAt.getTime() + 30 * 60_000),
    runToken: "new-token",
    store: memory.store,
  });
  assert.equal(recovered.state, "claimed");
});

test("crash simulation recovers naturally after lease expiry", async () => {
  const memory = createMemoryStore();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const crashed = await claimAiAnalysisRun({
    ...claimInput,
    now,
    runToken: "crashed-token",
    store: memory.store,
  });
  assert.equal(crashed.state, "claimed");

  const recovered = await claimAiAnalysisRun({
    ...claimInput,
    now: new Date(now.getTime() + 180_001),
    runToken: "recovery-token",
    store: memory.store,
  });
  assert.equal(recovered.state, "claimed");
});

test("internal checkpoints renew the same operation token", async () => {
  const memory = createMemoryStore();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const claimed = await claimAiAnalysisRun({
    ...claimInput,
    now,
    runToken: "stable-token",
    store: memory.store,
  });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") return;

  let owner = claimed.owner;
  for (let checkpoint = 1; checkpoint <= 3; checkpoint += 1) {
    const renewed = await renewAiAnalysisLease({
      owner,
      now: new Date(now.getTime() + checkpoint * 1_000),
      store: memory.store,
    });
    assert.ok(renewed);
    owner = renewed;
  }
  assert.deepEqual(
    memory.trace.filter((item) => item.startsWith("renew:")),
    ["renew:stable-token", "renew:stable-token", "renew:stable-token"],
  );
});
