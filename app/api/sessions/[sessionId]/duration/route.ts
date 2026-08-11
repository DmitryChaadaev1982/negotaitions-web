import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType, Prisma } from "@/app/generated/prisma/client";
import { canEditSessionDurations } from "@/lib/negotiation-control";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MAX_PREPARATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  MIN_PREPARATION_DURATION_MINUTES,
  minutesToSeconds,
} from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";
import { lockStrictActiveFacilitatorSessionRoomConnectionLease } from "@/lib/session-room-connection-lease";
import {
  buildSessionControlSnapshotWhere,
  createSessionControlToken,
  pickSessionControlSnapshot,
  SESSION_CONTROL_SNAPSHOT_SELECT,
} from "@/lib/session-control-snapshot";

const durationSchema = z
  .object({
    joinToken: z.string().trim().min(1).optional(),
    participantId: z.string().trim().min(1).optional(),
    connectionId: z.string().trim().min(1).max(128),
    expectedNegotiationState: z.enum([
      "PREPARATION",
      "PREPARATION_RUNNING",
      "PREPARATION_PAUSED",
      "READY_TO_START",
      "RUNNING",
      "PAUSED",
      "FINISHED",
    ]),
    expectedControlToken: z.string().trim().min(1).max(256),
    durationMinutes: z.coerce
      .number()
      .int("Duration must be a whole number of minutes")
      .min(
        MIN_NEGOTIATION_DURATION_MINUTES,
        `Duration must be at least ${MIN_NEGOTIATION_DURATION_MINUTES} minute`,
      )
      .max(
        MAX_NEGOTIATION_DURATION_MINUTES,
        `Duration must be at most ${MAX_NEGOTIATION_DURATION_MINUTES} minutes`,
      )
      .optional(),
    preparationDurationMinutes: z.coerce
      .number()
      .int("Preparation duration must be a whole number of minutes")
      .min(
        MIN_PREPARATION_DURATION_MINUTES,
        `Preparation duration must be at least ${MIN_PREPARATION_DURATION_MINUTES} minutes`,
      )
      .max(
        MAX_PREPARATION_DURATION_MINUTES,
        `Preparation duration must be at most ${MAX_PREPARATION_DURATION_MINUTES} minutes`,
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.durationMinutes !== undefined ||
      data.preparationDurationMinutes !== undefined,
    { message: "At least one duration field is required." },
  );

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const DURATION_MUTATION_SELECT = {
  id: true,
  eventId: true,
  ...SESSION_CONTROL_SNAPSHOT_SELECT,
  event: {
    select: {
      status: true,
    },
  },
} as const;

function buildRoomAccessConflict(params: { output: string; redirectTo: string | null }) {
  if (params.output === "DENY_DELETED") {
    return { status: 404, body: { error: "sessionDeleted" } };
  }
  if (params.output === "DENY_UNAUTHORIZED") {
    return { status: 403, body: { error: "Forbidden." } };
  }
  return {
    status: 409,
    body: {
      error: params.output === "EVENT_CLOSED" ? "eventClosed" : "roomClosed",
      code: params.output === "EVENT_CLOSED" ? "EVENT_CLOSED" : "ROOM_CLOSED",
      redirectTo: params.redirectTo,
    },
  };
}

function isSerializableConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }
    if (
      error.code === "P2010" &&
      String(error.meta?.code ?? "") === "40001"
    ) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Code: `40001`") &&
    message.includes("could not serialize access")
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = durationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const {
    durationMinutes,
    preparationDurationMinutes,
    connectionId,
    expectedNegotiationState,
    expectedControlToken,
  } = parsed.data;
  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can update session durations." },
      { status: 403 },
    );
  }

  if (!participant.userId) {
    return NextResponse.json({ error: "staleConnection", code: "STALE_CONNECTION" }, { status: 409 });
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const session = await tx.session.findUniqueOrThrow({
            where: { id: sessionId },
            select: DURATION_MUTATION_SELECT,
          });

          const accessDecision = decideSessionRoomAccess({
            user: {
              isAuthenticated: true,
              isAuthorizedMember: true,
            },
            session: {
              sessionId,
              negotiationState: session.negotiationState,
              roomLifecycle: session.roomLifecycle ?? null,
              deletedAt: session.deletedAt ?? null,
              closeReason: session.closeReason ?? null,
              closedByEventAt: session.closedByEventAt ?? null,
              eventId: session.eventId ?? null,
              eventStatus: session.event?.status ?? null,
            },
            redirect: {
              sessionId,
              participantJoinToken: participant.joinToken,
              eventId: session.eventId ?? null,
              eventStatus: session.event?.status ?? null,
              preferEventResultsForEventOwner: true,
            },
          });
          if (!isRoomAccessAllowed(accessDecision.output)) {
            return {
              kind: "access_conflict" as const,
              ...buildRoomAccessConflict({
                output: accessDecision.output,
                redirectTo: accessDecision.redirectTo,
              }),
            };
          }

          if (participant.userId !== session.facilitatorId) {
            return {
              kind: "forbidden" as const,
              status: 403,
              body: { error: "Only current facilitator can update session durations." },
            };
          }

          const leaseIsAuthoritative =
            await lockStrictActiveFacilitatorSessionRoomConnectionLease(tx, {
              sessionId,
              userId: participant.userId,
              participantId: participant.id,
              connectionId,
            });
          if (!leaseIsAuthoritative) {
            return {
              kind: "stale_connection" as const,
              status: 409,
              body: { error: "staleConnection", code: "STALE_CONNECTION" },
            };
          }

          const snapshot = pickSessionControlSnapshot(session);
          const currentToken = createSessionControlToken(snapshot);
          if (
            session.negotiationState !== expectedNegotiationState ||
            currentToken !== expectedControlToken
          ) {
            return {
              kind: "conflict" as const,
              status: 409,
              body: {
                error: "staleControlSnapshot",
                code: "CONTROL_CONFLICT",
                negotiationState: session.negotiationState,
                controlToken: currentToken,
              },
            };
          }

          if (!canEditSessionDurations(session.negotiationState)) {
            return {
              kind: "invalid_state" as const,
              status: 400,
              body: { error: "Durations can only be updated before preparation starts." },
            };
          }

          const updated = await tx.session.updateMany({
            where: buildSessionControlSnapshotWhere(sessionId, snapshot),
            data: {
              ...(durationMinutes !== undefined
                ? { durationSeconds: minutesToSeconds(durationMinutes) }
                : {}),
              ...(preparationDurationMinutes !== undefined
                ? {
                    preparationDurationSeconds: minutesToSeconds(
                      preparationDurationMinutes,
                    ),
                  }
                : {}),
            },
          });

          if (updated.count === 0) {
            const current = await tx.session.findUniqueOrThrow({
              where: { id: sessionId },
              select: DURATION_MUTATION_SELECT,
            });
            return {
              kind: "conflict" as const,
              status: 409,
              body: {
                error: "staleControlSnapshot",
                code: "CONTROL_CONFLICT",
                negotiationState: current.negotiationState,
                controlToken: createSessionControlToken(
                  pickSessionControlSnapshot(current),
                ),
              },
            };
          }

          const current = await tx.session.findUniqueOrThrow({
            where: { id: sessionId },
            select: DURATION_MUTATION_SELECT,
          });
          return {
            kind: "ok" as const,
            session: current,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (result.kind !== "ok") {
        return NextResponse.json(result.body, { status: result.status });
      }

      const controlToken = createSessionControlToken(
        pickSessionControlSnapshot(result.session),
      );
      return NextResponse.json({
        sessionId: result.session.id,
        durationSeconds: result.session.durationSeconds,
        preparationDurationSeconds: result.session.preparationDurationSeconds,
        durationMinutes:
          durationMinutes ?? Math.round(result.session.durationSeconds / 60),
        preparationDurationMinutes:
          preparationDurationMinutes ??
          Math.round(result.session.preparationDurationSeconds / 60),
        negotiationState: result.session.negotiationState,
        controlToken,
      });
    } catch (error) {
      if (isSerializableConflict(error) && attempt === 0) {
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json(
    { error: "Unable to update session durations." },
    { status: 400 },
  );
}
