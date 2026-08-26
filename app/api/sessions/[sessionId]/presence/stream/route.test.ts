import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { SessionParticipant } from "@/app/generated/prisma/client";
import type { CurrentUserSessionAccess } from "@/lib/access-control";
import type { AuthUser } from "@/lib/auth";
import { NextResponse } from "next/server";

import { createPresenceStreamGet } from "./route";

const SESSION_ID = "session-real-1";
const FACILITATOR_ID = "user-facilitator-1";
const UNRELATED_ID = "user-unrelated-1";

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: FACILITATOR_ID,
    email: "real-facilitator@example.com",
    name: "Real Facilitator",
    globalRole: "USER",
    status: "ACTIVE",
    preferredLocale: "en",
    sessionSoundEnabled: true,
    ...overrides,
  };
}

function participant(
  overrides: Partial<SessionParticipant> = {},
): SessionParticipant {
  return {
    id: "participant-1",
    sessionId: SESSION_ID,
    userId: FACILITATOR_ID,
    displayName: "Facilitator",
    type: "FACILITATOR",
    sessionRoleId: null,
    eventParticipantId: null,
    joinToken: "token-1",
    notes: "",
    joinedAt: null,
    lastSeenAt: null,
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
    updatedAt: new Date("2026-08-26T12:00:00.000Z"),
    ...overrides,
  };
}

function sessionAccess(
  overrides: Partial<CurrentUserSessionAccess> = {},
): CurrentUserSessionAccess {
  return {
    session: {
      id: SESSION_ID,
      eventId: null,
      facilitatorId: FACILITATOR_ID,
      deletedAt: null,
      event: null,
    },
    user: authUser(),
    isAdmin: false,
    isEventHostOwner: false,
    isEventFacilitatorOwner: false,
    isSessionFacilitatorOwner: true,
    tokenParticipant: null,
    userParticipant: participant(),
    hasEmailInvite: false,
    ...overrides,
  };
}

function offlineSnapshot() {
  return {
    id: "participant-1",
    joinedAt: null,
    lastSeenAt: null,
    isOnline: false,
    connectionStatus: "OFFLINE" as const,
  };
}

function onlineSnapshot() {
  return {
    id: "participant-1",
    joinedAt: "2026-08-26T12:00:00.000Z",
    lastSeenAt: "2026-08-26T12:01:00.000Z",
    isOnline: true,
    connectionStatus: "ONLINE" as const,
  };
}

async function invokeGet(
  options: {
    user?: AuthUser | null;
    authResponse?: Response | null;
    access?: CurrentUserSessionAccess | null;
    snapshots?: Awaited<
      ReturnType<typeof import("@/lib/session-current-presence-read").loadSessionCurrentPresenceSnapshots>
    >;
  } = {},
) {
  const abort = new AbortController();
  const request = new Request(
    `http://localhost/api/sessions/${SESSION_ID}/presence/stream`,
    { signal: abort.signal },
  );
  const GET = createPresenceStreamGet({
    requireActiveUser: async () => {
      if (options.authResponse) {
        return { user: null, response: options.authResponse };
      }
      if (!options.user) {
        return {
          user: null,
          response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
        };
      }
      return { user: options.user, response: null };
    },
    getSessionAccess: async () => options.access ?? null,
    loadPresence: async () => options.snapshots ?? [offlineSnapshot()],
  });

  try {
    const response = await GET(request, {
      params: Promise.resolve({ sessionId: SESSION_ID }),
    });
    return { response, abort };
  } catch (error) {
    abort.abort();
    throw error;
  }
}

async function readFirstSseSnapshotAndClose(
  response: Response,
  abort: AbortController,
) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.ok(response.body, "SSE body must exist");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("SSE first snapshot timed out")), 1000);
      }),
    ]);

    abort.abort();

    if (first.done) {
      throw new Error("SSE closed before the first snapshot");
    }

    const text = decoder.decode(first.value);
    const dataLine = text
      .split("\n")
      .find((line) => line.startsWith("data: "));
    assert.ok(dataLine, `expected SSE data line, got: ${text}`);
    return JSON.parse(dataLine.slice("data: ".length)) as {
      participants: Array<{
        id: string;
        isOnline: boolean;
        connectionStatus: string;
      }>;
    };
  } finally {
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
}

