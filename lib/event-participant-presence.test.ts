import assert from "node:assert/strict";
import test from "node:test";

import {
  connectionStatusForEventPresenceState,
  resolveEventParticipantPresence,
  type EventParticipantSessionPresenceEvidence,
} from "@/lib/event-participant-presence";
import { derivePresenceBuckets } from "@/lib/event-presence-buckets";
import type { CurrentPresenceSession } from "@/lib/session-current-presence";

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

test("E-P03 live room plus still-fresh Lobby signal resolves to IN_SESSION only", () => {
  const presence = resolve({
    joinedAt: ago(60_000),
    lastSeenAt: ago(1_000),
    sessionConnections: [
      sessionConnection({
        updatedAt: ago(10_000),
      }),
    ],
  });
  assert.equal(presence.state, "IN_SESSION");
  assert.deepEqual(presence.location, {
    kind: "session",
    sessionId: "session-1",
    sessionTitle: "Room 1",
  });
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

test("explicit leave starts the away window at the terminal timestamp, not at expiresAt", () => {
  // The heartbeat had just renewed the lease when the participant left, so the
  // row keeps an expiry a full lease ahead of the real departure.
  const leftAt = ago(RECENT_MS - 1_000);
  const abandonedLease = new Date(leftAt.getTime() + RECENT_MS);

  const stillAway = resolve({
    sessionConnections: [
      sessionConnection({ disconnectedAt: leftAt, expiresAt: abandonedLease }),
    ],
  });
  assert.equal(stillAway.state, "TEMPORARILY_AWAY");
  assert.equal(stillAway.terminalSeenAt?.getTime(), leftAt.getTime());

  // One second later the grace period measured from the departure is spent,
  // even though the abandoned lease has not run out yet.
  const nowAfterGrace = new Date(NOW.getTime() + 1_001);
  const offline = resolve({
    now: nowAfterGrace,
    sessionConnections: [
      sessionConnection({ disconnectedAt: leftAt, expiresAt: abandonedLease }),
    ],
  });
  assert.equal(offline.state, "OFFLINE");
});

test("a stale expiry that outlives an explicit leave does not extend the away window", () => {
  const leftAt = ago(RECENT_MS + 30_000);
  // The lease lapsed long after the departure and is itself inside the window.
  const lapsedLease = ago(1_000);

  const presence = resolve({
    sessionConnections: [
      sessionConnection({ disconnectedAt: leftAt, expiresAt: lapsedLease }),
    ],
  });

  assert.equal(presence.state, "OFFLINE");
  assert.equal(presence.terminalSeenAt?.getTime(), leftAt.getTime());
});

test("network loss with no terminal timestamp stays lease-based", () => {
  const lapsedLease = ago(1_000);
  const presence = resolve({
    sessionConnections: [
      sessionConnection({
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: lapsedLease,
        updatedAt: ago(RECENT_MS),
      }),
    ],
  });

  assert.equal(presence.state, "TEMPORARILY_AWAY");
  assert.equal(presence.terminalSeenAt?.getTime(), lapsedLease.getTime());
});

test("a lease that has not lapsed yet keeps an abruptly lost participant IN_SESSION", () => {
  assert.equal(
    resolve({
      sessionConnections: [
        sessionConnection({
          expiresAt: new Date(NOW.getTime() + 30_000),
          updatedAt: ago(90_000),
        }),
      ],
    }).state,
    "IN_SESSION",
  );
});

test("reconnecting into a Session during the grace window reports the new location", () => {
  const presence = resolve({
    sessionConnections: [
      sessionConnection({
        sessionId: "session-old",
        disconnectedAt: ago(5_000),
      }),
      sessionConnection({
        sessionId: "session-new",
        sessionTitle: "Room 2",
        updatedAt: ago(500),
      }),
    ],
  });

  assert.equal(presence.state, "IN_SESSION");
  assert.deepEqual(presence.location, {
    kind: "session",
    sessionId: "session-new",
    sessionTitle: "Room 2",
  });
});

test("repeating an explicit leave does not move the away window", () => {
  const leftAt = ago(10_000);
  const first = resolve({
    sessionConnections: [sessionConnection({ disconnectedAt: leftAt })],
  });
  // A second leave call is a no-op server-side, so the row is unchanged.
  const second = resolve({
    sessionConnections: [sessionConnection({ disconnectedAt: leftAt })],
  });

  assert.equal(first.state, "TEMPORARILY_AWAY");
  assert.equal(second.terminalSeenAt?.getTime(), first.terminalSeenAt?.getTime());
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

function closedChildSession(): CurrentPresenceSession {
  return {
    status: "COMPLETED",
    negotiationState: "FINISHED",
    roomLifecycle: "CLOSED",
    closedByEventAt: null,
    deletedAt: null,
  };
}

function operableChildSession(): CurrentPresenceSession {
  return {
    status: "READY",
    negotiationState: "RUNNING",
    roomLifecycle: "OPEN",
    closedByEventAt: null,
    deletedAt: null,
  };
}

test("E-P01 current Lobby only is IN_LOBBY and Online", () => {
  const presence = resolve({ joinedAt: ago(10_000), lastSeenAt: ago(1_000) });
  assert.equal(presence.state, "IN_LOBBY");
  assert.equal(connectionStatusForEventPresenceState(presence.state), "ONLINE");
});

test("E-P02 current Session room only is IN_SESSION and Online", () => {
  const presence = resolve({
    sessionConnections: [
      sessionConnection({ session: operableChildSession() }),
    ],
  });
  assert.equal(presence.state, "IN_SESSION");
  assert.equal(connectionStatusForEventPresenceState(presence.state), "ONLINE");
});

test("E-P04 neither Lobby nor room is not Online", () => {
  const presence = resolve({});
  assert.equal(presence.state, "INVITED_NOT_CONNECTED");
  assert.equal(connectionStatusForEventPresenceState(presence.state), "OFFLINE");
});

test("E-P05 stale Lobby presence is Offline unless a current room connection exists", () => {
  const staleLobby = resolve({
    joinedAt: ago(60_000),
    lastSeenAt: ago(30_000),
  });
  assert.notEqual(staleLobby.state, "IN_LOBBY");
  assert.notEqual(connectionStatusForEventPresenceState(staleLobby.state), "ONLINE");

  const roomWins = resolve({
    joinedAt: ago(60_000),
    lastSeenAt: ago(30_000),
    sessionConnections: [
      sessionConnection({ session: operableChildSession() }),
    ],
  });
  assert.equal(roomWins.state, "IN_SESSION");
});

test("E-P06 historical or closed child room connection is not IN_SESSION", () => {
  const presence = resolve({
    sessionConnections: [
      sessionConnection({ session: closedChildSession() }),
    ],
  });
  assert.notEqual(presence.state, "IN_SESSION");
  assert.equal(connectionStatusForEventPresenceState(presence.state), "OFFLINE");
});

test("E-P07 Lobby then Session changes location without a double display", () => {
  const inLobby = resolve({
    joinedAt: ago(20_000),
    lastSeenAt: ago(1_000),
  });
  assert.equal(inLobby.state, "IN_LOBBY");

  const moved = resolve({
    joinedAt: ago(20_000),
    lastSeenAt: ago(1_000),
    sessionConnections: [
      sessionConnection({
        session: operableChildSession(),
        updatedAt: ago(200),
      }),
    ],
  });
  assert.equal(moved.state, "IN_SESSION");
  assert.equal(moved.location.kind, "session");
});

test("E-P08 explicit Session Leave with no Lobby presence is not Online", () => {
  const presence = resolve({
    sessionConnections: [
      sessionConnection({
        disconnectedAt: NOW,
        session: operableChildSession(),
      }),
    ],
  });
  assert.notEqual(presence.state, "IN_SESSION");
  assert.notEqual(presence.state, "IN_LOBBY");
  assert.equal(connectionStatusForEventPresenceState(presence.state), "RECENTLY_DISCONNECTED");
  assert.equal(presence.location.kind, "none");
});

test("E-P09 explicit Session Leave followed by real Lobby entry is IN_LOBBY", () => {
  const presence = resolve({
    joinedAt: ago(60_000),
    lastSeenAt: ago(1_000),
    sessionConnections: [
      sessionConnection({
        disconnectedAt: ago(2_000),
        session: operableChildSession(),
      }),
    ],
  });
  assert.equal(presence.state, "IN_LOBBY");
  assert.equal(connectionStatusForEventPresenceState(presence.state), "ONLINE");
});

test("E-P10 distributed people produce correct locations and Online count 2", () => {
  const buckets = derivePresenceBuckets({
    now: NOW,
    participants: [
      { userId: "user-a", lastSeenAt: ago(1_000) },
      { userId: "user-b", lastSeenAt: null },
      { userId: "user-c", lastSeenAt: ago(60_000) },
    ],
    sessionConnections: [
      {
        ...sessionConnection({ session: operableChildSession() }),
        userId: "user-b",
      },
    ],
  });

  assert.equal(buckets.lobbyCount, 1);
  assert.equal(buckets.inSessionCount, 1);
  assert.equal(buckets.onlineCount, 2);
});

test("E-P11 observer in a child Session is IN_SESSION", () => {
  const presence = resolve({
    sessionConnections: [
      sessionConnection({ session: operableChildSession() }),
    ],
  });
  assert.equal(presence.state, "IN_SESSION");
});

test("E-P12 lastSeenAt-only session heartbeat does not create Event Online", () => {
  const presence = resolve({
    lastSeenAt: null,
    sessionConnections: [],
  });
  assert.notEqual(connectionStatusForEventPresenceState(presence.state), "ONLINE");

  const buckets = derivePresenceBuckets({
    now: NOW,
    participants: [{ userId: "user-a", lastSeenAt: null }],
    sessionConnections: [],
  });
  assert.equal(buckets.onlineCount, 0);
});

test("E-P03 unique Online count stays 1 when Lobby and room overlap", () => {
  const buckets = derivePresenceBuckets({
    now: NOW,
    participants: [{ userId: "user-a", lastSeenAt: ago(1_000) }],
    sessionConnections: [
      sessionConnection({
        userId: "user-a",
        session: operableChildSession(),
      }),
    ],
  });
  assert.equal(buckets.inSessionCount, 1);
  assert.equal(buckets.lobbyCount, 0);
  assert.equal(buckets.onlineCount, 1);
});
