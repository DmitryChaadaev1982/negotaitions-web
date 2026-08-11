import { createHash } from "node:crypto";

import type { Prisma, Session } from "@/app/generated/prisma/client";

type SnapshotDateKeys =
  | "preparationStartedAt"
  | "preparationEndedAt"
  | "preparationTimerStartedAt"
  | "preparationPausedAt"
  | "negotiationStartedAt"
  | "negotiationEndedAt"
  | "timerStartedAt"
  | "pausedAt"
  | "deletedAt"
  | "closedByEventAt";

export type SessionControlSnapshotFields = Pick<
  Session,
  | "negotiationState"
  | "preparationDurationSeconds"
  | "durationSeconds"
  | "preparationStartedAt"
  | "preparationEndedAt"
  | "preparationTimerStartedAt"
  | "preparationPausedAt"
  | "preparationTotalPausedSeconds"
  | "negotiationStartedAt"
  | "negotiationEndedAt"
  | "timerStartedAt"
  | "pausedAt"
  | "totalPausedSeconds"
  | "facilitatorId"
  | "deletedAt"
  | "closedByEventAt"
  | "closedByEventId"
  | "closeReason"
  | "roomLifecycle"
>;

export type SessionControlSnapshot = {
  negotiationState: SessionControlSnapshotFields["negotiationState"];
  preparationDurationSeconds: number;
  durationSeconds: number;
  preparationStartedAt: Date | null;
  preparationEndedAt: Date | null;
  preparationTimerStartedAt: Date | null;
  preparationPausedAt: Date | null;
  preparationTotalPausedSeconds: number;
  negotiationStartedAt: Date | null;
  negotiationEndedAt: Date | null;
  timerStartedAt: Date | null;
  pausedAt: Date | null;
  totalPausedSeconds: number;
  facilitatorId: string;
  deletedAt: Date | null;
  closedByEventAt: Date | null;
  closedByEventId: string | null;
  closeReason: string | null;
  roomLifecycle: SessionControlSnapshotFields["roomLifecycle"];
};

type CanonicalControlSnapshot = {
  negotiationState: SessionControlSnapshot["negotiationState"];
  preparationDurationSeconds: number;
  durationSeconds: number;
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
  facilitatorId: string;
  deletedAt: string | null;
  closedByEventAt: string | null;
  closedByEventId: string | null;
  closeReason: string | null;
  roomLifecycle: SessionControlSnapshot["roomLifecycle"];
};

export const SESSION_CONTROL_SNAPSHOT_SELECT = {
  negotiationState: true,
  preparationDurationSeconds: true,
  durationSeconds: true,
  preparationStartedAt: true,
  preparationEndedAt: true,
  preparationTimerStartedAt: true,
  preparationPausedAt: true,
  preparationTotalPausedSeconds: true,
  negotiationStartedAt: true,
  negotiationEndedAt: true,
  timerStartedAt: true,
  pausedAt: true,
  totalPausedSeconds: true,
  facilitatorId: true,
  deletedAt: true,
  closedByEventAt: true,
  closedByEventId: true,
  closeReason: true,
  roomLifecycle: true,
} as const;

const DATE_FIELDS: SnapshotDateKeys[] = [
  "preparationStartedAt",
  "preparationEndedAt",
  "preparationTimerStartedAt",
  "preparationPausedAt",
  "negotiationStartedAt",
  "negotiationEndedAt",
  "timerStartedAt",
  "pausedAt",
  "deletedAt",
  "closedByEventAt",
];

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toCanonicalSnapshot(
  snapshot: SessionControlSnapshot,
): CanonicalControlSnapshot {
  return {
    negotiationState: snapshot.negotiationState,
    preparationDurationSeconds: snapshot.preparationDurationSeconds,
    durationSeconds: snapshot.durationSeconds,
    preparationStartedAt: toIso(snapshot.preparationStartedAt),
    preparationEndedAt: toIso(snapshot.preparationEndedAt),
    preparationTimerStartedAt: toIso(snapshot.preparationTimerStartedAt),
    preparationPausedAt: toIso(snapshot.preparationPausedAt),
    preparationTotalPausedSeconds: snapshot.preparationTotalPausedSeconds,
    negotiationStartedAt: toIso(snapshot.negotiationStartedAt),
    negotiationEndedAt: toIso(snapshot.negotiationEndedAt),
    timerStartedAt: toIso(snapshot.timerStartedAt),
    pausedAt: toIso(snapshot.pausedAt),
    totalPausedSeconds: snapshot.totalPausedSeconds,
    facilitatorId: snapshot.facilitatorId,
    deletedAt: toIso(snapshot.deletedAt),
    closedByEventAt: toIso(snapshot.closedByEventAt),
    closedByEventId: snapshot.closedByEventId,
    closeReason: snapshot.closeReason,
    roomLifecycle: snapshot.roomLifecycle,
  };
}

export function pickSessionControlSnapshot(
  fields: SessionControlSnapshotFields,
): SessionControlSnapshot {
  return {
    negotiationState: fields.negotiationState,
    preparationDurationSeconds: fields.preparationDurationSeconds,
    durationSeconds: fields.durationSeconds,
    preparationStartedAt: fields.preparationStartedAt,
    preparationEndedAt: fields.preparationEndedAt,
    preparationTimerStartedAt: fields.preparationTimerStartedAt,
    preparationPausedAt: fields.preparationPausedAt,
    preparationTotalPausedSeconds: fields.preparationTotalPausedSeconds,
    negotiationStartedAt: fields.negotiationStartedAt,
    negotiationEndedAt: fields.negotiationEndedAt,
    timerStartedAt: fields.timerStartedAt,
    pausedAt: fields.pausedAt,
    totalPausedSeconds: fields.totalPausedSeconds,
    facilitatorId: fields.facilitatorId,
    deletedAt: fields.deletedAt,
    closedByEventAt: fields.closedByEventAt,
    closedByEventId: fields.closedByEventId,
    closeReason: fields.closeReason,
    roomLifecycle: fields.roomLifecycle,
  };
}

export function createSessionControlToken(snapshot: SessionControlSnapshot) {
  const canonical = JSON.stringify(toCanonicalSnapshot(snapshot));
  return createHash("sha256").update(canonical).digest("base64url");
}

export function buildSessionControlSnapshotWhere(
  sessionId: string,
  snapshot: SessionControlSnapshot,
): Prisma.SessionWhereInput {
  return {
    id: sessionId,
    negotiationState: snapshot.negotiationState,
    preparationDurationSeconds: snapshot.preparationDurationSeconds,
    durationSeconds: snapshot.durationSeconds,
    preparationTotalPausedSeconds: snapshot.preparationTotalPausedSeconds,
    totalPausedSeconds: snapshot.totalPausedSeconds,
    facilitatorId: snapshot.facilitatorId,
    closedByEventId: snapshot.closedByEventId,
    closeReason: snapshot.closeReason,
    roomLifecycle: snapshot.roomLifecycle,
    ...Object.fromEntries(
      DATE_FIELDS.map((key) => [key, snapshot[key]]),
    ),
  };
}
