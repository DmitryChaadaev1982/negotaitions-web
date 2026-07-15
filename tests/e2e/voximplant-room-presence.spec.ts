import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  disconnectRoomConnection,
  expireRoomConnection,
  getRoomConnectionByConnectionId,
  query,
  revokeRoomConnection,
} from "./helpers/db";

// Stage 3.10 traceability:
// ST310-PRESENCE-001..010, ST310-ROOM-001..005, ST310-NAV-001, ST310-RACE-002..005

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createUserSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [id("sess"), userId, tokenHash, expiresAt],
  );
  return rawToken;
}

async function createActiveUser(email: string, name: string) {
  const userId = id("user");
  await query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', $3, 'USER', 'ACTIVE', NOW())`,
    [userId, email, name],
  );
  return userId;
}

async function createPresenceFixture() {
  const kase = await createE2eCase();
  const facilitatorUserId = await createActiveUser(
    `vox-presence-facilitator-${Date.now()}@test.invalid`,
    "Presence Facilitator",
  );
  const sessionId = `e2e-vox-presence-${Date.now()}`;
  const participantUserId = await createActiveUser(
    `vox-presence-participant-${Date.now()}@test.invalid`,
    "Presence Participant",
  );
  const observerUserId = await createActiveUser(
    `vox-presence-observer-${Date.now()}@test.invalid`,
    "Presence Observer",
  );

  await query(
    `INSERT INTO "Session"
      ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
       "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
       "preparationDurationSeconds", "durationSeconds", "updatedAt")
    VALUES ($1, $2, $3, 'E2E Vox Presence Session', $4,
       'E2E presence context', 'E2E presence instructions', 'EN', 300, 900, NOW())`,
    [sessionId, kase.id, facilitatorUserId, kase.title],
  );

  const facilitatorParticipantId = id("sp");
  const participantParticipantId = id("sp");
  const observerParticipantId = id("sp");
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'FACILITATOR',$4,'Presence Facilitator',NOW(),NOW(),NOW())`,
    [facilitatorParticipantId, sessionId, facilitatorUserId, `presence-fac-${Date.now()}`],
  );
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'PARTICIPANT',$4,'Presence Participant',NOW(),NOW(),NOW())`,
    [participantParticipantId, sessionId, participantUserId, `presence-part-${Date.now()}`],
  );
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'OBSERVER',$4,'Presence Observer',NOW(),NOW(),NOW())`,
    [observerParticipantId, sessionId, observerUserId, `presence-obs-${Date.now()}`],
  );

  return {
    sessionId,
    facilitatorParticipantId,
    participantParticipantId,
    observerParticipantId,
    facilitatorCookie: await createUserSession(facilitatorUserId),
    participantCookie: await createUserSession(participantUserId),
    observerCookie: await createUserSession(observerUserId),
  };
}

function cookieHeader(rawToken: string) {
  return { Cookie: `auth_session=${rawToken}` };
}

test.describe("Vox room presence lease policy", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: Awaited<ReturnType<typeof createPresenceFixture>>;

  test.beforeAll(async () => {
    fixture = await createPresenceFixture();
  });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  test("newest same-login connection replaces previous one", async ({ request }) => {
    const headers = cookieHeader(fixture.facilitatorCookie);
    const sessionId = fixture.sessionId;
    const participantId = fixture.facilitatorParticipantId;

    const claimA = await request.get(
      `/api/livekit/sidebar?participantId=${participantId}&connectionId=lease-A&claimLease=1`,
      { headers },
    );
    expect(claimA.ok()).toBeTruthy();

    const claimB = await request.get(
      `/api/livekit/sidebar?participantId=${participantId}&connectionId=lease-B&claimLease=1`,
      { headers },
    );
    expect(claimB.ok()).toBeTruthy();

    const staleState = await request.get(
      `/api/sessions/${sessionId}/control-state?participantId=${participantId}&connectionId=lease-A`,
      { headers },
    );
    expect(staleState.status()).toBe(409);
    const staleBody = (await staleState.json()) as { code?: string };
    expect(staleBody.code).toBe("STALE_CONNECTION");

    const activeState = await request.get(
      `/api/sessions/${sessionId}/control-state?participantId=${participantId}&connectionId=lease-B`,
      { headers },
    );
    expect(activeState.ok()).toBeTruthy();
  });

  test("stale facilitator connection cannot execute control actions", async ({ request }) => {
    const headers = cookieHeader(fixture.facilitatorCookie);

    const staleControl = await request.post(`/api/sessions/${fixture.sessionId}/control`, {
      headers,
      data: {
        participantId: fixture.facilitatorParticipantId,
        connectionId: "lease-A",
        action: "START",
      },
    });
    expect(staleControl.status()).toBe(409);
    const staleBody = (await staleControl.json()) as { code?: string };
    expect(staleBody.code).toBe("STALE_CONNECTION");

    const activeControl = await request.post(`/api/sessions/${fixture.sessionId}/control`, {
      headers,
      data: {
        participantId: fixture.facilitatorParticipantId,
        connectionId: "lease-B",
        action: "START",
      },
    });
    expect(activeControl.ok()).toBeTruthy();
  });

  test("stale connection cannot send heartbeat after takeover", async ({ request }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };

    const staleHeartbeat = await request.post(
      `/api/sessions/${fixture.sessionId}/heartbeat`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: "lease-A",
        },
      },
    );
    expect(staleHeartbeat.status()).toBe(409);

    const activeHeartbeat = await request.post(
      `/api/sessions/${fixture.sessionId}/heartbeat`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: "lease-B",
        },
      },
    );
    expect(activeHeartbeat.ok()).toBeTruthy();
  });

  test("validate-only calls do not renew lease expiry", async ({ request }) => {
    const headers = cookieHeader(fixture.facilitatorCookie);
    const sessionId = fixture.sessionId;
    const participantId = fixture.facilitatorParticipantId;
    const connectionId = "lease-no-renew";

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${participantId}&connectionId=${connectionId}&claimLease=1`,
      { headers },
    );
    expect(claim.ok()).toBeTruthy();

    const before = await getRoomConnectionByConnectionId(connectionId);
    expect(before).not.toBeNull();

    const validateOnly = await request.get(
      `/api/sessions/${sessionId}/control-state?participantId=${participantId}&connectionId=${connectionId}`,
      { headers },
    );
    expect(validateOnly.ok()).toBeTruthy();

    const after = await getRoomConnectionByConnectionId(connectionId);
    expect(after).not.toBeNull();
    expect(new Date(after!.expiresAt).getTime()).toBe(
      new Date(before!.expiresAt).getTime(),
    );
  });

  test("heartbeat renews lease expiry for active connection", async ({ request }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const connectionId = "lease-heartbeat-renew";

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claim.ok()).toBeTruthy();

    const before = await getRoomConnectionByConnectionId(connectionId);
    expect(before).not.toBeNull();
    await query(`SELECT pg_sleep(0.02)`);

    const heartbeat = await request.post(
      `/api/sessions/${fixture.sessionId}/heartbeat`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId,
        },
      },
    );
    expect(heartbeat.ok()).toBeTruthy();

    const after = await getRoomConnectionByConnectionId(connectionId);
    expect(after).not.toBeNull();
    expect(new Date(after!.expiresAt).getTime()).toBeGreaterThan(
      new Date(before!.expiresAt).getTime(),
    );
  });

  test("expired, disconnected, or revoked connections are rejected", async ({ request }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };

    const scenarios = [
      {
        id: "lease-expired",
        mutate: expireRoomConnection,
      },
      {
        id: "lease-disconnected",
        mutate: disconnectRoomConnection,
      },
      {
        id: "lease-revoked",
        mutate: revokeRoomConnection,
      },
    ] as const;

    for (const scenario of scenarios) {
      const claim = await request.get(
        `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${scenario.id}&claimLease=1`,
        { headers: cookieHeader(fixture.facilitatorCookie) },
      );
      expect(claim.ok()).toBeTruthy();

      await scenario.mutate(scenario.id);

      const state = await request.get(
        `/api/sessions/${fixture.sessionId}/control-state?participantId=${fixture.facilitatorParticipantId}&connectionId=${scenario.id}`,
        { headers: cookieHeader(fixture.facilitatorCookie) },
      );
      expect(state.status()).toBe(409);
      const stateBody = (await state.json()) as { code?: string };
      expect(stateBody.code).toBe("STALE_CONNECTION");

      const heartbeat = await request.post(
        `/api/sessions/${fixture.sessionId}/heartbeat`,
        {
          headers,
          data: {
            participantId: fixture.facilitatorParticipantId,
            connectionId: scenario.id,
          },
        },
      );
      expect(heartbeat.status()).toBe(409);
      const staleBody = (await heartbeat.json()) as { code?: string };
      expect(staleBody.code).toBe("STALE_CONNECTION");
    }
  });

  test("stale connection cannot publish media status after takeover", async ({ request }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const staleConnectionId = "media-stale-old";
    const activeConnectionId = "media-stale-new";

    const claimA = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${staleConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claimA.ok()).toBeTruthy();

    const claimB = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${activeConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claimB.ok()).toBeTruthy();

    const stalePublish = await request.post(
      `/api/sessions/${fixture.sessionId}/media-status`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: staleConnectionId,
          micEnabled: false,
          cameraEnabled: false,
        },
      },
    );
    expect(stalePublish.status()).toBe(409);
    const staleBody = (await stalePublish.json()) as { code?: string };
    expect(staleBody.code).toBe("STALE_CONNECTION");

    const activePublish = await request.post(
      `/api/sessions/${fixture.sessionId}/media-status`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: activeConnectionId,
          micEnabled: true,
          cameraEnabled: true,
        },
      },
    );
    expect(activePublish.ok()).toBeTruthy();
  });

  test("explicit leave closes last DEBRIEF_OPEN connection atomically", async ({
    request,
  }) => {
    const localFixture = await createPresenceFixture();
    const headers = {
      ...cookieHeader(localFixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const connectionId = "lease-explicit-leave-close";

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${localFixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers: cookieHeader(localFixture.facilitatorCookie) },
    );
    expect(claim.ok()).toBeTruthy();

    await query(
      `UPDATE "Session" SET "roomLifecycle" = 'DEBRIEF_OPEN'::"RoomLifecycle", "updatedAt" = NOW() WHERE "id" = $1`,
      [localFixture.sessionId],
    );

    const leave = await request.post(
      `/api/sessions/${localFixture.sessionId}/presence/leave`,
      {
        headers,
        data: {
          participantId: localFixture.facilitatorParticipantId,
          connectionId,
        },
      },
    );
    expect(leave.ok()).toBeTruthy();
    const body = (await leave.json()) as { disconnected: boolean; roomClosed: boolean };
    expect(body.disconnected).toBe(true);
    expect(body.roomClosed).toBe(true);

    const conn = await getRoomConnectionByConnectionId(connectionId);
    expect(conn?.disconnectedAt).not.toBeNull();
    const state = await query<{ roomLifecycle: string | null }>(
      `SELECT "roomLifecycle" FROM "Session" WHERE "id" = $1`,
      [localFixture.sessionId],
    );
    expect(state[0]?.roomLifecycle).toBe("CLOSED");
  });

  test("explicit participant leave disconnects only participant and keeps session RUNNING", async ({
    request,
  }) => {
    const participantHeaders = {
      ...cookieHeader(fixture.participantCookie),
      "Content-Type": "application/json",
    };
    const facilitatorHeaders = cookieHeader(fixture.facilitatorCookie);
    const participantConnectionId = "lease-participant-leave";
    const facilitatorConnectionId = "lease-facilitator-stays";

    const participantClaim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.participantParticipantId}&connectionId=${participantConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.participantCookie) },
    );
    expect(participantClaim.ok()).toBeTruthy();

    const facilitatorClaim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${facilitatorConnectionId}&claimLease=1`,
      { headers: facilitatorHeaders },
    );
    expect(facilitatorClaim.ok()).toBeTruthy();

    const leave = await request.post(
      `/api/sessions/${fixture.sessionId}/presence/leave`,
      {
        headers: participantHeaders,
        data: {
          participantId: fixture.participantParticipantId,
          connectionId: participantConnectionId,
        },
      },
    );
    expect(leave.ok()).toBeTruthy();
    const leaveBody = (await leave.json()) as { disconnected: boolean };
    expect(leaveBody.disconnected).toBe(true);

    const participantConn = await getRoomConnectionByConnectionId(participantConnectionId);
    const facilitatorConn = await getRoomConnectionByConnectionId(facilitatorConnectionId);
    expect(participantConn?.disconnectedAt).not.toBeNull();
    expect(facilitatorConn?.disconnectedAt).toBeNull();

    const state = await query<{ negotiationState: string; roomLifecycle: string | null }>(
      `SELECT "negotiationState", "roomLifecycle" FROM "Session" WHERE "id" = $1`,
      [fixture.sessionId],
    );
    expect(state[0]?.negotiationState).not.toBe("FINISHED");
    expect(state[0]?.roomLifecycle === "OPEN" || state[0]?.roomLifecycle === null).toBeTruthy();
  });

  test("explicit observer leave disconnects only observer connection", async ({
    request,
  }) => {
    const observerHeaders = {
      ...cookieHeader(fixture.observerCookie),
      "Content-Type": "application/json",
    };
    const observerConnectionId = "lease-observer-leave";

    const observerClaim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.observerParticipantId}&connectionId=${observerConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.observerCookie) },
    );
    expect(observerClaim.ok()).toBeTruthy();

    const leave = await request.post(
      `/api/sessions/${fixture.sessionId}/presence/leave`,
      {
        headers: observerHeaders,
        data: {
          participantId: fixture.observerParticipantId,
          connectionId: observerConnectionId,
        },
      },
    );
    expect(leave.ok()).toBeTruthy();
    const leaveBody = (await leave.json()) as { disconnected: boolean };
    expect(leaveBody.disconnected).toBe(true);

    const observerConn = await getRoomConnectionByConnectionId(observerConnectionId);
    expect(observerConn?.disconnectedAt).not.toBeNull();
  });

  test("explicit facilitator leave does not finish session and duplicate leave is idempotent", async ({
    request,
  }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const connectionId = "lease-facilitator-explicit";

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claim.ok()).toBeTruthy();

    const firstLeave = await request.post(
      `/api/sessions/${fixture.sessionId}/presence/leave`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId,
        },
      },
    );
    expect(firstLeave.ok()).toBeTruthy();
    const firstBody = (await firstLeave.json()) as {
      disconnected: boolean;
      alreadyFinalized: boolean;
    };
    expect(firstBody.disconnected).toBe(true);
    expect(firstBody.alreadyFinalized).toBe(false);

    const secondLeave = await request.post(
      `/api/sessions/${fixture.sessionId}/presence/leave`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId,
        },
      },
    );
    expect(secondLeave.ok()).toBeTruthy();
    const secondBody = (await secondLeave.json()) as {
      disconnected: boolean;
      alreadyFinalized: boolean;
    };
    expect(secondBody.disconnected).toBe(false);
    expect(secondBody.alreadyFinalized).toBe(true);

    const state = await query<{ negotiationState: string }>(
      `SELECT "negotiationState" FROM "Session" WHERE "id" = $1`,
      [fixture.sessionId],
    );
    expect(state[0]?.negotiationState).not.toBe("FINISHED");
  });

  test("explicit leave race with heartbeat keeps stale semantics safe", async ({
    request,
  }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const connectionId = "lease-leave-heartbeat-race";
    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claim.ok()).toBeTruthy();

    const [leave, heartbeat] = await Promise.all([
      request.post(`/api/sessions/${fixture.sessionId}/presence/leave`, {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId,
        },
      }),
      request.post(`/api/sessions/${fixture.sessionId}/heartbeat`, {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId,
        },
      }),
    ]);
    expect(leave.ok()).toBeTruthy();
    expect([200, 409]).toContain(heartbeat.status());

    const conn = await getRoomConnectionByConnectionId(connectionId);
    expect(conn?.disconnectedAt).not.toBeNull();
  });

  test("explicit leave racing reconnect keeps newer connection active", async ({
    request,
  }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const oldConnectionId = "lease-race-old";
    const newConnectionId = "lease-race-new";

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${oldConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claim.ok()).toBeTruthy();

    const [leave, reconnect] = await Promise.all([
      request.post(`/api/sessions/${fixture.sessionId}/presence/leave`, {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: oldConnectionId,
        },
      }),
      request.get(
        `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${newConnectionId}&claimLease=1`,
        { headers: cookieHeader(fixture.facilitatorCookie) },
      ),
    ]);
    expect(leave.ok()).toBeTruthy();
    expect(reconnect.ok()).toBeTruthy();

    const oldConn = await getRoomConnectionByConnectionId(oldConnectionId);
    const newConn = await getRoomConnectionByConnectionId(newConnectionId);
    expect(oldConn?.disconnectedAt || oldConn?.supersededAt).not.toBeNull();
    expect(newConn?.disconnectedAt).toBeNull();
    expect(newConn?.supersededAt).toBeNull();
  });

  test("refresh semantics: no explicit leave call means row stays non-disconnected", async ({
    request,
  }) => {
    const headers = cookieHeader(fixture.facilitatorCookie);
    const connectionId = "lease-refresh-semantic";

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers },
    );
    expect(claim.ok()).toBeTruthy();

    await query(`SELECT pg_sleep(0.1)`);

    // Simulate refresh/remount path without explicit /presence/leave.
    const reloadClaim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers },
    );
    expect(reloadClaim.ok()).toBeTruthy();

    const conn = await getRoomConnectionByConnectionId(connectionId);
    expect(conn?.disconnectedAt).toBeNull();
  });

  test("explicit leave does not close OPEN and stale tab cannot disconnect replacement", async ({
    request,
  }) => {
    const headers = {
      ...cookieHeader(fixture.facilitatorCookie),
      "Content-Type": "application/json",
    };
    const oldConnectionId = "lease-explicit-old";
    const newConnectionId = "lease-explicit-new";

    const claimOld = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${oldConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claimOld.ok()).toBeTruthy();

    const claimNew = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=${newConnectionId}&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(claimNew.ok()).toBeTruthy();

    await query(
      `UPDATE "Session" SET "roomLifecycle" = 'OPEN'::"RoomLifecycle", "updatedAt" = NOW() WHERE "id" = $1`,
      [fixture.sessionId],
    );

    const staleLeave = await request.post(
      `/api/sessions/${fixture.sessionId}/presence/leave`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: oldConnectionId,
        },
      },
    );
    expect(staleLeave.ok()).toBeTruthy();
    const staleBody = (await staleLeave.json()) as {
      disconnected: boolean;
      alreadyFinalized: boolean;
      roomClosed: boolean;
    };
    expect(staleBody.disconnected).toBe(false);
    expect(staleBody.alreadyFinalized).toBe(true);
    expect(staleBody.roomClosed).toBe(false);

    const activeHeartbeat = await request.post(
      `/api/sessions/${fixture.sessionId}/heartbeat`,
      {
        headers,
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: newConnectionId,
        },
      },
    );
    expect(activeHeartbeat.ok()).toBeTruthy();

    const state = await query<{ roomLifecycle: string | null }>(
      `SELECT "roomLifecycle" FROM "Session" WHERE "id" = $1`,
      [fixture.sessionId],
    );
    expect(state[0]?.roomLifecycle).toBe("OPEN");
  });
});
