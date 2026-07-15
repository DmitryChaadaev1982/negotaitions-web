"use client";

type StalePayload = {
  code?: string;
  error?: string;
  redirectTo?: string;
};

export async function isStaleConnectionResponse(response: Response) {
  if (response.status !== 409) {
    return false;
  }

  const payload = (await response
    .clone()
    .json()
    .catch(() => ({}))) as StalePayload;
  return payload.code === "STALE_CONNECTION" || payload.error === "staleConnection";
}

export async function getRoomClosureRedirectFromConflict(
  response: Response,
): Promise<string | null> {
  if (response.status !== 409) {
    return null;
  }
  const payload = (await response
    .clone()
    .json()
    .catch(() => ({}))) as StalePayload;
  if (payload.code === "ROOM_CLOSED" || payload.code === "EVENT_CLOSED") {
    return payload.redirectTo ?? null;
  }
  return null;
}
