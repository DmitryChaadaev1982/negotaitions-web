import {
  NegotiationState,
  TrainingEventStatus,
  type Session,
} from "@/app/generated/prisma/client";

export type SessionCloseFields = Pick<
  Session,
  | "negotiationState"
  | "negotiationStartedAt"
  | "closedByEventAt"
  | "closeReason"
> & {
  event?: { status: TrainingEventStatus } | null;
};

export type SessionCloseState = {
  isClosed: boolean;
  closedByEventAt: string | null;
  closeReason: string | null;
  eventStatus: string | null;
  closedBeforeNegotiation: boolean;
  closeMessageKey:
    | "events.sessionClosedByEvent"
    | "events.sessionClosedBeforeNegotiation"
    | "join.sessionFinishedMessage"
    | null;
};

export function buildSessionCloseState(
  session: SessionCloseFields,
): SessionCloseState {
  const closedByEvent =
    session.closeReason === "EVENT_COMPLETED" || session.closedByEventAt != null;
  const eventCompleted =
    session.event?.status === TrainingEventStatus.COMPLETED;
  const isClosed =
    closedByEvent ||
    eventCompleted ||
    session.negotiationState === NegotiationState.FINISHED;

  const closedBeforeNegotiation =
    isClosed && session.negotiationStartedAt == null;

  let closeMessageKey: SessionCloseState["closeMessageKey"] = null;

  if (closedByEvent || eventCompleted) {
    closeMessageKey = closedBeforeNegotiation
      ? "events.sessionClosedBeforeNegotiation"
      : "events.sessionClosedByEvent";
  } else if (session.negotiationState === NegotiationState.FINISHED) {
    closeMessageKey = "join.sessionFinishedMessage";
  }

  return {
    isClosed,
    closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
    closeReason: session.closeReason,
    eventStatus: session.event?.status ?? null,
    closedBeforeNegotiation,
    closeMessageKey,
  };
}

export const SESSION_CLOSE_SELECT = {
  negotiationState: true,
  negotiationStartedAt: true,
  closedByEventAt: true,
  closeReason: true,
  event: {
    select: {
      status: true,
    },
  },
} as const;
