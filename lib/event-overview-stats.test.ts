import assert from "node:assert/strict";
import test from "node:test";

import { derivePresenceBuckets } from "@/lib/event-presence-buckets";
import { replaceEventListWithPollResponse } from "@/lib/events-list-polling";

const NOW = new Date("2026-07-16T14:00:00.000Z");

test("assignment without room connection is counted as zero in-session users", () => {
  const presence = derivePresenceBuckets({
    participants: [
      { userId: "user-a", lastSeenAt: null },
      { userId: "user-b", lastSeenAt: null },
    ],
    sessionConnections: [],
    now: NOW,
  });

  assert.equal(presence.inSessionCount, 0);
});

test("lobby + session overlap classifies user as in-session only", () => {
  const presence = derivePresenceBuckets({
    participants: [{ userId: "user-a", lastSeenAt: new Date("2026-07-16T13:59:40.000Z") }],
    sessionConnections: [
      {
        userId: "user-a",
        sessionId: "session-1",
        sessionTitle: "Session 1",
        disconnectedAt: null,
        revokedAt: null,
        supersededAt: null,
        expiresAt: new Date("2026-07-16T14:01:00.000Z"),
        updatedAt: new Date("2026-07-16T13:59:55.000Z"),
      },
    ],
    now: NOW,
  });

  assert.equal(presence.inSessionCount, 1);
  assert.equal(presence.lobbyCount, 0);
  assert.equal(presence.onlineCount, 1);
});

test("event list polling replaces old counts with latest API response", () => {
  const current = [
    {
      id: "event-1",
      title: "Event 1",
      status: "SESSION_CREATED" as const,
      visibility: "PRIVATE" as const,
      canManage: true,
      scheduledAt: null,
      timeZone: "UTC",
      estimatedDurationSeconds: null,
      publicJoinCode: "join-code",
      primarySessionId: null,
      lobbyParticipantCount: 2,
      sessionCount: 1,
      totalSessions: 1,
      activeSessions: 1,
      finishedSessions: 0,
      participantsInLobby: 0,
      participantsInActiveSessions: 4,
      uniqueParticipantsWithSessions: 4,
      recordingsCount: 0,
      transcriptsCount: 0,
      latestActivityAt: null,
      activeSessionParticipantCount: 4,
      totalSessionParticipantCount: 4,
    },
  ];
  const incoming = [
    {
      ...current[0],
      participantsInActiveSessions: 3,
      activeSessionParticipantCount: 3,
    },
  ];

  const replaced = replaceEventListWithPollResponse(current, incoming);
  assert.equal(replaced[0]?.participantsInActiveSessions, 3);
  assert.equal(replaced[0]?.activeSessionParticipantCount, 3);
});
