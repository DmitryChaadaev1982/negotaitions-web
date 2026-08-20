import {
  AiAnalysisStatus,
  Prisma,
} from "@/app/generated/prisma/client";
import { revokeActiveAiAnalysisPublicationInTransaction } from "@/lib/ai-publication-revoke";
import {
  decideLegacyNullFingerprintBindOnMaterialChange,
  evaluateAiAnalysisCurrentness,
} from "@/lib/ai/analysis-currentness";
import { isAiAnalysisRunLeaseActive } from "@/lib/ai/analysis-operation";
import { computeCurrentMaterialInputFingerprint } from "@/lib/ai/session-analysis-context";
import { prisma } from "@/lib/prisma";

export const MATERIAL_CHANGE_CONFIRMATION_REQUIRED =
  "MATERIAL_CHANGE_CONFIRMATION_REQUIRED" as const;
export const MATERIAL_CHANGE_AI_RUNNING = "MATERIAL_CHANGE_AI_RUNNING" as const;

export const MATERIAL_CHANGE_CONFIRMATION_MESSAGE =
  "Changing this session data will invalidate the current AI analysis and require a new analysis. If the analysis is published, that publication will be revoked and recipients will lose access.";

export const MATERIAL_CHANGE_AI_ONLY_CONFIRMATION_MESSAGE =
  "Changing this session data will invalidate the current AI analysis and require a new analysis.";

export const MATERIAL_CHANGE_AI_RUNNING_MESSAGE =
  "Material negotiation-AI inputs cannot be changed while AI analysis is running.";

export type MaterialChangeGuardDecision =
  | { allow: true; revokePublication: boolean }
  | {
      allow: false;
      errorCode:
        | typeof MATERIAL_CHANGE_CONFIRMATION_REQUIRED
        | typeof MATERIAL_CHANGE_AI_RUNNING;
      error: string;
      willRevokePublication?: boolean;
    };

export function hasCurrentMaterialDependentAiResult(input: {
  analysisCurrent: boolean;
  aiStatus: string | null | undefined;
}): boolean {
  return input.analysisCurrent && input.aiStatus === AiAnalysisStatus.COMPLETED;
}

export function decideFacilitatorMaterialChangeGuard(input: {
  aiStatus: string | null | undefined;
  runLeaseActive: boolean;
  analysisCurrent: boolean;
  hasActivePublication: boolean;
  confirmRewindPublication: boolean;
}): MaterialChangeGuardDecision {
  if (
    (input.aiStatus === AiAnalysisStatus.QUEUED ||
      input.aiStatus === AiAnalysisStatus.ANALYZING) &&
    input.runLeaseActive
  ) {
    return {
      allow: false,
      errorCode: MATERIAL_CHANGE_AI_RUNNING,
      error: MATERIAL_CHANGE_AI_RUNNING_MESSAGE,
    };
  }

  const hasCurrentCompletedAnalysis = hasCurrentMaterialDependentAiResult({
    analysisCurrent: input.analysisCurrent,
    aiStatus: input.aiStatus,
  });
  if (hasCurrentCompletedAnalysis && !input.confirmRewindPublication) {
    return {
      allow: false,
      errorCode: MATERIAL_CHANGE_CONFIRMATION_REQUIRED,
      error: input.hasActivePublication
        ? MATERIAL_CHANGE_CONFIRMATION_MESSAGE
        : MATERIAL_CHANGE_AI_ONLY_CONFIRMATION_MESSAGE,
      willRevokePublication: input.hasActivePublication,
    };
  }

  return {
    allow: true,
    revokePublication:
      hasCurrentCompletedAnalysis &&
      input.hasActivePublication &&
      input.confirmRewindPublication,
  };
}

export type FacilitatorMaterialChangeResult<T> =
  | { ok: true; result: T; publicationRevoked: boolean }
  | {
      ok: false;
      status: 409;
      errorCode:
        | typeof MATERIAL_CHANGE_CONFIRMATION_REQUIRED
        | typeof MATERIAL_CHANGE_AI_RUNNING;
      error: string;
      willRevokePublication?: boolean;
    };

export function materialChangeGuardErrorBody(
  change: Extract<FacilitatorMaterialChangeResult<unknown>, { ok: false }>,
): {
  error: string;
  errorCode:
    | typeof MATERIAL_CHANGE_CONFIRMATION_REQUIRED
    | typeof MATERIAL_CHANGE_AI_RUNNING;
  willRevokePublication?: boolean;
} {
  if (change.errorCode === MATERIAL_CHANGE_CONFIRMATION_REQUIRED) {
    return {
      error: change.error,
      errorCode: change.errorCode,
      willRevokePublication: Boolean(change.willRevokePublication),
    };
  }
  return {
    error: change.error,
    errorCode: change.errorCode,
  };
}

