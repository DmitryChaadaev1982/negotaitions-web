import { expect, type APIRequestContext } from "@playwright/test";

type SessionControlAuth = {
  joinToken?: string;
  participantId?: string;
};

type ControlStatePayload = {
  negotiationState: string;
  controlToken: string;
};

function toQueryString(values: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value && value.trim().length > 0) {
      query.set(key, value);
    }
  }
  return query.toString();
}

function defaultConnectionId() {
  return `e2e-${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchSessionControlStateWithLease(
  request: APIRequestContext,
  params: {
    sessionId: string;
    auth: SessionControlAuth;
    connectionId?: string;
    claimLease?: boolean;
    headers?: Record<string, string>;
  },
): Promise<ControlStatePayload & { connectionId: string }> {
  const connectionId = params.connectionId ?? defaultConnectionId();
  const query = toQueryString({
    joinToken: params.auth.joinToken ?? null,
    participantId: params.auth.participantId ?? null,
    connectionId,
    claimLease: params.claimLease === false ? null : "1",
  });
  const response = await request.get(
    `/api/sessions/${params.sessionId}/control-state?${query}`,
    params.headers ? { headers: params.headers } : undefined,
  );
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as Partial<ControlStatePayload>;
  expect(typeof payload.negotiationState).toBe("string");
  expect(typeof payload.controlToken).toBe("string");
  return {
    negotiationState: payload.negotiationState as string,
    controlToken: payload.controlToken as string,
    connectionId,
  };
}

export async function postSessionControlAction(
  request: APIRequestContext,
  params: {
    sessionId: string;
    auth: SessionControlAuth;
    action: string;
    connectionId?: string;
    headers?: Record<string, string>;
  },
) {
  const state = await fetchSessionControlStateWithLease(request, {
    sessionId: params.sessionId,
    auth: params.auth,
    connectionId: params.connectionId,
    headers: params.headers,
  });
  return request.post(`/api/sessions/${params.sessionId}/control`, {
    ...(params.headers ? { headers: params.headers } : {}),
    data: {
      ...params.auth,
      action: params.action,
      connectionId: state.connectionId,
      expectedNegotiationState: state.negotiationState,
      expectedControlToken: state.controlToken,
    },
  });
}
