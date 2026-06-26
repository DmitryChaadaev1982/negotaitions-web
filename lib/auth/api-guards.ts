import { NextResponse } from "next/server";

import {
  canAccessSession,
  canManageSession,
  getCurrentUserSessionAccess,
} from "@/lib/access-control";

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
  participantId: string | null = null,
): Promise<
  | {
      ok: true;
      isAdminAccess: boolean;
      isEventHostOwner: boolean;
      canManageSession: boolean;
      participantId: string | null;
      participantType: string | null;
    }
  | { ok: false; response: NextResponse }
> {
  const user = await getOptionalCurrentUser();
  const access = await getCurrentUserSessionAccess(sessionId, user, {
    joinToken,
  });
  const accountParticipant =
    participantId && user
      ? await import("@/lib/room-participant-resolver").then(({ resolveRoomParticipantFromParsedBody }) =>
          resolveRoomParticipantFromParsedBody({ participantId }, sessionId),
        )
      : null;
  if (!accountParticipant && (!access || !canAccessSession(access))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: user ? "Forbidden." : "Unauthorized." },
        { status: user ? 403 : 401 },
      ),
    };
  }

  const participant = accountParticipant ?? access?.tokenParticipant ?? access?.userParticipant;

  return {
    ok: true,
    isAdminAccess: access?.isAdmin ?? false,
    isEventHostOwner: access?.isEventHostOwner ?? false,
    canManageSession: access ? canManageSession(access) : participant?.type === "FACILITATOR",
    participantId: participant?.id ?? null,
    participantType: participant?.type ?? null,
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
