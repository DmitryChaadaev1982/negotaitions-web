"use client";

type StalePayload = {
  code?: string;
  error?: string;
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
