import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { getOptionalCurrentUser } from "./session";
import { isAdmin } from "./admin";

/**
 * Use inside API route handlers to require an active authenticated user.
 * Returns the user or a 401 NextResponse. Callers must check the return type.
 */
export async function apiRequireActiveUser() {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  if (!isAdmin(user) && user.status !== "ACTIVE") {
    return {
      user: null,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }
  return { user, response: null };
}

/**
 * Session-scoped API guard.
 *
 * Allows access when:
 *   1. The request carries a joinToken that belongs to the given sessionId, OR
 *   2. The authenticated user is an admin.
 *
 * Used for presence, display-status, and facilitator notes routes that must
 * not be readable by any generic active user until SessionParticipant.userId
 * binding is implemented (Phase C).
 *
 * Returns the validated participant info or an error response.
 */
export async function apiRequireSessionJoinTokenOrAdmin(
  sessionId: string,
  joinToken: string | null,
): Promise<
  | { ok: true; isAdminAccess: true; participantId: null; participantType: null }
  | { ok: true; isAdminAccess: false; participantId: string; participantType: string }
  | { ok: false; response: NextResponse }
> {
  const user = await getOptionalCurrentUser();

  if (user && isAdmin(user)) {
    return { ok: true, isAdminAccess: true, participantId: null, participantType: null };
  }

  if (!joinToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    select: { id: true, sessionId: true, type: true },
  });

  if (!participant || participant.sessionId !== sessionId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true,
    isAdminAccess: false,
    participantId: participant.id,
    participantType: participant.type,
  };
}

/**
 * Use inside API route handlers to require admin access.
 * Returns the user or a 401/403 NextResponse.
 */
export async function apiRequireAdminUser() {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  if (!isAdmin(user)) {
    return {
      user: null,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }
  return { user, response: null };
}
