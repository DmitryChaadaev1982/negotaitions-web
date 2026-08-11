import { ParticipantType } from "@/app/generated/prisma/client";
import type { Session } from "@/app/generated/prisma/client";
import {
  buildControlState,
  type ControlState,
  type SessionControlFields,
} from "@/lib/negotiation-control";
import {
  createSessionControlToken,
  pickSessionControlSnapshot,
  type SessionControlSnapshotFields,
} from "@/lib/session-control-snapshot";

type ControlTimestamp =
  | "preparationStartedAt"
  | "preparationEndedAt"
  | "preparationTimerStartedAt"
  | "preparationPausedAt"
  | "negotiationStartedAt"
  | "negotiationEndedAt"
  | "timerStartedAt"
  | "pausedAt";

const RESPONSE_TIMESTAMP_FIELDS: ControlTimestamp[] = [
  "preparationStartedAt",
  "preparationEndedAt",
  "preparationTimerStartedAt",
  "preparationPausedAt",
  "negotiationStartedAt",
  "negotiationEndedAt",
  "timerStartedAt",
  "pausedAt",
];

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

export type ControlStateResponse = ControlState & {
  controlToken: string;
  serverNow: string;
  preparationStartedAt: string | null;
  preparationEndedAt: string | null;
  preparationTimerStartedAt: string | null;
  preparationPausedAt: string | null;
  preparationTotalPausedSeconds: number;
  negotiationStartedAt: string | null;
  negotiationEndedAt: string | null;
  timerStartedAt: string | null;
  pausedAt: string | null;
  totalPausedSeconds: number;
};

export type SessionControlResponseFields = SessionControlFields &
  SessionControlSnapshotFields &
  Pick<Session, "id">;

export function buildControlStateResponse(
  session: SessionControlResponseFields,
  participantType: ParticipantType,
  now: Date = new Date(),
): ControlStateResponse {
  const baseState = buildControlState(session, participantType, now);
  const snapshot = pickSessionControlSnapshot(session);

  const timestampFields = Object.fromEntries(
    RESPONSE_TIMESTAMP_FIELDS.map((field) => [field, toIso(session[field])]),
  ) as Pick<
    ControlStateResponse,
    | "preparationStartedAt"
    | "preparationEndedAt"
    | "preparationTimerStartedAt"
    | "preparationPausedAt"
    | "negotiationStartedAt"
    | "negotiationEndedAt"
    | "timerStartedAt"
    | "pausedAt"
  >;

  return {
    ...baseState,
    controlToken: createSessionControlToken(snapshot),
    serverNow: now.toISOString(),
    ...timestampFields,
    preparationTotalPausedSeconds: session.preparationTotalPausedSeconds,
    totalPausedSeconds: session.totalPausedSeconds,
  };
}
