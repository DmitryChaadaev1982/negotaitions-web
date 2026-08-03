import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { isEventDeletedOrCancelled, resolveEventAccess } from "@/lib/event-auth";
import { ensureUserEventParticipant } from "@/lib/ensure-event-participant";
import { resolveLobbyMediaControlPermission } from "@/lib/event-lobby-media-control-permission";
import { buildEventState } from "@/lib/event-state";
import {
  acknowledgeEventMediaControlCommand,
  createEventMediaControlCommand,
} from "@/lib/voximplant/event-media-control-store";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const requestSchema = z.object({
  hostToken: z.string().trim().min(1).optional(),
  participantToken: z.string().trim().min(1).optional(),
  targetParticipantId: z.string().trim().min(1).optional(),
  device: z.enum(["mic", "camera"]).optional(),
  action: z.enum(["disable", "enable_request"]).optional(),
  commandId: z.string().trim().min(1).optional(),
  status: z.enum(["applied", "accepted", "declined", "expired", "failed"]).optional(),
  resultMessage: z.string().trim().max(500).optional(),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues[0]?.message ?? "invalidPayload" },
      { status: 400 },
    );
  }

  const user = await getOptionalCurrentUser();
  const access = await resolveEventAccess(
    eventId,
    {
      hostToken: body.data.hostToken,
      participantToken: body.data.participantToken,
    },
    user,
  );
  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }
  if (isEventDeletedOrCancelled(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  let currentParticipant = access.currentParticipant;
  if (!currentParticipant && user && (isAdmin(user) || user.status === "ACTIVE")) {
    currentParticipant = await ensureUserEventParticipant(eventId, user);
  }
  if (!currentParticipant) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (body.data.commandId && body.data.status) {
    const command = await acknowledgeEventMediaControlCommand({
      eventId,
      commandId: body.data.commandId,
      targetParticipantId: currentParticipant.id,
      status: body.data.status,
      resultMessage: body.data.resultMessage ?? null,
    });
    if (!command) {
      return NextResponse.json({ error: "commandNotFound" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, command });
  }

  if (!body.data.targetParticipantId || !body.data.device || !body.data.action) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }
  if (!access.isEventOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (body.data.targetParticipantId === currentParticipant.id) {
    return NextResponse.json({ error: "selfControlUsesLocalMedia" }, { status: 400 });
  }

  const state = await buildEventState({
    event: access.event,
    isHost: access.isHost,
    isEventOwner: access.isEventOwner,
    isAdmin: access.isAdmin,
    currentParticipant,
    accountMode: Boolean(user),
    canJoinEventSessionsAsObserver: true,
    userId: user?.id ?? null,
  });
  const target = state.participants.find(
    (participant) => participant.id === body.data.targetParticipantId,
  );
  if (!target) {
    return NextResponse.json({ error: "targetNotInEvent" }, { status: 404 });
  }
  const permission = resolveLobbyMediaControlPermission({
    actor: {
      participantId: currentParticipant.id,
      isEventOwner: access.isEventOwner,
    },
    target: {
      participantId: target.id,
    },
    targetPresence: {
      state: target.eventPresenceStatus,
    },
    device: body.data.device,
  });
  if (!permission.allowed || permission.controlKind !== "remote") {
    const isSelfControl = permission.allowed && permission.controlKind === "self";
    const reason = permission.allowed ? null : permission.reason;
    return NextResponse.json(
      {
        error:
          isSelfControl
            ? "selfControlUsesLocalMedia"
            : reason === "ACTOR_NOT_AUTHORIZED"
              ? "Forbidden."
              : "targetNotInLobby",
        code:
          reason && reason !== "ACTOR_NOT_AUTHORIZED"
            ? reason
            : undefined,
      },
      {
        status: isSelfControl
          ? 400
          : reason === "ACTOR_NOT_AUTHORIZED"
            ? 403
            : 409,
      },
    );
  }

  const command = await createEventMediaControlCommand({
    eventId,
    targetParticipantId: target.id,
    requestedByParticipantId: currentParticipant.id,
    requestedByUserId: user?.id ?? null,
    requestedByDisplayName: currentParticipant.displayName,
    device: body.data.device,
    action: body.data.action,
  });

  return NextResponse.json({ ok: true, command });
}
