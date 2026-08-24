import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";

export type RoomLifecycleCompatibilityInput = {
  roomLifecycle: RoomLifecycle | null;
  deletedAt?: Date | null;
  closedByEventAt?: Date | null;
  closeReason?: string | null;
  negotiationState?: NegotiationState | string | null;
  eventStatus?: TrainingEventStatus | string | null;
};

/**
 * Compatibility derivation while roomLifecycle can still be null.
 * Conservative policy:
 * - deleted/event-closed/completed-event -> CLOSED
 * - unfinished -> OPEN
 * - historical finished legacy rows -> CLOSED
 */
export function deriveEffectiveRoomLifecycle(
  input: RoomLifecycleCompatibilityInput,
): RoomLifecycle {
  if (input.roomLifecycle) {
    return input.roomLifecycle;
  }

  if (
    input.deletedAt ||
    input.closedByEventAt ||
    input.closeReason === "EVENT_COMPLETED" ||
    input.eventStatus === TrainingEventStatus.COMPLETED
  ) {
    return RoomLifecycle.CLOSED;
  }

  if (
    input.negotiationState &&
    input.negotiationState !== NegotiationState.FINISHED
  ) {
    return RoomLifecycle.OPEN;
  }

  return RoomLifecycle.CLOSED;
}
