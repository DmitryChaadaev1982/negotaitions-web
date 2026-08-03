import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveEventParticipantPresence,
  type EventParticipantSessionPresenceEvidence,
} from "@/lib/event-participant-presence";

const NOW = new Date("2026-08-03T10:00:00.000Z");
const LOBBY_ONLINE_MS = 12_000;
const RECENT_MS = 120_000;

function ago(ms: number) {
  return new Date(NOW.getTime() - ms);
}

function sessionConnection(
  overrides: Partial<EventParticipantSessionPresenceEvidence> = {},
): EventParticipantSessionPresenceEvidence {
  return {
    eventId: "event-1",
    sessionId: "session-1",
    sessionTitle: "Room 1",
    disconnectedAt: null,
    revokedAt: null,
    supersededAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    updatedAt: ago(1_000),
    ...overrides,
  };
}

function resolve(input: {
  joinedAt?: Date | null;
  lastSeenAt?: Date | null;
  sessionConnections?: EventParticipantSessionPresenceEvidence[];
  historicalParticipation?: boolean;
  now?: Date;
  eventId?: string | null;
}) {
  return resolveEventParticipantPresence({
    lobbyPresence: {
      joinedAt: input.joinedAt ?? null,
      lastSeenAt: input.lastSeenAt ?? null,
    },
    sessionConnections: input.sessionConnections ?? [],
    now: input.now ?? NOW,
    lobbyOnlineWindowMs: LOBBY_ONLINE_MS,
    recentDisconnectWindowMs: RECENT_MS,
    historicalParticipation: input.historicalParticipation,
    eventId: input.eventId ?? "event-1",
  });
}

test("active lobby connection resolves to IN_LOBBY", () => {
  assert.equal(resolve({ joinedAt: ago(10_000), lastSeenAt: ago(1_000) }).state, "IN_LOBBY");
});

test("active Session connection resolves to IN_SESSION", () => {
  const presence = resolve({ sessionConnections: [sessionConnection()] });
  assert.equal(presence.state, "IN_SESSION");
  assert.deepEqual(presence.location, {
    kind: "session",
    sessionId: "session-1",
    sessionTitle: "Room 1",
  });
});

test("recently terminated Session connection resolves to TEMPORARILY_AWAY", () => {
  assert.equal(
    resolve({
      sessionConnections: [
        sessionConnection({
          disconnectedAt: ago(5_000),
          expiresAt: new Date(NOW.getTime() + 60_000),
        }),
      ],
    }).state,
    "TEMPORARILY_AWAY",
  );
});

test("explicit leave produces TEMPORARILY_AWAY immediately", () => {
  assert.equal(
    resolve({
      sessionConnections: [
        sessionConnection({
          disconnectedAt: NOW,
        }),
      ],
    }).state,
    "TEMPORARILY_AWAY",
  );
});

test("grace-period boundary transitions to OFFLINE after expiry", () => {
  assert.equal(
    resolve({
      sessionConnections: [
        sessionConnection({
          disconnectedAt: ago(RECENT_MS),
          expiresAt: ago(RECENT_MS),
        }),
      ],
    }).state,
    "TEMPORARILY_AWAY",
  );
  assert.equal(
    resolve({
      sessionConnections: [
        sessionConnection({
          disconnectedAt: ago(RECENT_MS + 1),
          expiresAt: ago(RECENT_MS + 1),
        }),
      ],
    }).state,
    "OFFLINE",
  );
});

test("invited participant with no confirmed history resolves to INVITED_NOT_CONNECTED", () => {
  assert.equal(resolve({}).state, "INVITED_NOT_CONNECTED");
});

test("reconnect during grace resolves to active location", () => {
  assert.equal(
    resolve({
      joinedAt: ago(60_000),
      lastSeenAt: ago(1_000),
      sessionConnections: [
        sessionConnection({
          disconnectedAt: ago(10_000),
          expiresAt: ago(10_000),
        }),
      ],
    }).state,
    "IN_LOBBY",
  );
});

test("simultaneous stale lobby and newer Session evidence resolves deterministically", () => {
  assert.equal(
    resolve({
      joinedAt: ago(60_000),
      lastSeenAt: ago(10_000),
      sessionConnections: [
        sessionConnection({
          updatedAt: ago(1_000),
        }),
      ],
    }).state,
    "IN_SESSION",
  );
});

test("simultaneous stale Session and newer lobby evidence resolves to IN_LOBBY", () => {
  assert.equal(
    resolve({
      joinedAt: ago(60_000),
      lastSeenAt: ago(1_000),
      sessionConnections: [
        sessionConnection({
          updatedAt: ago(10_000),
        }),
      ],
    }).state,
    "IN_LOBBY",
  );
});

test("superseded revoked and disconnected terminal records are recent away evidence", () => {
  for (const terminalField of ["supersededAt", "revokedAt", "disconnectedAt"] as const) {
    assert.equal(
      resolve({
        sessionConnections: [
          sessionConnection({
            [terminalField]: ago(1_000),
          }),
        ],
      }).state,
      "TEMPORARILY_AWAY",
    );
  }
});

test("connection belonging to another Event does not affect this Event", () => {
  assert.equal(
    resolve({
      sessionConnections: [sessionConnection({ eventId: "event-2" })],
      eventId: "event-1",
    }).state,
    "INVITED_NOT_CONNECTED",
  );
});

test("server timestamp injection controls boundary decisions", () => {
  const serverNow = new Date("2026-08-03T10:05:00.000Z");
  assert.equal(
    resolve({
      now: serverNow,
      sessionConnections: [
        sessionConnection({
          disconnectedAt: new Date(serverNow.getTime() - RECENT_MS),
          expiresAt: new Date(serverNow.getTime() - RECENT_MS),
          updatedAt: new Date(serverNow.getTime() - RECENT_MS),
        }),
      ],
    }).state,
    "TEMPORARILY_AWAY",
  );
});
