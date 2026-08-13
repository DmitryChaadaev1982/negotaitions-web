import {
  NegotiationState,
  RoomLifecycle,
  SessionStatus,
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

export function deriveRoomLifecycleBackfillUpdate(input: {
  roomLifecycle: RoomLifecycle | null;
  deletedAt: Date | null;
  closedByEventAt: Date | null;
  negotiationState: NegotiationState;
  eventStatus: TrainingEventStatus | null;
}): {
  roomLifecycle: RoomLifecycle;
  status?: SessionStatus;
} | null {
  if (input.roomLifecycle !== null) {
    return null;
  }

  const roomLifecycle = deriveBackfillLifecycle(input);
  if (
    roomLifecycle === RoomLifecycle.CLOSED &&
    input.negotiationState === NegotiationState.FINISHED
  ) {
    return {
      roomLifecycle,
      status: SessionStatus.COMPLETED,
    };
  }

  return { roomLifecycle };
}

const RELAY_DELIVERING_TRANSPORTS = [
  "voximplant_browser_relay_claim",
  "voximplant_browser_relay_ack",
  "maintenance_worker_relay_claim_timeout_probe",
] as const;

type RelayDeliveringCandidate = {
  state: string;
  lastDeliveryTransport: string | null;
  transportAcceptedAt: Date | null;
  commandAcceptedAt: Date | null;
  providerTerminalAt: Date | null;
  lastAttemptAt: Date | null;
};

export function isRelayDeliveringTimeoutCandidate(
  candidate: RelayDeliveringCandidate,
  terminalTimeoutCutoff: Date,
) {
  return (
    candidate.state === "DELIVERING" &&
    candidate.transportAcceptedAt === null &&
    candidate.commandAcceptedAt === null &&
    candidate.providerTerminalAt === null &&
    candidate.lastAttemptAt !== null &&
    candidate.lastAttemptAt <= terminalTimeoutCutoff &&
    RELAY_DELIVERING_TRANSPORTS.includes(
      (candidate.lastDeliveryTransport ?? "") as
        | "voximplant_browser_relay_claim"
        | "voximplant_browser_relay_ack"
        | "maintenance_worker_relay_claim_timeout_probe",
    )
  );
}

export { RELAY_DELIVERING_TRANSPORTS };