test("ST-03 / PR-01 real non-demo manager receives 200 SSE", async () => {
  const { response, abort } = await invokeGet({
    user: authUser(),
    access: sessionAccess(),
    snapshots: [offlineSnapshot()],
  });

  const payload = await readFirstSseSnapshotAndClose(response, abort);
  assert.equal(payload.participants.length, 1);
  assert.equal(payload.participants[0]?.isOnline, false);
});

test("PR-02 unauthenticated caller receives 401", async () => {
  const { response, abort } = await invokeGet({
    user: null,
  });

  try {
    assert.equal(response.status, 401);
    assert.notEqual(response.headers.get("Content-Type"), "text/event-stream");
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Unauthorized.");
  } finally {
    abort.abort();
  }
});

test("PR-03 authenticated unrelated user remains denied with 404", async () => {
  const { response, abort } = await invokeGet({
    user: authUser({ id: UNRELATED_ID, email: "unrelated@example.com" }),
    access: sessionAccess({
      user: authUser({ id: UNRELATED_ID, email: "unrelated@example.com" }),
      isSessionFacilitatorOwner: false,
      userParticipant: null,
    }),
  });

  try {
    assert.equal(response.status, 404);
    assert.notEqual(response.headers.get("Content-Type"), "text/event-stream");
    assert.equal(await response.text(), "Session not found.");
  } finally {
    abort.abort();
  }
});

test("PR-04 fresh Standalone with no room lease is 200 Offline, not 404", async () => {
  const { response, abort } = await invokeGet({
    user: authUser(),
    access: sessionAccess(),
    snapshots: [offlineSnapshot()],
  });

  const payload = await readFirstSseSnapshotAndClose(response, abort);
  assert.equal(payload.participants[0]?.isOnline, false);
  assert.equal(payload.participants[0]?.connectionStatus, "OFFLINE");
});

test("PR-05 stream snapshot stays lease-derived Online when a valid lease exists", async () => {
  const { response, abort } = await invokeGet({
    user: authUser(),
    access: sessionAccess(),
    snapshots: [onlineSnapshot()],
  });

  const payload = await readFirstSseSnapshotAndClose(response, abort);
  assert.equal(payload.participants[0]?.isOnline, true);
  assert.equal(payload.participants[0]?.connectionStatus, "ONLINE");
});

test("EV-05 Event host can stream an Event-created Session under canManageSession", async () => {
  const { response, abort } = await invokeGet({
    user: authUser({ id: "event-host-1", email: "host@example.com" }),
    access: sessionAccess({
      session: {
        id: SESSION_ID,
        eventId: "event-1",
        facilitatorId: FACILITATOR_ID,
        deletedAt: null,
        event: {
          id: "event-1",
          hostUserId: "event-host-1",
          facilitatorUserId: FACILITATOR_ID,
        },
      },
      user: authUser({ id: "event-host-1", email: "host@example.com" }),
      isSessionFacilitatorOwner: false,
      isEventHostOwner: true,
      userParticipant: null,
    }),
    snapshots: [offlineSnapshot()],
  });

  const payload = await readFirstSseSnapshotAndClose(response, abort);
  assert.equal(payload.participants.length, 1);
});

test("authenticated participant who cannot manage remains 404", async () => {
  const { response, abort } = await invokeGet({
    user: authUser({ id: "player-1", email: "player@example.com" }),
    access: sessionAccess({
      user: authUser({ id: "player-1", email: "player@example.com" }),
      isSessionFacilitatorOwner: false,
      userParticipant: participant({
        id: "player-participant",
        userId: "player-1",
        type: "PARTICIPANT",
        displayName: "Player",
      }),
    }),
  });

  try {
    assert.equal(response.status, 404);
  } finally {
    abort.abort();
  }
});

test("missing Session is 404 for an authenticated user", async () => {
  const { response, abort } = await invokeGet({
    user: authUser(),
    access: null,
  });

  try {
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Session not found.");
  } finally {
    abort.abort();
  }
});

test("stream route no longer depends on the demo facilitator", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/sessions/[sessionId]/presence/stream/route.ts"),
    "utf8",
  );

  assert.equal(source.includes("getDemoFacilitator"), false);
  assert.equal(source.includes("demo@example.com"), false);
  assert.equal(source.includes("apiRequireActiveUser"), true);
  assert.equal(source.includes("canManageSession"), true);
  assert.equal(source.includes("getCurrentUserSessionAccess"), true);
});
