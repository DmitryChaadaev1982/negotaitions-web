import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisStatus } from "@/app/generated/prisma/client";

async function withDatabaseUrl<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/negotiations_test";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  }
}

test("returns already_running for active analysis", () => {
  return withDatabaseUrl(async () => {
    const { resolveExistingAiAnalysisOutcome } = await import(
      "@/lib/services/ai-analysis-orchestration"
    );
    const result = resolveExistingAiAnalysisOutcome({
      existing: { id: "ai-1", status: AiAnalysisStatus.ANALYZING },
      forceRerun: false,
    });
    assert.deepEqual(result, {
      outcome: "already_running",
      analysisId: "ai-1",
      status: AiAnalysisStatus.ANALYZING,
    });
  });
});

test("returns already_completed unless rerun is forced", () => {
  return withDatabaseUrl(async () => {
    const { resolveExistingAiAnalysisOutcome } = await import(
      "@/lib/services/ai-analysis-orchestration"
    );
    const reused = resolveExistingAiAnalysisOutcome({
      existing: { id: "ai-2", status: AiAnalysisStatus.COMPLETED },
      forceRerun: false,
    });
    assert.deepEqual(reused, {
      outcome: "already_completed",
      analysisId: "ai-2",
      status: AiAnalysisStatus.COMPLETED,
    });

    const forced = resolveExistingAiAnalysisOutcome({
      existing: { id: "ai-2", status: AiAnalysisStatus.COMPLETED },
      forceRerun: true,
    });
    assert.equal(forced, null);
  });
});

test("returns already_failed unless rerun is forced", () => {
  return withDatabaseUrl(async () => {
    const { resolveExistingAiAnalysisOutcome } = await import(
      "@/lib/services/ai-analysis-orchestration"
    );
    const reused = resolveExistingAiAnalysisOutcome({
      existing: { id: "ai-3", status: AiAnalysisStatus.FAILED },
      forceRerun: false,
    });
    assert.deepEqual(reused, {
      outcome: "already_failed",
      analysisId: "ai-3",
      status: AiAnalysisStatus.FAILED,
    });

    const forced = resolveExistingAiAnalysisOutcome({
      existing: { id: "ai-3", status: AiAnalysisStatus.FAILED },
      forceRerun: true,
    });
    assert.equal(forced, null);
  });
});
