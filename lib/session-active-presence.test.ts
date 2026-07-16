import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonicalActiveSessionPresenceByUser,
  isActiveSessionPresenceConnection,
} from "@/lib/session-active-presence";

const BASE_NOW = new Date("2026-07-16T14:00:00.000Z");

test("four active users are counted as four in-session users", () => {
  const canonical = getCanonicalActiveSessionPresenceByUser([
    {
      userId: "u1",
      sessionId: "s1",
      sessionTitle: "Session 1",
      disconnectedAt: null,
      revokedAt: null,
      supersededAt: null,
      expiresAt: new Date("2026-07-16T14:01:00.000Z"),
      updatedAt: new Date("2026-07-16T13:59:10.000Z"),
    },
    {
      userId: "u2",
      sessionId: "s1",
      sessionTitle: "Session 1",
      disconnectedAt: null,
      revokedAt: null,
      supersededAt: null,
      expiresAt: new Date("2026-07-16T14:01:00.000Z"),
      updatedAt: new Date("2026-07-16T13:59:11.000Z"),
    },
    {
      userId: "u3",
      sessionId: "s2",
      sessionTitle: "Session 2",
      disconnectedAt: null,
      revokedAt: null,
      supersededAt: null,
      expiresAt: new Date("2026-07-16T14:01:00.000Z"),
      updatedAt: new Date("2026-07-16T13:59:12.000Z"),
    },
    {
      userId: "u4",
      sessionId: "s2",
      sessionTitle: "Session 2",
      disconnectedAt: null,
      revokedAt: null,
      supersededAt: null,
      expiresAt: new Date("2026-07-16T14:01:00.000Z"),
      updatedAt: new Date("2026-07-16T13:59:13.000Z"),
    },
  ], BASE_NOW);

  assert.equal(canonical.size, 4);
});

test("explicit disconnect row is excluded", () => {
  assert.equal(
    isActiveSessionPresenceConnection(
      {
        userId: "u1",
        sessionId: "s1",
        disconnectedAt: new Date("2026-07-16T14:00:01.000Z"),
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T14:00:01.000Z"),
      },
      BASE_NOW,
    ),
    false,
  );
});

test("four users with one explicit disconnect results in three active users", () => {
  const canonical = getCanonicalActiveSessionPresenceByUser(
    [
      {
        userId: "u1",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:10.000Z"),
      },
      {
        userId: "u2",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:11.000Z"),
      },
      {
        userId: "u3",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:12.000Z"),
      },
      {
        userId: "u4",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: new Date("2026-07-16T13:59:59.000Z"),
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:59.000Z"),
      },
    ],
    BASE_NOW,
  );

  assert.equal(canonical.size, 3);
});

test("expired row is excluded", () => {
  assert.equal(
    isActiveSessionPresenceConnection(
      {
        userId: "u1",
        sessionId: "s1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T13:59:59.000Z"),
        updatedAt: new Date("2026-07-16T13:59:58.000Z"),
      },
      BASE_NOW,
    ),
    false,
  );
});

test("four users with one expired connection results in three active users", () => {
  const canonical = getCanonicalActiveSessionPresenceByUser(
    [
      {
        userId: "u1",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:10.000Z"),
      },
      {
        userId: "u2",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:11.000Z"),
      },
      {
        userId: "u3",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:12.000Z"),
      },
      {
        userId: "u4",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T13:59:59.000Z"),
        updatedAt: new Date("2026-07-16T13:59:58.000Z"),
      },
    ],
    BASE_NOW,
  );

  assert.equal(canonical.size, 3);
});

test("superseded row is excluded", () => {
  assert.equal(
    isActiveSessionPresenceConnection(
      {
        userId: "u1",
        sessionId: "s1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: new Date("2026-07-16T14:00:00.000Z"),
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:58.000Z"),
      },
      BASE_NOW,
    ),
    false,
  );
});

test("revoked row is excluded", () => {
  assert.equal(
    isActiveSessionPresenceConnection(
      {
        userId: "u1",
        sessionId: "s1",
        disconnectedAt: null,
        revokedAt: new Date("2026-07-16T14:00:00.000Z"),
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:58.000Z"),
      },
      BASE_NOW,
    ),
    false,
  );
});

test("duplicate tabs count as one using newest active connection", () => {
  const canonical = getCanonicalActiveSessionPresenceByUser(
    [
      {
        userId: "u1",
        sessionId: "s1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:00:50.000Z"),
        updatedAt: new Date("2026-07-16T13:59:30.000Z"),
      },
      {
        userId: "u1",
        sessionId: "s2",
        sessionTitle: "Session 2",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:20.000Z"),
        updatedAt: new Date("2026-07-16T13:59:45.000Z"),
      },
    ],
    BASE_NOW,
  );

  assert.equal(canonical.size, 1);
  assert.equal(canonical.get("u1")?.sessionId, "s2");
});

test("f5-style active lease remains counted until expiry", () => {
  const connection = {
    userId: "u1",
    sessionId: "s1",
    disconnectedAt: null,
    revokedAt: null,
    supersededAt: null,
    expiresAt: new Date("2026-07-16T14:00:10.000Z"),
    updatedAt: new Date("2026-07-16T13:59:55.000Z"),
  };

  assert.equal(
    isActiveSessionPresenceConnection(connection, new Date("2026-07-16T14:00:05.000Z")),
    true,
  );
  assert.equal(
    isActiveSessionPresenceConnection(connection, new Date("2026-07-16T14:00:11.000Z")),
    false,
  );
});
