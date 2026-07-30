export const EVENT_LOBBY_POLL_INTERVAL_MS = 3_000;
export const EVENT_LOBBY_HIDDEN_POLL_INTERVAL_MS = 10_000;

export function shouldApplyEventStateResponse(input: {
  requestId: number;
  latestAppliedRequestId: number;
}) {
  return input.requestId >= input.latestAppliedRequestId;
}

export function getEventLobbyPollDelayMs(isVisible: boolean) {
  return isVisible
    ? EVENT_LOBBY_POLL_INTERVAL_MS
    : EVENT_LOBBY_HIDDEN_POLL_INTERVAL_MS;
}
