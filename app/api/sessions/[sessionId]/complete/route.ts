import { NextResponse } from "next/server";
import { z } from "zod";

import {
  canAccessSession,
  canManageSession,
  getCurrentUserSessionAccess,
} from "@/lib/access-control";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { completeSessionCanonical } from "@/lib/session-completion";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const completeSessionSchema = z
  .object({
    expectedOperationId: z.string().trim().min(1).max(256).optional(),
    hostToken: z.string().trim().min(1).optional(),
    closeDebriefForAll: z.boolean().optional(),
  })
  .optional();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let parsedBody: z.infer<typeof completeSessionSchema>;
  try {
    const body = (await request.json()) as unknown;
    const parsed = completeSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
        { status: 400 },
      );
    }
    parsedBody = parsed.data;
  } catch {
    parsedBody = undefined;
  }

  const user = await getOptionalCurrentUser();
  const hasActiveAccount =
    user && (isAdmin(user) || user.status === "ACTIVE");

  let authorized = false;
  if (hasActiveAccount && user) {
    const access = await getCurrentUserSessionAccess(sessionId, user, {});
    if (!access || !canAccessSession(access) || access.session.deletedAt) {
      // Keep non-member and missing-session outcomes stable.
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (!canManageSession(access)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    authorized = true;
  } else if (parsedBody?.hostToken) {
    const hostToken = parsedBody.hostToken.trim();
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        deletedAt: null,
        event: {
          hostToken,
        },
      },
      select: { id: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    authorized = true;
  } else {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!authorized) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const result = await completeSessionCanonical({
      sessionId,
      mode: "ADMINISTRATIVE_SESSION_FINISH",
      reason:
        parsedBody?.expectedOperationId?.trim() ?? "ADMINISTRATIVE_SESSION_FINISH",
      hardClose: parsedBody?.closeDebriefForAll === true,
    });

    return NextResponse.json({
      completed: !result.alreadyFinished,
      alreadyCompleted: result.alreadyFinished,
      operationId: result.operationId,
      negotiationState: result.negotiationState,
      roomLifecycle: result.roomLifecycle,
      closeReason: result.closeReason,
      closedByEventAt: result.closedByEventAt,
      recording: {
        status: result.recording.status,
        stopOperationId: result.recording.stopOperationId,
        stopOperationState: result.recording.stopOperationState,
        warning: result.recording.warning,
      },
      warnings: result.recording.warning ? [result.recording.warning] : [],
      refreshHint: "refresh",
      redirectTo: `/sessions/${sessionId}/materials`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete session.";
    if (message === "Session is deleted.") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
