import type { AuthUser } from "@/lib/auth";
import { canAccessSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export async function resolveJoinTokenForAccountSession(
  sessionId: string,
  user: AuthUser,
): Promise<string | null> {
  const access = await getCurrentUserSessionAccess(sessionId, user, {});
  if (!access || !canAccessSession(access)) {
    return null;
  }

  if (access.userParticipant?.joinToken) {
    return access.userParticipant.joinToken;
  }

  if (access.tokenParticipant?.joinToken) {
    return access.tokenParticipant.joinToken;
  }

  if (access.isAdmin || access.isEventHostOwner) {
    const facilitator = await prisma.sessionParticipant.findFirst({
      where: {
        sessionId,
        type: "FACILITATOR",
      },
      select: { joinToken: true },
      orderBy: { createdAt: "asc" },
    });
    if (facilitator?.joinToken) {
      return facilitator.joinToken;
    }
  }

  return null;
}
