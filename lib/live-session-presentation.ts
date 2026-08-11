import { NegotiationState } from "@/app/generated/prisma/enums";

export const FINISH_LINE_DURATION_MS = 2_500;

export type FinishLineVariant = "TIMER_EXPIRED" | "MANUAL_FINISH";

export type LiveSessionPresentationState =
  | "ROOM_READY"
  | "PREPARATION_RUNNING"
  | "PREPARATION_PAUSED"
  | "WAITING_FOR_NEGOTIATION_START"
  | "NEGOTIATION_RUNNING"
  | "FINAL_MINUTE"
  | "FINAL_10_SECONDS"
  | "NEGOTIATION_PAUSED"
  | "FINISH_LINE_TIMER_EXPIRED"
  | "FINISH_LINE_MANUAL_FINISH"
  | "DEBRIEF";

export type SessionCloseMessageKey =
  | "events.sessionClosedByEvent"
  | "events.sessionClosedBeforeNegotiation"
  | "join.sessionFinishedMessage"
  | null;

function parseIsoTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveFinishLineVariant(
  remainingSeconds: number,
): FinishLineVariant {
  return remainingSeconds === 0 ? "TIMER_EXPIRED" : "MANUAL_FINISH";
}

export function canUseFinishLinePresentation(params: {
  negotiationState: NegotiationState;
  closeMessageKey: SessionCloseMessageKey;
}) {
  return (
    params.negotiationState === NegotiationState.FINISHED &&
    params.closeMessageKey === "join.sessionFinishedMessage"
  );
}

export function deriveLiveSessionPresentationState(params: {
  negotiationState: NegotiationState;
  remainingSeconds: number;
  finishLineActive: boolean;
}): LiveSessionPresentationState {
  const { negotiationState, remainingSeconds, finishLineActive } = params;

  if (negotiationState === NegotiationState.FINISHED) {
    if (finishLineActive) {
      return resolveFinishLineVariant(remainingSeconds) === "TIMER_EXPIRED"
        ? "FINISH_LINE_TIMER_EXPIRED"
        : "FINISH_LINE_MANUAL_FINISH";
    }
    return "DEBRIEF";
  }

  if (negotiationState === NegotiationState.PAUSED) {
    return "NEGOTIATION_PAUSED";
  }

  if (negotiationState === NegotiationState.RUNNING) {
    if (remainingSeconds > 0 && remainingSeconds <= 10) {
      return "FINAL_10_SECONDS";
    }
    if (remainingSeconds > 10 && remainingSeconds <= 60) {
      return "FINAL_MINUTE";
    }
    return "NEGOTIATION_RUNNING";
  }

  if (negotiationState === NegotiationState.PREPARATION) {
    return "ROOM_READY";
  }
  if (negotiationState === NegotiationState.PREPARATION_RUNNING) {
    return "PREPARATION_RUNNING";
  }
  if (negotiationState === NegotiationState.PREPARATION_PAUSED) {
    return "PREPARATION_PAUSED";
  }

  return "WAITING_FOR_NEGOTIATION_START";
}

export function computeFinishLineRemainingMs(params: {
  negotiationEndedAt: string | null | undefined;
  serverNow: string | null | undefined;
  durationMs?: number;
}) {
  const durationMs = params.durationMs ?? FINISH_LINE_DURATION_MS;
  const endedAtMs = parseIsoTimestampMs(params.negotiationEndedAt);
  const serverNowMs = parseIsoTimestampMs(params.serverNow);
  if (endedAtMs == null || serverNowMs == null) {
    return null;
  }

  const elapsedMs = Math.max(0, serverNowMs - endedAtMs);
  return Math.min(durationMs, Math.max(0, durationMs - elapsedMs));
}

export function computeFinishLineClientDeadlineMs(params: {
  negotiationEndedAt: string | null | undefined;
  serverNow: string | null | undefined;
  clientNowMs: number;
  durationMs?: number;
}) {
  const remainingMs = computeFinishLineRemainingMs(params);
  if (remainingMs == null || remainingMs <= 0) {
    return null;
  }
  return params.clientNowMs + remainingMs;
}

export function coalesceFinishLineDeadlineMs(
  currentDeadlineMs: number | null,
  candidateDeadlineMs: number | null,
) {
  if (candidateDeadlineMs == null) {
    return null;
  }
  if (currentDeadlineMs == null) {
    return candidateDeadlineMs;
  }
  return Math.min(currentDeadlineMs, candidateDeadlineMs);
}
