import assert from "node:assert/strict";
import test from "node:test";

import type { RoomLifecycle, SessionStatus } from "@/app/generated/prisma/client";
import {
  buildInitialSessionCurrentPresenceSnapshot,
  collectCurrentSessionRoomUserIds,
  countUniqueCurrentSessionRoomUsers,
  deriveSessionCurrentPresenceSnapshots,
  isCurrentSessionRoomPresenceConnection,
  isSessionOperableForCurrentRoomPresence,
} from "@/lib/session-current-presence";

const NOW = new Date("2026-08-24T15:00:00.000Z");

function operableSession(overrides: Partial<{
  status: SessionStatus;
  negotiationState: string;
  roomLifecycle: RoomLifecycle | null;
  closedByEventAt: Date | null;
  deletedAt: Date | null;
}> = {}) {
  return {
    status: "READY" as SessionStatus,
    negotiationState: "RUNNING",
    roomLifecycle: "OPEN" as RoomLifecycle,
    closedByEventAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function connection(overrides: Partial<{
  userId: string;
  sessionId: string;
  disconnectedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    userId: "user-1",
    sessionId: "session-1",
    disconnectedAt: null,
    revokedAt: null,
    supersededAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    updatedAt: new Date(NOW.getTime() - 1_000),
    ...overrides,
  };
}

function participant(overrides: Partial<{
  id: string;
  userId: string | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
}> = {}) {
  return {
    id: "participant-1",
    userId: "user-1",
    joinedAt: new Date(NOW.getTime() - 120_000),
    lastSeenAt: new Date(NOW.getTime() - 5_000),
    ...overrides,
  };
}

test("P01 active authoritative SessionRoomConnection is Online", () => {
  const snapshots = deriveSessionCurrentPresenceSnapshots({
    session: operableSession(),
    participants: [participant()],
    connections: [connection()],
    now: NOW,
  });

  assert.equal(snapshots[0]?.isOnline, true);
  assert.equal(snapshots[0]?.connectionStatus, "ONLINE");
  assert.equal(
    countUniqueCurrentSessionRoomUsers([connection()], NOW, operableSession()),
    1,
  );
});

test("P02 explicit Leave is Offline immediately even when lastSeenAt is fresh", () => {
  const snapshots = deriveSessionCurrentPresenceSnapshots({
    session: operableSession(),
    participants: [participant({ lastSeenAt: new Date(NOW.getTime() - 2_000) })],
    connections: [
      connection({
        disconnectedAt: NOW,
      }),
    ],
    now: NOW,
  });

  assert.equal(snapshots[0]?.isOnline, false);
  assert.equal(snapshots[0]?.connectionStatus, "OFFLINE");
  assert.equal(snapshots[0]?.lastSeenAt, new Date(NOW.getTime() - 2_000).toISOString());
});

test("P03 fresh lastSeenAt without a live SessionRoomConnection is Offline", () => {
  const snapshots = deriveSessionCurrentPresenceSnapshots({
    session: operableSession(),
    participants: [participant({ lastSeenAt: NOW })],
    connections: [],
    now: NOW,
  });

  assert.equal(snapshots[0]?.isOnline, false);
  assert.equal(snapshots[0]?.connectionStatus, "OFFLINE");
});

test("P04 live room connection with old lastSeenAt is Online", () => {
  const snapshots = deriveSessionCurrentPresenceSnapshots({
    session: operableSession(),
    participants: [
      participant({ lastSeenAt: new Date(NOW.getTime() - 10 * 60_000) }),
    ],
    connections: [connection()],
    now: NOW,
  });

  assert.equal(snapshots[0]?.isOnline, true);
  assert.equal(snapshots[0]?.connectionStatus, "ONLINE");
});

test("P05 superseded generation only is Offline", () => {
  assert.equal(
    isCurrentSessionRoomPresenceConnection(
      connection({ supersededAt: NOW }),
      NOW,
      operableSession(),
    ),
    false,
  );
});

test("P06 revoked or disconnected connection is Offline", () => {
  assert.equal(
    isCurrentSessionRoomPresenceConnection(
      connection({ revokedAt: NOW }),
      NOW,
      operableSession(),
    ),
    false,
  );
  assert.equal(
    isCurrentSessionRoomPresenceConnection(
      connection({ disconnectedAt: NOW }),
      NOW,
      operableSession(),
    ),
    false,
  );
});

test("P07 expired current lease is Offline", () => {
  assert.equal(
    isCurrentSessionRoomPresenceConnection(
      connection({ expiresAt: NOW }),
      NOW,
      operableSession(),
    ),
    false,
  );
  assert.equal(
    isCurrentSessionRoomPresenceConnection(
      connection({ expiresAt: new Date(NOW.getTime() - 1) }),
      NOW,
      operableSession(),
    ),
    false,
  );
});

test("P08 duplicate valid connections for the same user count as one Online person", () => {
  const userIds = collectCurrentSessionRoomUserIds(
    [
      connection({ expiresAt: new Date(NOW.getTime() + 30_000) }),
      connection({
        sessionId: "session-1",
        expiresAt: new Date(NOW.getTime() + 90_000),
        updatedAt: new Date(NOW.getTime() - 500),
      }),
    ],
    NOW,
    operableSession(),
  );

  assert.deepEqual([...userIds], ["user-1"]);
  assert.equal(
    countUniqueCurrentSessionRoomUsers(
      [
        connection(),
        connection({ expiresAt: new Date(NOW.getTime() + 90_000) }),
      ],
      NOW,
      operableSession(),
    ),
    1,
  );
});

test("P09 facilitator, participant, and observer all count equally", () => {
  const userIds = collectCurrentSessionRoomUserIds(
    [
      connection({ userId: "facilitator" }),
      connection({ userId: "participant" }),
      connection({ userId: "observer" }),
    ],
    NOW,
    operableSession(),
  );

  assert.equal(userIds.size, 3);
  assert.ok(userIds.has("facilitator"));
  assert.ok(userIds.has("participant"));
  assert.ok(userIds.has("observer"));
});

test("P10 terminal Session with historical connection rows has no current Online users", () => {
  const closed = operableSession({
    status: "COMPLETED",
    negotiationState: "FINISHED",
    roomLifecycle: "CLOSED",
  });
  assert.equal(isSessionOperableForCurrentRoomPresence(closed), false);
  assert.equal(
    countUniqueCurrentSessionRoomUsers([connection()], NOW, closed),
    0,
  );

  const snapshots = deriveSessionCurrentPresenceSnapshots({
    session: closed,
    participants: [participant()],
    connections: [connection()],
    now: NOW,
  });
  assert.equal(snapshots[0]?.isOnline, false);
});

test("regression: fresh lastSeenAt plus explicit disconnected lease is not Online", () => {
  const snapshots = deriveSessionCurrentPresenceSnapshots({
    session: operableSession(),
    participants: [
      participant({ lastSeenAt: new Date(NOW.getTime() - 1_000) }),
    ],
    connections: [connection({ disconnectedAt: NOW })],
    now: NOW,
  });

  assert.equal(snapshots[0]?.isOnline, false);
  assert.equal(snapshots[0]?.connectionStatus, "OFFLINE");
  assert.ok(
    NOW.getTime() - Date.parse(snapshots[0]!.lastSeenAt!) < 30_000,
    "lastSeenAt remains a fresh recent-activity field",
  );
});

test("DEBRIEF_OPEN remains operable for current room presence", () => {
  assert.equal(
    isSessionOperableForCurrentRoomPresence(
      operableSession({
        status: "COMPLETED",
        negotiationState: "FINISHED",
        roomLifecycle: "DEBRIEF_OPEN",
      }),
    ),
    true,
  );
});

test("initial session presence snapshot ignores lastSeenAt for Online", () => {
  const snapshot = buildInitialSessionCurrentPresenceSnapshot(
    {
      id: "p1",
      joinedAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      isCurrentlyInRoom: false,
    },
    NOW.toISOString(),
  );

  assert.equal(snapshot.isOnline, false);
  assert.equal(snapshot.connectionStatus, "OFFLINE");
  assert.equal(snapshot.lastSeenAt, NOW.toISOString());
});
