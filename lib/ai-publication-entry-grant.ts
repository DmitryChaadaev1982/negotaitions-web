import "server-only";

import {
  ParticipantType,
  Prisma,
} from "@/app/generated/prisma/client";
import {
  historicalSessionRoomEntryWhere,
  selectPublicationRecipients,
} from "@/lib/ai-publication";
import { retryAiPublicationTransaction } from "@/lib/ai-publication-transaction";
import { prisma } from "@/lib/prisma";

/**
 * After canonical room entry, upsert a current-epoch grant when an unrevoked
 * publication exists. This restores historical-entry eligibility (the old
 * session-wide share accidentally provided for anyone who had been in the
 * session) without returning to that flag: Observer delivery still requires
 * a durable grant with OBSERVER projection. Unshare leaves no active
 * publication, so entry cannot resurrect access. Reconnects upsert the same
 * (publication, membership) key.
 */
export async function materializeActivePublicationGrantForRoomEntrant(params: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  await retryAiPublicationTransaction(() =>
    prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM "AiAnalysis"
          WHERE "sessionId" = ${params.sessionId}
          FOR UPDATE
        `);
        if (!locked[0]) {
          return;
        }

        const activePublication = await tx.aiAnalysisPublication.findFirst({
          where: { aiAnalysisId: locked[0].id, revokedAt: null },
          orderBy: { publicationEpoch: "desc" },
          select: { id: true },
        });
        if (!activePublication) {
          return;
        }

        const entered = await tx.sessionRoomConnection.findFirst({
          where: historicalSessionRoomEntryWhere({
            sessionId: params.sessionId,
            userId: params.userId,
          }),
          select: { userId: true },
        });
        if (!entered) {
          return;
        }

        const candidates = await tx.sessionParticipant.findMany({
          where: {
            sessionId: params.sessionId,
            userId: params.userId,
            type: { in: [ParticipantType.PARTICIPANT, ParticipantType.OBSERVER] },
          },
          select: { id: true, userId: true, type: true },
        });
        const recipients = selectPublicationRecipients([entered], candidates);
        const grantedAt = new Date();
        for (const recipient of recipients) {
          await tx.aiAnalysisPublicationGrant.upsert({
            where: {
              publicationId_sessionParticipantId: {
                publicationId: activePublication.id,
                sessionParticipantId: recipient.sessionParticipantId,
              },
            },
            create: {
              publicationId: activePublication.id,
              sessionParticipantId: recipient.sessionParticipantId,
              userId: recipient.userId,
              projection: recipient.projection,
              grantedAt,
            },
            update: {},
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function materializeActivePublicationGrantForRoomEntrantSafe(params: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  try {
    await materializeActivePublicationGrantForRoomEntrant(params);
  } catch (error) {
    console.error(
      JSON.stringify({
        area: "ai_publication",
        event: "entry_grant_materialize_failed",
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
