/**
 * Authenticated lobby identity must be resolved by eventId + currentUser.id.
 * Never fall back to host/first participant.
 *
 * This helper finds an existing EventParticipant for the authenticated user,
 * or creates one inside a serializable transaction to prevent duplicates.
 * It is called by lobby API routes when the user has event access but no
 * participant row yet (e.g. an admin or facilitator opening a lobby directly).
 */

import { Prisma } from "@/app/generated/prisma/client";
import type { EventParticipant } from "@/app/generated/prisma/client";

import type { AuthUser } from "@/lib/auth";
import { generateParticipantToken } from "@/lib/event-tokens";
import { prisma } from "@/lib/prisma";

export async function ensureUserEventParticipant(
  eventId: string,
  user: AuthUser,
): Promise<EventParticipant> {
  // Quick read before entering a transaction.
  const existing = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user.id },
  });
  if (existing) return existing;

  const displayName = user.name?.trim() || user.email.split("@")[0] || "User";
  const newToken = generateParticipantToken();

  // Retry once on serializable-conflict (P2034) to handle concurrent creates.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Re-check inside the transaction to prevent duplicate rows.
          const existingInTx = await tx.eventParticipant.findFirst({
            where: { eventId, userId: user.id },
          });
          if (existingInTx) return existingInTx;

          return tx.eventParticipant.create({
            data: {
              eventId,
              userId: user.id,
              displayName,
              email: user.email,
              participantToken: newToken,
              isHost: false,
              joinedAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt === 0
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("ensureUserEventParticipant: failed after retries");
}