/**
 * Central facilitator-controlled material-edit boundary.
 *
 * 1. Block material writes while AI is QUEUED/ANALYZING with a live lease.
 * 2. If a CURRENT completed analysis exists for the active generation,
 *    require explicit confirmation. Historical/non-current rows, including a
 *    leftover publication on an already-invalidated generation, do not warn.
 * 3. On confirmed save of a current published analysis, revoke via the
 *    existing publication mechanism.
 * 4. If the historical row is still legacy-current with a NULL fingerprint,
 *    bind it to the pre-mutation envelope hash. That is a PT-22 compatibility
 *    baseline (the last snapshot already treated as current), not proven
 *    historical model-input identity. Do not bulk-backfill untouched rows.
 * 5. Persist the caller mutation. The historical AiAnalysis row is kept;
 *    currentness is recomputed from the new material envelope on read.
 */
export async function applyFacilitatorMaterialInputChange<T>(params: {
  sessionId: string;
  confirmRewindPublication?: boolean;
  mutate: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<FacilitatorMaterialChangeResult<T>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const analysis = await tx.aiAnalysis.findUnique({
          where: { sessionId: params.sessionId },
          select: {
            id: true,
            status: true,
            runToken: true,
            leaseExpiresAt: true,
            updatedAt: true,
            inputFingerprint: true,
            transcriptId: true,
            transcriptRetranscribeCount: true,
            publications: {
              where: { revokedAt: null },
              select: { id: true },
              take: 1,
            },
          },
        });

        const transcript = await tx.transcript.findUnique({
          where: { sessionId: params.sessionId },
          select: { id: true, retranscribeCount: true },
        });
        const currentFingerprint = analysis
          ? await computeCurrentMaterialInputFingerprint(params.sessionId)
          : null;
        const currentness = evaluateAiAnalysisCurrentness({
          analysis,
          currentFingerprint,
          transcriptId: transcript?.id,
          transcriptRetranscribeCount: transcript?.retranscribeCount,
        });

        const decision = decideFacilitatorMaterialChangeGuard({
          aiStatus: analysis?.status ?? null,
          runLeaseActive: Boolean(
            analysis && isAiAnalysisRunLeaseActive(analysis),
          ),
          analysisCurrent: currentness.current,
          hasActivePublication: Boolean(analysis?.publications[0]),
          confirmRewindPublication: Boolean(params.confirmRewindPublication),
        });
        if (!decision.allow) {
          return {
            ok: false as const,
            status: 409 as const,
            errorCode: decision.errorCode,
            error: decision.error,
            willRevokePublication: decision.willRevokePublication,
          };
        }

        if (analysis && !(analysis.inputFingerprint?.trim())) {
          const preMutationFingerprint = currentFingerprint;
          const bindFingerprint = decideLegacyNullFingerprintBindOnMaterialChange(
            {
              analysis,
              preMutationFingerprint,
              transcriptId: transcript?.id,
              transcriptRetranscribeCount: transcript?.retranscribeCount,
            },
          );
          if (bindFingerprint) {
            await tx.aiAnalysis.update({
              where: { id: analysis.id },
              data: { inputFingerprint: bindFingerprint },
            });
          }
        }

        let publicationRevoked = false;
        if (decision.revokePublication) {
          const revoked = await revokeActiveAiAnalysisPublicationInTransaction(
            tx,
            params.sessionId,
          );
          publicationRevoked = revoked.revoked;
        }

        const result = await params.mutate(tx);
        return { ok: true as const, result, publicationRevoked };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return {
        ok: false,
        status: 409,
        errorCode: MATERIAL_CHANGE_CONFIRMATION_REQUIRED,
        error: "AI analysis publication is busy. Please retry.",
      };
    }
    throw error;
  }
}

/**
 * Test/system path for material mutations that cannot go through facilitator
 * UI (for example post-negotiation participant preparation notes). Revokes
 * an active publication through the canonical mechanism. Does not delete
 * the historical AiAnalysis row.
 */
export async function applyControlledMaterialInvalidation(
  sessionId: string,
): Promise<{ publicationRevoked: boolean }> {
  return prisma.$transaction(
    async (tx) => {
      const revoked = await revokeActiveAiAnalysisPublicationInTransaction(
        tx,
        sessionId,
      );
      return { publicationRevoked: revoked.revoked };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
