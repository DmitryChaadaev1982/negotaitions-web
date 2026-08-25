import { NextResponse } from "next/server";
import { z } from "zod";

import {
  type NegotiationState,
  ParticipantType,
  Prisma,
  RoomLifecycle,
} from "@/app/generated/prisma/client";
import { handleNegotiationStartRecording } from "@/lib/livekit-egress";
import {
  type ControlAction,
  getControlUpdateData,
  SESSION_CONTROL_SELECT,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  isSessionClosedByOrganizer,
  SESSION_CLOSE_SELECT,
} from "@/lib/session-close-state";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { shouldRunLivekitRecordingLifecycle } from "@/lib/session-control-recording-policy";
import { completeSessionCanonical } from "@/lib/session-completion";
import { lockStrictActiveFacilitatorSessionRoomConnectionLease } from "@/lib/session-room-connection-lease";
import {
  reconcileSessionControlAutoTransitions,
} from "@/lib/session-control-auto-transitions";
import {
  buildControlStateResponse,
} from "@/lib/session-control-response";
import {
  buildSessionControlSnapshotWhere,
  createSessionControlToken,
  pickSessionControlSnapshot,
  SESSION_CONTROL_SNAPSHOT_SELECT,
} from "@/lib/session-control-snapshot";
import { evaluateStandaloneStartPreparationGuard } from "@/lib/standalone-preparation-role-readiness";

