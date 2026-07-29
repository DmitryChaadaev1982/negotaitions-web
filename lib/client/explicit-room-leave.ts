"use client";

export type ExplicitLeaveFinalState =
  | "DISCONNECTED"
  | "SUPERSEDED"
  | "REVOKED"
  | "EXPIRED"
  | "ACTIVE"
  | "NOT_FOUND"
  | "UNKNOWN";

type ExplicitLeaveApiPayload = {
  disconnected?: boolean;
  alreadyFinalized?: boolean;
  roomClosed?: boolean;
  finalState?: ExplicitLeaveFinalState | string | null;
  code?: string;
  error?: string;
};

export type ExplicitLeaveSuccess = {
  ok: true;
  disconnected: boolean;
  alreadyFinalized: boolean;
  roomClosed: boolean;
  finalState: ExplicitLeaveFinalState;
};

export type ExplicitLeaveFailureReason =
  | "timeout"
  | "network"
  | "stale_connection"
  | "http_error"
  | "not_persisted";

export type ExplicitLeaveFailure = {
  ok: false;
  reason: ExplicitLeaveFailureReason;
  statusCode: number | null;
  finalState: ExplicitLeaveFinalState;
  error: string | null;
};

export type ExplicitLeaveResult = ExplicitLeaveSuccess | ExplicitLeaveFailure;

type PersistExplicitRoomLeaveParams = {
  sessionId: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function toKnownFinalState(value: unknown): ExplicitLeaveFinalState {
  if (value === "DISCONNECTED") return "DISCONNECTED";
  if (value === "SUPERSEDED") return "SUPERSEDED";
  if (value === "REVOKED") return "REVOKED";
  if (value === "EXPIRED") return "EXPIRED";
  if (value === "ACTIVE") return "ACTIVE";
  if (value === "NOT_FOUND") return "NOT_FOUND";
  return "UNKNOWN";
}

function isPersistedFinalState(state: ExplicitLeaveFinalState) {
  return (
    state === "DISCONNECTED" ||
    state === "SUPERSEDED" ||
    state === "REVOKED" ||
    state === "EXPIRED"
  );
}

export async function persistExplicitRoomLeave({
  sessionId,
  body,
  timeoutMs = 3000,
  fetchImpl = fetch,
}: PersistExplicitRoomLeaveParams): Promise<ExplicitLeaveResult> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const request = fetchImpl(
    `/api/sessions/${encodeURIComponent(sessionId)}/presence/leave`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    },
  ).then(
    (response) => ({ type: "response" as const, response }),
    (error: unknown) => ({ type: "error" as const, error }),
  );

  const timeout = new Promise<{ type: "timeout" }>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ type: "timeout" });
    }, timeoutMs);
  });

  const raceResult = await Promise.race([request, timeout]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (raceResult.type === "timeout") {
    return {
      ok: false,
      reason: "timeout",
      statusCode: null,
      finalState: "UNKNOWN",
      error: null,
    };
  }

  if (raceResult.type === "error") {
    return {
      ok: false,
      reason: "network",
      statusCode: null,
      finalState: "UNKNOWN",
      error:
        raceResult.error instanceof Error
          ? raceResult.error.message
          : String(raceResult.error),
    };
  }

  const response = raceResult.response;
  const payload = (await response
    .json()
    .catch(() => null)) as ExplicitLeaveApiPayload | null;
  const finalState = toKnownFinalState(payload?.finalState);

  if (response.status === 409 || payload?.code === "STALE_CONNECTION") {
    return {
      ok: false,
      reason: "stale_connection",
      statusCode: response.status,
      finalState,
      error: payload?.error ?? null,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "http_error",
      statusCode: response.status,
      finalState,
      error: payload?.error ?? null,
    };
  }

  const disconnected = payload?.disconnected === true;
  const alreadyFinalized = payload?.alreadyFinalized === true;
  const roomClosed = payload?.roomClosed === true;
  const persisted =
    disconnected || (alreadyFinalized && isPersistedFinalState(finalState));

  if (!persisted) {
    return {
      ok: false,
      reason: "not_persisted",
      statusCode: response.status,
      finalState,
      error: payload?.error ?? null,
    };
  }

  return {
    ok: true,
    disconnected,
    alreadyFinalized,
    roomClosed,
    finalState,
  };
}
