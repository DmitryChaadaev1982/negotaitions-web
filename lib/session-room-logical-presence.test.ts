import assert from "node:assert/strict";
import test from "node:test";

import { summarizeLogicalPresenceByUser } from "@/lib/session-room-logical-presence";

// CURRENT room presence at an instant. Not publication authorization.

function row(
  overrides: Partial<{
    userId: string;
    connectionId: string;
    leaseVersion: number;
    disconnectedAt: Date | null;
    disconnectedReason: string | null;
    supersededAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
    updatedAt: Date;
  }> = {},
) {
  const now = new Date("2026-07-29T00:00:00.000Z");
  return {
    userId: overrides.userId ?? "user-1",
    connectionId: overrides.connectionId ?? "conn-1",
    leaseVersion: overrides.leaseVersion ?? 1,
    disconnectedAt: overrides.disconnectedAt ?? null,
    disconnectedReason: overrides.disconnectedReason ?? null,
    supersededAt: overrides.supersededAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 60_000),
    updatedAt: overrides.updatedAt ?? now,
  };
}

test("explicit leave marks user logically inactive", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  const summary = summarizeLogicalPresenceByUser(
    [
      row({
        disconnectedAt: new Date("2026-07-28T23:59:30.000Z"),
        disconnectedReason: "EXPLICIT_LEAVE",
        updatedAt: new Date("2026-07-28T23:59:30.000Z"),
      }),
    ],
    now,
  );
  assert.deepEqual(summary.get("user-1"), {
    isActive: false,
    inactiveReason: "EXPLICIT_LEAVE",
    activeConnectionId: null,
  });
});

test("rejoin supersedes old connection and keeps one active", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  const summary = summarizeLogicalPresenceByUser(
    [
      row({
        connectionId: "conn-old",
        leaseVersion: 1,
        supersededAt: new Date("2026-07-28T23:59:00.000Z"),
        updatedAt: new Date("2026-07-28T23:59:00.000Z"),
      }),
      row({
        connectionId: "conn-new",
        leaseVersion: 2,
        updatedAt: new Date("2026-07-28T23:59:05.000Z"),
      }),
    ],
    now,
  );
  assert.deepEqual(summary.get("user-1"), {
    isActive: true,
    inactiveReason: null,
    activeConnectionId: "conn-new",
  });
});

test("expired connection without replacement is inactive", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  const summary = summarizeLogicalPresenceByUser(
    [
      row({
        connectionId: "conn-expired",
        leaseVersion: 3,
        expiresAt: new Date("2026-07-28T23:59:59.000Z"),
        updatedAt: new Date("2026-07-28T23:59:59.000Z"),
      }),
    ],
    now,
  );
  assert.deepEqual(summary.get("user-1"), {
    isActive: false,
    inactiveReason: "EXPIRED",
    activeConnectionId: null,
  });
});

test("multiple users are summarized independently", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  const summary = summarizeLogicalPresenceByUser(
    [
      row({
        userId: "fac",
        connectionId: "fac-1",
        leaseVersion: 2,
      }),
      row({
        userId: "participant",
        connectionId: "part-1",
        leaseVersion: 1,
        disconnectedAt: new Date("2026-07-28T23:58:00.000Z"),
        disconnectedReason: "EXPLICIT_LEAVE",
        updatedAt: new Date("2026-07-28T23:58:00.000Z"),
      }),
    ],
    now,
  );

  assert.deepEqual(summary.get("fac"), {
    isActive: true,
    inactiveReason: null,
    activeConnectionId: "fac-1",
  });
  assert.deepEqual(summary.get("participant"), {
    isActive: false,
    inactiveReason: "EXPLICIT_LEAVE",
    activeConnectionId: null,
  });
});