const controlActionSchema = z.object({
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
  action: z.enum([
    "START_PREPARATION",
    "PAUSE_PREPARATION",
    "RESUME_PREPARATION",
    "STOP_PREPARATION",
    "START",
    "PAUSE",
    "RESUME",
    "FINISH",
  ]),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type SessionMutationRow = Prisma.SessionGetPayload<{
  select: typeof SESSION_MUTATION_SELECT;
}>;

type AccessConflictPayload = {
  status: number;
  body: Record<string, unknown>;
};

const SESSION_MUTATION_SELECT = {
  ...SESSION_CONTROL_SELECT,
  ...SESSION_CONTROL_SNAPSHOT_SELECT,
  ...SESSION_CLOSE_SELECT,
  eventId: true,
  event: {
    select: {
      status: true,
    },
  },
} as const;

export const runtime = "nodejs";

function shortConnectionId(connectionId: string | null | undefined) {
  if (!connectionId) return null;
  if (connectionId.length <= 12) return connectionId;
  return connectionId.slice(-12);
}

function logStage310SessionControl(
  event: string,
  payload: Record<string, unknown>,
) {
  console.info(
    JSON.stringify({
      area: "stage310_session_control",
      event,
      ...payload,
    }),
  );
}

function buildAccessConflictResponse(conflict: AccessConflictPayload) {
  return NextResponse.json(conflict.body, { status: conflict.status });
}

function buildRoomAccessConflict(params: {
  output: string;
  redirectTo: string | null;
}): AccessConflictPayload {
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

async function loadRecordingState(sessionId: string) {
  return prisma.recording.findUnique({
    where: { sessionId },
    select: {
      status: true,
      recordingAttemptId: true,
      errorMessage: true,
      provider: true,
    },
  });
}

function buildControlConflictPayload(
  session: SessionMutationRow,
  participantType: ParticipantType,
  now: Date,
) {
  return {
    ...buildControlStateResponse(session, participantType, now),
    error: "staleControlSnapshot",
    code: "CONTROL_CONFLICT",
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

function isIdempotentNoopAction(
  action: ControlAction,
  state: NegotiationState,
) {
  switch (action) {
    case "START_PREPARATION":
      return state === "PREPARATION_RUNNING";
    case "PAUSE_PREPARATION":
      return state === "PREPARATION_PAUSED";
    case "RESUME_PREPARATION":
      return state === "PREPARATION_RUNNING";
    case "STOP_PREPARATION":
      return state === "READY_TO_START";
    case "START":
      return state === "RUNNING";
    case "PAUSE":
      return state === "PAUSED";
    case "RESUME":
      return state === "RUNNING";
    case "FINISH":
      return state === "FINISHED";
    default:
      return false;
  }
}

async function runInteractiveMutation(params: {
  sessionId: string;
  action: ControlAction;
  expectedNegotiationState: NegotiationState;
  expectedControlToken: string;
  connectionId: string;
  participant: Awaited<ReturnType<typeof resolveRoomParticipantFromBody>>;
  now: Date;
}) {
  const {
    sessionId,
    action,
    expectedNegotiationState,
    expectedControlToken,
    connectionId,
    participant,
    now,
  } = params;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const session = await tx.session.findUniqueOrThrow({
            where: { id: sessionId },
            select: SESSION_MUTATION_SELECT,
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
              participantJoinToken: participant?.joinToken ?? null,
              eventId: session.eventId ?? null,
              eventStatus: session.event?.status ?? null,
              preferEventResultsForEventOwner:
                participant?.type === ParticipantType.FACILITATOR,
            },
          });

          if (!isRoomAccessAllowed(accessDecision.output)) {
            return {
              kind: "access_conflict" as const,
              conflict: buildRoomAccessConflict({
                output: accessDecision.output,
                redirectTo: accessDecision.redirectTo,
              }),
            };
          }

          if (participant?.type !== ParticipantType.FACILITATOR) {
            return {
              kind: "forbidden" as const,
              body: { error: "Only facilitators can control negotiation state." },
            };
          }

          if (!participant.userId || participant.userId !== session.facilitatorId) {
            return {
              kind: "forbidden" as const,
              body: { error: "Only current facilitator can control negotiation state." },
            };
          }

          if (isSessionClosedByOrganizer(session)) {
            return {
              kind: "access_conflict" as const,
              conflict: {
                status: 409,
                body: { error: "sessionClosedByEvent" },
              },
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
              body: {
                error: "staleConnection",
                code: "STALE_CONNECTION",
              },
            };
          }

          const snapshot = pickSessionControlSnapshot(session);
          const token = createSessionControlToken(snapshot);
          if (
            session.negotiationState !== expectedNegotiationState ||
            token !== expectedControlToken
          ) {
            return {
              kind: "control_conflict" as const,
              session,
            };
          }

          if (isIdempotentNoopAction(action, session.negotiationState)) {
            return {
              kind: "noop" as const,
              session,
            };
          }

          if (action === "START_PREPARATION" && session.eventId == null) {
            const [roles, participants] = await Promise.all([
              tx.sessionRole.findMany({
                where: { sessionId },
                select: { id: true, name: true },
              }),
              tx.sessionParticipant.findMany({
                where: { sessionId },
                select: { type: true, sessionRoleId: true },
              }),
            ]);
            const roleGuard = evaluateStandaloneStartPreparationGuard({
              eventId: session.eventId,
              roles,
              participants,
            });
            if (!roleGuard.ok) {
              return {
                kind: "roles_not_ready" as const,
                status: roleGuard.status,
                body: roleGuard.body,
              };
            }
          }

          const updateData = {
            ...getControlUpdateData(session, action, now),
            ...(action === "FINISH" && session.roomLifecycle == null
              ? { roomLifecycle: RoomLifecycle.OPEN }
              : {}),
          };
          const updated = await tx.session.updateMany({
            where: buildSessionControlSnapshotWhere(sessionId, snapshot),
            data: updateData,
          });

          if (updated.count === 0) {
            const current = await tx.session.findUniqueOrThrow({
              where: { id: sessionId },
              select: SESSION_MUTATION_SELECT,
            });
            return {
              kind: "control_conflict" as const,
              session: current,
            };
          }

          if (action === "PAUSE") {
            const existingOpenInterval =
              await tx.sessionPauseInterval.findFirst({
                where: {
                  sessionId,
                  endedAt: null,
                },
                orderBy: {
                  startedAt: "desc",
                },
                select: {
                  id: true,
                },
              });
            if (!existingOpenInterval) {
              await tx.sessionPauseInterval.create({
                data: {
                  sessionId,
                  startedAt: now,
                },
              });
            }
          } else if (action === "RESUME" || action === "FINISH") {
            await tx.sessionPauseInterval.updateMany({
              where: {
                sessionId,
                endedAt: null,
              },
              data: {
                endedAt: now,
              },
            });
          }

          const current = await tx.session.findUniqueOrThrow({
            where: { id: sessionId },
            select: SESSION_MUTATION_SELECT,
          });

          return {
            kind: "applied" as const,
            session: current,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializableConflict(error) && attempt === 0) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to apply session control mutation.");
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = controlActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const now = new Date();
  const {
    action,
    connectionId,
    expectedControlToken,
    expectedNegotiationState,
  } = parsed.data;

  logStage310SessionControl("operation_started", {
    sessionId,
    action,
    connectionId: shortConnectionId(connectionId),
  });

  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );
  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  try {
    await reconcileSessionControlAutoTransitions(sessionId, now);

    const mutation = await runInteractiveMutation({
      sessionId,
      action,
      expectedNegotiationState,
      expectedControlToken,
      connectionId,
      participant,
      now,
    });

    if (mutation.kind === "access_conflict") {
      return buildAccessConflictResponse(mutation.conflict);
    }
    if (mutation.kind === "forbidden") {
      return NextResponse.json(mutation.body, { status: 403 });
    }
    if (mutation.kind === "stale_connection") {
      return NextResponse.json(mutation.body, { status: 409 });
    }
    if (mutation.kind === "roles_not_ready") {
      return NextResponse.json(mutation.body, { status: mutation.status });
    }
    if (mutation.kind === "noop") {
      const recording = await loadRecordingState(sessionId);
      return NextResponse.json({
        ...buildControlStateResponse(mutation.session, participant.type, now),
        recordingWarning: undefined,
        recording: recording
          ? {
              status: recording.status,
              recordingAttemptId: recording.recordingAttemptId,
              errorMessage: recording.errorMessage,
            }
          : null,
      });
    }
    if (mutation.kind === "control_conflict") {
      const recording = await loadRecordingState(sessionId);
      return NextResponse.json(
        {
          ...buildControlConflictPayload(mutation.session, participant.type, now),
          recording: recording
            ? {
                status: recording.status,
                recordingAttemptId: recording.recordingAttemptId,
                errorMessage: recording.errorMessage,
              }
            : null,
        },
        { status: 409 },
      );
    }

    let recordingWarning: string | undefined;

    if (action === "FINISH") {
      // CAS has already authored FINISHED; canonical completion claims/delivers
      // stop intent and enforces room lifecycle without re-running transition.
      const finishResult = await completeSessionCanonical({
        sessionId,
        mode: "ROOM_FACILITATOR_FINISH",
      });
      recordingWarning = finishResult.recording.warning ?? undefined;
    } else {
      const recording = await loadRecordingState(sessionId);
      const isLiveKit =
        resolveEffectiveRecordingProvider(recording?.provider) === "livekit";
      if (isLiveKit && shouldRunLivekitRecordingLifecycle(action)) {
        const recordingResult = await handleNegotiationStartRecording(sessionId);
        if (recordingResult && !recordingResult.ok) {
          recordingWarning = recordingResult.warning;
        }
      }
    }

    const session = await reconcileSessionControlAutoTransitions(sessionId, now);
    const recording = await loadRecordingState(sessionId);

    logStage310SessionControl("operation_result", {
      sessionId,
      action,
      result: "ok",
      participantType: participant.type,
      negotiationState: session.negotiationState,
      recordingStatus: recording?.status ?? null,
      recordingWarning: recordingWarning ?? null,
    });

    return NextResponse.json({
      ...buildControlStateResponse(session, participant.type, now),
      recordingWarning,
      recording: recording
        ? {
            status: recording.status,
            recordingAttemptId: recording.recordingAttemptId,
            errorMessage: recording.errorMessage,
          }
        : null,
    });
  } catch (error) {
    logStage310SessionControl("controlled_error", {
      sessionId,
      action,
      operation: "control_update",
      error:
        error instanceof Error
          ? error.message
          : "Unable to update negotiation state.",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update negotiation state.",
      },
      { status: 400 },
    );
  }
}
