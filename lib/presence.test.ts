import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PRESENCE_ONLINE_THRESHOLD_MS,
  PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS,
  buildInitialParticipantPresenceSnapshot,
  parsePresenceSnapshotAt,
  resolveConnectionStatus,
  toParticipantPresenceSnapshot,
} from "@/lib/presence";

const SNAPSHOT_AT = "2026-07-20T08:00:00.000Z";
const SNAPSHOT_MS = Date.parse(SNAPSHOT_AT);

test("parsePresenceSnapshotAt accepts ISO and epoch values", () => {
  assert.equal(parsePresenceSnapshotAt(SNAPSHOT_AT), SNAPSHOT_MS);
  assert.equal(parsePresenceSnapshotAt(SNAPSHOT_MS), SNAPSHOT_MS);
});

test("same reference timestamp gives identical presence classification", () => {
  const lastSeenAt = new Date(
    SNAPSHOT_MS - PRESENCE_ONLINE_THRESHOLD_MS - 1_000,
  ).toISOString();

  const server = buildInitialParticipantPresenceSnapshot(
    { id: "p1", joinedAt: lastSeenAt, lastSeenAt },
    SNAPSHOT_AT,
  );
  const client = buildInitialParticipantPresenceSnapshot(
    { id: "p1", joinedAt: lastSeenAt, lastSeenAt },
    SNAPSHOT_AT,
  );

  assert.deepEqual(server, client);
  assert.equal(server.connectionStatus, "RECENTLY_DISCONNECTED");
});

test("presence thresholds classify values before and after boundaries", () => {
  assert.equal(
    resolveConnectionStatus(
      new Date(SNAPSHOT_MS - PRESENCE_ONLINE_THRESHOLD_MS),
      SNAPSHOT_MS,
    ),
    "ONLINE",
  );
  assert.equal(
    resolveConnectionStatus(
      new Date(SNAPSHOT_MS - PRESENCE_ONLINE_THRESHOLD_MS - 1),
      SNAPSHOT_MS,
    ),
    "RECENTLY_DISCONNECTED",
  );
  assert.equal(
    resolveConnectionStatus(
      new Date(SNAPSHOT_MS - PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS),
      SNAPSHOT_MS,
    ),
    "RECENTLY_DISCONNECTED",
  );
  assert.equal(
    resolveConnectionStatus(
      new Date(SNAPSHOT_MS - PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS - 1),
      SNAPSHOT_MS,
    ),
    "OFFLINE",
  );
});

test("live timestamp can advance after hydration", () => {
  const initialLastSeenAt = new Date(SNAPSHOT_MS - 5_000).toISOString();
  const initial = buildInitialParticipantPresenceSnapshot(
    { id: "p1", joinedAt: initialLastSeenAt, lastSeenAt: initialLastSeenAt },
    SNAPSHOT_AT,
  );
  assert.equal(initial.connectionStatus, "ONLINE");

  const liveLastSeenAt = new Date(SNAPSHOT_MS + 60_000);
  const live = toParticipantPresenceSnapshot(
    {
      id: "p1",
      joinedAt: new Date(initialLastSeenAt),
      lastSeenAt: liveLastSeenAt,
    },
    liveLastSeenAt.getTime(),
  );

  assert.equal(live.connectionStatus, "ONLINE");
  assert.equal(live.lastSeenAt, liveLastSeenAt.toISOString());
});

test("session detail presence wiring avoids hydration-sensitive Date.now", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const participantsSource = readFileSync(
    path.join(root, "../components/participants-table.tsx"),
    "utf8",
  );
  const pageSource = readFileSync(
    path.join(root, "../app/(app)/sessions/[id]/page.tsx"),
    "utf8",
  );
  const detailSource = readFileSync(
    path.join(root, "../components/session-detail-view.tsx"),
    "utf8",
  );

  assert.doesNotMatch(participantsSource, /suppressHydrationWarning/);
  assert.match(pageSource, /presenceSnapshotAt/);
  assert.match(detailSource, /presenceSnapshotAt/);
  assert.match(participantsSource, /buildInitialParticipantPresenceSnapshot/);
  assert.doesNotMatch(participantsSource, /isParticipantOnline/);
});

test("participant mapping keeps userId in session detail payload", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const pageSource = readFileSync(
    path.join(root, "../app/(app)/sessions/[id]/page.tsx"),
    "utf8",
  );
  const detailSource = readFileSync(
    path.join(root, "../components/session-detail-view.tsx"),
    "utf8",
  );

  assert.match(pageSource, /userId: participant\.userId/);
  assert.match(detailSource, /userId\?: string \| null/);
});
