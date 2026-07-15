import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";

export function nextRetryAtFromAttempt(attemptCount: number) {
  const boundedAttempt = Math.max(1, Math.min(attemptCount, 8));
  const retryDelayMs = Math.min(
    30 * 60 * 1000,
    15 * 1000 * Math.pow(2, boundedAttempt - 1),
  );
  return new Date(Date.now() + retryDelayMs);
}

export function deriveBackfillLifecycle(input: {
  deletedAt: Date | null;
  closedByEventAt: Date | null;
  negotiationState: NegotiationState;
  eventStatus: TrainingEventStatus | null;
}) {
  if (
    input.deletedAt ||
    input.closedByEventAt ||
    input.eventStatus === TrainingEventStatus.COMPLETED
  ) {
    return RoomLifecycle.CLOSED;
  }

  if (input.negotiationState !== NegotiationState.FINISHED) {
    return RoomLifecycle.OPEN;
  }

  return RoomLifecycle.CLOSED;
}
