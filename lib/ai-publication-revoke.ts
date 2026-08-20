import { Prisma } from "@/app/generated/prisma/client";

/**
 * Canonical publication revoke used by Unshare and material-input rewind.
 * Callers must already hold the AiAnalysis row lock in a serializable
 * transaction. This is not a second publication system.
 */
export async function revokeActiveAiAnalysisPublicationInTransaction(
  tx: Prisma.TransactionClient,
  sessionId: string,
  unsharedAt = new Date(),
): Promise<{ revoked: boolean; analysisId: string | null }> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "AiAnalysis"
    WHERE "sessionId" = ${sessionId}
    FOR UPDATE
  `);
  if (!locked[0]) {
    return { revoked: false, analysisId: null };
  }

  const aiAnalysisId = locked[0].id;
  const grantResult = await tx.aiAnalysisPublicationGrant.updateMany({
    where: {
      revokedAt: null,
      publication: {
        aiAnalysisId,
        revokedAt: null,
      },
    },
    data: { revokedAt: unsharedAt },
  });
  const publicationResult = await tx.aiAnalysisPublication.updateMany({
    where: { aiAnalysisId, revokedAt: null },
    data: { revokedAt: unsharedAt },
  });

  await tx.aiAnalysis.update({
    where: { id: aiAnalysisId },
    data: {
      visibility: "FACILITATOR_ONLY",
      sharedAnalysisJson: Prisma.JsonNull,
      sharedExecutiveSummary: null,
      sharedAt: null,
      sharedBy: null,
      unsharedAt,
    },
  });

  return {
    revoked: grantResult.count > 0 || publicationResult.count > 0,
    analysisId: aiAnalysisId,
  };
}
