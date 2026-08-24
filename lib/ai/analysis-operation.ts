import { randomUUID } from "node:crypto";

import {
  AiAnalysisStatus,
  Prisma,
  type PrismaClient,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { lockSessionParticipantsForSession } from "@/lib/session-participant-locking";

const DEFAULT_LEASE_DURATION_MS = 180_000;
const MIN_LEASE_DURATION_MS = 150_000;
const MAX_LEASE_DURATION_MS = 600_000;
const DEFAULT_LEGACY_STALE_AFTER_MS = 30 * 60_000;
const MIN_LEGACY_STALE_AFTER_MS = 10 * 60_000;
const MAX_LEGACY_STALE_AFTER_MS = 24 * 60 * 60_000;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

export function getAiAnalysisLeaseDurationMs(): number {
  return boundedInteger(
    process.env.AI_ANALYSIS_LEASE_DURATION_MS,
    DEFAULT_LEASE_DURATION_MS,
    MIN_LEASE_DURATION_MS,
    MAX_LEASE_DURATION_MS,
  );
}

export function getAiAnalysisLegacyStaleAfterMs(): number {
  return boundedInteger(
    process.env.AI_ANALYSIS_LEGACY_STALE_AFTER_MS,
    DEFAULT_LEGACY_STALE_AFTER_MS,
    MIN_LEGACY_STALE_AFTER_MS,
    MAX_LEGACY_STALE_AFTER_MS,
  );
}

export type AiAnalysisRunOwner = {
  analysisId: string;
  runToken: string;
  leaseExpiresAt: Date;
  providerResponseId: string | null;
};

type AiAnalysisOperationRow = {
  id: string;
  status: AiAnalysisStatus;
  runToken: string | null;
  leaseExpiresAt: Date | null;
  providerResponseId: string | null;
  transcriptId: string | null;
  transcriptRetranscribeCount: number;
  language: string | null;
  updatedAt: Date;
};

export type AiAnalysisInputIdentity = {
  transcriptId: string;
  transcriptRetranscribeCount: number;
  language: string;
};

export type AiAnalysisClaimResult =
  | {
      state: "claimed";
      owner: AiAnalysisRunOwner;
      recoveredStaleRun: boolean;
    }
  | {
      state: "active";
      analysis: {
        id: string;
        status: AiAnalysisStatus;
        leaseExpiresAt: Date | null;
      };
    };

export type AiAnalysisSuccessFields = {
  model: string;
  executiveSummary: string;
  overallScore: number;
  analysisJson: Prisma.InputJsonValue;
  rawModelOutput: Prisma.InputJsonValue;
};

export type AiAnalysisOperationStore = {
  findBySession(sessionId: string): Promise<AiAnalysisOperationRow | null>;
  createClaim(params: {
    sessionId: string;
    transcriptId: string;
    transcriptRetranscribeCount: number;
    language: string;
    runToken: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<AiAnalysisOperationRow | null>;
  tryClaimExisting(params: {
    expected: AiAnalysisOperationRow;
    transcriptId: string;
    transcriptRetranscribeCount: number;
    language: string;
    runToken: string;
    now: Date;
    leaseExpiresAt: Date;
    providerResponseId: string | null;
  }): Promise<boolean>;
  start(
    owner: AiAnalysisRunOwner,
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<boolean>;
  renew(
    owner: AiAnalysisRunOwner,
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<boolean>;
  persistProviderResponseId(params: {
    owner: AiAnalysisRunOwner;
    providerResponseId: string;
    now: Date;
  }): Promise<boolean>;
  clearProviderResponseId(params: {
    owner: AiAnalysisRunOwner;
    now: Date;
  }): Promise<boolean>;
  complete(params: {
    owner: AiAnalysisRunOwner;
    completedAt: Date;
    fields: AiAnalysisSuccessFields;
  }): Promise<boolean>;
  fail(params: {
    owner: AiAnalysisRunOwner;
    completedAt: Date;
    errorMessage: string;
    clearProviderResponseId: boolean;
  }): Promise<boolean>;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type AiAnalysisPrismaClient = Pick<PrismaClient, "aiAnalysis">;
type AiAnalysisCompletionPrismaClient = Pick<PrismaClient, "$transaction">;

export type CurrentAnalysisParticipant = {
  id: string;
  displayName: string;
  type: string;
};

export function createPrismaAiAnalysisOperationStore(
  client: AiAnalysisPrismaClient = prisma,
): AiAnalysisOperationStore {
  const select = {
    id: true,
    status: true,
    runToken: true,
    leaseExpiresAt: true,
    providerResponseId: true,
    transcriptId: true,
    transcriptRetranscribeCount: true,
    language: true,
    updatedAt: true,
  } as const;

  return {
    findBySession(sessionId) {
      return client.aiAnalysis.findUnique({
        where: { sessionId },
        select,
      });
    },
    async createClaim(params) {
      try {
        return await client.aiAnalysis.create({
          data: {
            sessionId: params.sessionId,
            transcriptId: params.transcriptId,
            transcriptRetranscribeCount: params.transcriptRetranscribeCount,
            status: AiAnalysisStatus.QUEUED,
            language: params.language,
            runToken: params.runToken,
            leaseExpiresAt: params.leaseExpiresAt,
            providerResponseId: null,
            startedAt: params.now,
            completedAt: null,
            errorMessage: null,
          },
          select,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) return null;
        throw error;
      }
    },
    async tryClaimExisting(params) {
      const claimed = await client.aiAnalysis.updateMany({
        where: {
          id: params.expected.id,
          status: params.expected.status,
          runToken: params.expected.runToken,
          leaseExpiresAt: params.expected.leaseExpiresAt,
          updatedAt: params.expected.updatedAt,
        },
        data: {
          transcriptId: params.transcriptId,
          transcriptRetranscribeCount: params.transcriptRetranscribeCount,
          analysisVersion: { increment: 1 },
          status: AiAnalysisStatus.QUEUED,
          language: params.language,
          runToken: params.runToken,
          leaseExpiresAt: params.leaseExpiresAt,
          providerResponseId: params.providerResponseId,
          startedAt: params.now,
          completedAt: null,
          errorMessage: null,
        },
      });
      return claimed.count === 1;
    },
    async start(owner, now, leaseExpiresAt) {
      const started = await client.aiAnalysis.updateMany({
        where: {
          id: owner.analysisId,
          status: AiAnalysisStatus.QUEUED,
          runToken: owner.runToken,
          leaseExpiresAt: {
            equals: owner.leaseExpiresAt,
            gt: now,
          },
        },
        data: {
          status: AiAnalysisStatus.ANALYZING,
          leaseExpiresAt,
        },
      });
      return started.count === 1;
    },
    async renew(owner, now, leaseExpiresAt) {
      const renewed = await client.aiAnalysis.updateMany({
        where: {
          id: owner.analysisId,
          status: AiAnalysisStatus.ANALYZING,
          runToken: owner.runToken,
          leaseExpiresAt: {
            equals: owner.leaseExpiresAt,
            gt: now,
          },
        },
        data: { leaseExpiresAt },
      });
      return renewed.count === 1;
    },
    async persistProviderResponseId(params) {
      const persisted = await client.aiAnalysis.updateMany({
        where: {
          id: params.owner.analysisId,
          status: AiAnalysisStatus.ANALYZING,
          runToken: params.owner.runToken,
          leaseExpiresAt: {
            equals: params.owner.leaseExpiresAt,
            gt: params.now,
          },
        },
        data: {
          providerResponseId: params.providerResponseId,
        },
      });
      return persisted.count === 1;
    },
    async clearProviderResponseId(params) {
      const cleared = await client.aiAnalysis.updateMany({
        where: {
          id: params.owner.analysisId,
          status: AiAnalysisStatus.ANALYZING,
          runToken: params.owner.runToken,
          leaseExpiresAt: {
            equals: params.owner.leaseExpiresAt,
            gt: params.now,
          },
        },
        data: {
          providerResponseId: null,
        },
      });
      return cleared.count === 1;
    },
    async complete(params) {
      const completed = await client.aiAnalysis.updateMany({
        where: {
          id: params.owner.analysisId,
          status: AiAnalysisStatus.ANALYZING,
          runToken: params.owner.runToken,
        },
        data: {
          status: AiAnalysisStatus.COMPLETED,
          leaseExpiresAt: null,
          model: params.fields.model,
          executiveSummary: params.fields.executiveSummary,
          overallScore: params.fields.overallScore,
          analysisJson: params.fields.analysisJson,
          rawModelOutput: params.fields.rawModelOutput,
          completedAt: params.completedAt,
          providerResponseId: null,
          errorMessage: null,
        },
      });
      return completed.count === 1;
    },
    async fail(params) {
      const failed = await client.aiAnalysis.updateMany({
        where: {
          id: params.owner.analysisId,
          status: AiAnalysisStatus.ANALYZING,
          runToken: params.owner.runToken,
        },
        data: {
          status: AiAnalysisStatus.FAILED,
          leaseExpiresAt: null,
          errorMessage: params.errorMessage,
          completedAt: params.completedAt,
          ...(params.clearProviderResponseId
            ? { providerResponseId: null }
            : {}),
        },
      });
      return failed.count === 1;
    },
  };
}

/**
 * `providerResponseId` is a live-recovery pointer, not an execution history
 * record: it is only meaningful while the recorded background generation can
 * still produce the analysis this row is supposed to hold. A generation is only
 * recoverable for the exact analysis input it was created for, so a claim for a
 * different transcript version or language must start a new generation instead
 * of adopting the recorded one.
 */
export function resolveRecoverableProviderResponseId(params: {
  existing: Pick<
    AiAnalysisOperationRow,
    | "providerResponseId"
    | "transcriptId"
    | "transcriptRetranscribeCount"
    | "language"
  >;
  identity: AiAnalysisInputIdentity;
}): string | null {
  const recorded = params.existing.providerResponseId?.trim();
  if (!recorded) return null;
  const sameInput =
    params.existing.transcriptId === params.identity.transcriptId &&
    params.existing.transcriptRetranscribeCount ===
      params.identity.transcriptRetranscribeCount &&
    params.existing.language === params.identity.language;
  return sameInput ? recorded : null;
}

export function isAiAnalysisRunLeaseActive(
  row: Pick<
    AiAnalysisOperationRow,
    "runToken" | "leaseExpiresAt" | "updatedAt"
  >,
  now = new Date(),
  legacyStaleAfterMs = getAiAnalysisLegacyStaleAfterMs(),
): boolean {
  if (!row.runToken || !row.leaseExpiresAt) {
    return row.updatedAt.getTime() + legacyStaleAfterMs > now.getTime();
  }
  return Boolean(
    row.leaseExpiresAt.getTime() > now.getTime(),
  );
}

export async function claimAiAnalysisRun(params: {
  sessionId: string;
  transcriptId: string;
  transcriptRetranscribeCount: number;
  language: string;
  now?: Date;
  leaseDurationMs?: number;
  legacyStaleAfterMs?: number;
  runToken?: string;
  store?: AiAnalysisOperationStore;
}): Promise<AiAnalysisClaimResult> {
  const store = params.store ?? createPrismaAiAnalysisOperationStore();
  const now = params.now ?? new Date();
  const leaseDurationMs = params.leaseDurationMs ?? getAiAnalysisLeaseDurationMs();
  const legacyStaleAfterMs =
    params.legacyStaleAfterMs ?? getAiAnalysisLegacyStaleAfterMs();
  const runToken = params.runToken ?? randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  for (let raceAttempt = 0; raceAttempt < 4; raceAttempt += 1) {
    const existing = await store.findBySession(params.sessionId);
    if (!existing) {
      const created = await store.createClaim({
        sessionId: params.sessionId,
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        language: params.language,
        runToken,
        now,
        leaseExpiresAt,
      });
      if (created) {
        return {
          state: "claimed",
          owner: {
            analysisId: created.id,
            runToken,
            leaseExpiresAt,
            providerResponseId: created.providerResponseId,
          },
          recoveredStaleRun: false,
        };
      }
      continue;
    }

    const isOwnedQueuedRun =
      existing.status === AiAnalysisStatus.QUEUED && Boolean(existing.runToken);
    if (
      (existing.status === AiAnalysisStatus.ANALYZING || isOwnedQueuedRun) &&
      isAiAnalysisRunLeaseActive(existing, now, legacyStaleAfterMs)
    ) {
      return {
        state: "active",
        analysis: {
          id: existing.id,
          status: existing.status,
          leaseExpiresAt: existing.leaseExpiresAt,
        },
      };
    }

    const providerResponseId = resolveRecoverableProviderResponseId({
      existing,
      identity: {
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        language: params.language,
      },
    });
    const claimed = await store.tryClaimExisting({
      expected: existing,
      transcriptId: params.transcriptId,
      transcriptRetranscribeCount: params.transcriptRetranscribeCount,
      language: params.language,
      runToken,
      now,
      leaseExpiresAt,
      providerResponseId,
    });
    if (claimed) {
      return {
        state: "claimed",
        owner: {
          analysisId: existing.id,
          runToken,
          leaseExpiresAt,
          providerResponseId,
        },
        recoveredStaleRun: existing.status === AiAnalysisStatus.ANALYZING,
      };
    }
  }

  const raced = await store.findBySession(params.sessionId);
  if (!raced) {
    throw new Error("AI_ANALYSIS_CLAIM_RACE_UNRESOLVED");
  }
  return {
    state: "active",
    analysis: {
      id: raced.id,
      status: raced.status,
      leaseExpiresAt: raced.leaseExpiresAt,
    },
  };
}

export async function renewAiAnalysisLease(params: {
  owner: AiAnalysisRunOwner;
  now?: Date;
  leaseDurationMs?: number;
  store?: AiAnalysisOperationStore;
}): Promise<AiAnalysisRunOwner | null> {
  const store = params.store ?? createPrismaAiAnalysisOperationStore();
  const now = params.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (params.leaseDurationMs ?? getAiAnalysisLeaseDurationMs()),
  );
  const renewed = await store.renew(params.owner, now, leaseExpiresAt);
  return renewed ? { ...params.owner, leaseExpiresAt } : null;
}

export async function startAiAnalysisRun(params: {
  owner: AiAnalysisRunOwner;
  now?: Date;
  leaseDurationMs?: number;
  store?: AiAnalysisOperationStore;
}): Promise<AiAnalysisRunOwner | null> {
  const store = params.store ?? createPrismaAiAnalysisOperationStore();
  const now = params.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (params.leaseDurationMs ?? getAiAnalysisLeaseDurationMs()),
  );
  const started = await store.start(params.owner, now, leaseExpiresAt);
  return started ? { ...params.owner, leaseExpiresAt } : null;
}

export async function persistAiAnalysisProviderResponseId(params: {
  owner: AiAnalysisRunOwner;
  providerResponseId: string;
  now?: Date;
  store?: AiAnalysisOperationStore;
}): Promise<AiAnalysisRunOwner | null> {
  const now = params.now ?? new Date();
  const persisted = await (params.store ?? createPrismaAiAnalysisOperationStore())
    .persistProviderResponseId({
      owner: params.owner,
      providerResponseId: params.providerResponseId,
      now,
    });
  return persisted
    ? { ...params.owner, providerResponseId: params.providerResponseId }
    : null;
}

/**
 * Clears an exhausted provider generation id while the owned operation remains
 * ANALYZING. Used before a bounded same-prompt NEW generation so a later
 * reclaim cannot GET-poll the unusable first response.
 */
export async function clearAiAnalysisProviderResponseId(params: {
  owner: AiAnalysisRunOwner;
  now?: Date;
  store?: AiAnalysisOperationStore;
}): Promise<AiAnalysisRunOwner | null> {
  const now = params.now ?? new Date();
  const cleared = await (params.store ?? createPrismaAiAnalysisOperationStore())
    .clearProviderResponseId({
      owner: params.owner,
      now,
    });
  return cleared ? { ...params.owner, providerResponseId: null } : null;
}

export async function completeAiAnalysisRun(params: {
  owner: AiAnalysisRunOwner;
  fields: AiAnalysisSuccessFields;
  completedAt?: Date;
  store?: AiAnalysisOperationStore;
}): Promise<boolean> {
  return (params.store ?? createPrismaAiAnalysisOperationStore()).complete({
    owner: params.owner,
    fields: params.fields,
    completedAt: params.completedAt ?? new Date(),
  });
}

/**
 * Locks the current session roster and persists a terminal analysis result in
 * one short transaction. Provider work stays outside this boundary.
 */
export async function completeAiAnalysisRunWithCurrentParticipants(params: {
  sessionId: string;
  owner: AiAnalysisRunOwner;
  completedAt: Date;
  buildFields: (
    currentParticipants: CurrentAnalysisParticipant[],
  ) => AiAnalysisSuccessFields;
  client?: AiAnalysisCompletionPrismaClient;
}): Promise<boolean> {
  const client = params.client ?? prisma;
  return client.$transaction(async (tx) => {
    // A membership/role update or deletion touching an existing participant
    // serializes before this lock (and is observed) or waits until completion
    // commits. This is the privacy decision's transaction boundary.
    await lockSessionParticipantsForSession(tx, params.sessionId);
    const currentParticipants = await tx.sessionParticipant.findMany({
      where: { sessionId: params.sessionId },
      select: { id: true, displayName: true, type: true },
    });
    const fields = params.buildFields(currentParticipants);
    const completed = await tx.aiAnalysis.updateMany({
      where: {
        id: params.owner.analysisId,
        status: AiAnalysisStatus.ANALYZING,
        runToken: params.owner.runToken,
      },
      data: {
        status: AiAnalysisStatus.COMPLETED,
        leaseExpiresAt: null,
        model: fields.model,
        executiveSummary: fields.executiveSummary,
        overallScore: fields.overallScore,
        analysisJson: fields.analysisJson,
        rawModelOutput: fields.rawModelOutput,
        completedAt: params.completedAt,
        providerResponseId: null,
        errorMessage: null,
      },
    });
    return completed.count === 1;
  });
}

export async function failAiAnalysisRun(params: {
  owner: AiAnalysisRunOwner;
  errorMessage: string;
  /**
   * True when the recorded provider generation can no longer produce a usable
   * result, so a later explicit retry must create a new generation instead of
   * retrieving the exhausted one forever.
   */
  clearProviderResponseId?: boolean;
  completedAt?: Date;
  store?: AiAnalysisOperationStore;
}): Promise<boolean> {
  return (params.store ?? createPrismaAiAnalysisOperationStore()).fail({
    owner: params.owner,
    errorMessage: params.errorMessage,
    clearProviderResponseId: params.clearProviderResponseId ?? false,
    completedAt: params.completedAt ?? new Date(),
  });
}
