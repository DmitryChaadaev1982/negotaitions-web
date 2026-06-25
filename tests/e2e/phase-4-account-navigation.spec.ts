import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, createE2eCase, ensureDemoFacilitator, query } from "./helpers/db";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createUser(email: string, name: string, status: "ACTIVE" | "PENDING_APPROVAL" = "ACTIVE") {
  await query(
    `INSERT INTO "User"
      ("id", "email", "passwordHash", "name", "role", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', $3, 'PARTICIPANT', 'USER', $4, NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "status" = $4, "name" = $3, "updatedAt" = NOW()`,
    [uid("user"), email, name, status],
  );
  const rows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [email]);
  return rows[0]!.id;
}

async function createSessionCookie(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO "UserSession" ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [uid("sess"), userId, tokenHash, expiresAt],
  );
  return `auth_session=${rawToken}`;
}

test.describe("Phase 4 account dashboard and tokenless navigation", () => {
  let hostCookie: string;
  let userBCookie: string;
  let pendingCookie: string;
  let eventId: string;
  let sessionId: string;
  let hostToken: string;
  let participantToken: string;
  let joinToken: string;

  test.beforeAll(async () => {
    await cleanupE2eData();
    await query(`DELETE FROM "User" WHERE "email" LIKE '%@phase4.negotaitions'`);

    const facilitator = await ensureDemoFacilitator();
    const negotiationCase = await createE2eCase();
    const hostUserId = await createUser("host@phase4.negotaitions", "Phase4 Host");
    const userBId = await createUser("userb@phase4.negotaitions", "Phase4 User B");
    const pendingId = await createUser("pending@phase4.negotaitions", "Phase4 Pending", "PENDING_APPROVAL");
    hostCookie = await createSessionCookie(hostUserId);
    userBCookie = await createSessionCookie(userBId);
    pendingCookie = await createSessionCookie(pendingId);

    eventId = uid("event");
    sessionId = uid("session");
    hostToken = `phase4-host-${Date.now()}`;
    participantToken = `phase4-participant-${Date.now()}`;
    joinToken = `phase4-join-${Date.now()}`;

    await query(
      `INSERT INTO "TrainingEvent"
        ("id", "title", "status", "publicJoinCode", "hostToken", "hostUserId", "updatedAt")
       VALUES ($1, 'E2E Phase 4 Event', 'LOBBY_OPEN', $2, $3, $4, NOW())`,
      [eventId, `phase4-${Date.now().toString().slice(-8)}`, hostToken, hostUserId],
    );

    const hostEventParticipantId = uid("ep");
    await query(
      `INSERT INTO "EventParticipant"
        ("id", "eventId", "userId", "displayName", "participantToken", "preference",
         "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES
        ($1, $2, $3, 'Phase4 Host', $4, 'FACILITATE', true, false, false, true, NOW(), NOW(), NOW())`,
      [hostEventParticipantId, eventId, hostUserId, participantToken],
    );

    await query(
      `INSERT INTO "Session"
        ("id", "negotiationCaseId", "facilitatorId", "eventId", "title", "snapshotCaseTitle",
         "snapshotCaseLanguage", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, $4, 'E2E Phase 4 Session', 'E2E Phase 4 Case', 'EN', 300, 900, NOW())`,
      [sessionId, negotiationCase.id, facilitator.id, eventId],
    );

    await query(
      `INSERT INTO "SessionParticipant"
        ("id", "sessionId", "userId", "eventParticipantId", "type", "joinToken", "displayName", "notes", "updatedAt")
       VALUES ($1, $2, $3, $4, 'FACILITATOR', $5, 'Phase4 Host', '', NOW())`,
      [uid("sp"), sessionId, hostUserId, hostEventParticipantId, joinToken],
    );
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await query(`DELETE FROM "User" WHERE "email" LIKE '%@phase4.negotaitions'`);
  });

  test("dashboard/events/sessions are scoped and do not leak tokens", async ({ request }) => {
    for (const path of ["/dashboard", "/events", "/sessions"]) {
      const hostResp = await request.get(path, { headers: { Cookie: hostCookie } });
      expect(hostResp.status()).toBe(200);
      const html = await hostResp.text();
      expect(html).not.toContain(hostToken);
      expect(html).not.toContain(participantToken);
      expect(html).not.toContain(joinToken);

      const userBResp = await request.get(path, { headers: { Cookie: userBCookie } });
      expect(userBResp.status()).toBe(200);
      const userBHtml = await userBResp.text();
      expect(userBHtml).not.toContain("E2E Phase 4 Event");
      expect(userBHtml).not.toContain("E2E Phase 4 Session");
    }
  });

  test("tokenless lobby and room work for related user and deny unrelated", async ({ request }) => {
    const lobbyAllowed = await request.get(`/events/${eventId}/lobby`, { headers: { Cookie: hostCookie } });
    expect(lobbyAllowed.status()).toBe(200);
    const roomAllowed = await request.get(`/room/${sessionId}`, { headers: { Cookie: hostCookie } });
    expect(roomAllowed.status()).toBe(200);

    const lobbyDenied = await request.get(`/events/${eventId}/lobby`, { headers: { Cookie: userBCookie } });
    expect([403, 404]).toContain(lobbyDenied.status());
    const roomDenied = await request.get(`/room/${sessionId}`, { headers: { Cookie: userBCookie } });
    expect(roomDenied.status()).toBe(200);
    const roomDeniedHtml = await roomDenied.text();
    expect(roomDeniedHtml).toContain("access");
  });

  test("guest token compatibility remains for lobby and room", async ({ request }) => {
    const guestLobbyHost = await request.get(`/events/${eventId}/lobby?hostToken=${hostToken}`);
    expect(guestLobbyHost.status()).toBe(200);
    const guestLobbyParticipant = await request.get(`/events/${eventId}/lobby?participantToken=${participantToken}`);
    expect(guestLobbyParticipant.status()).toBe(200);
    const guestRoom = await request.get(`/room/${sessionId}?joinToken=${joinToken}`);
    expect(guestRoom.status()).toBe(200);
  });

  test("rejoin routes active user server-side and blocks pending user", async ({ request }) => {
    const activeResp = await request.get("/rejoin", {
      headers: { Cookie: hostCookie },
      maxRedirects: 0,
    });
    expect(activeResp.status()).toBe(307);
    expect(activeResp.headers()["location"]).toContain(`/room/${sessionId}`);

    const pendingResp = await request.get("/rejoin", {
      headers: { Cookie: pendingCookie },
      maxRedirects: 0,
    });
    expect(pendingResp.status()).toBe(307);
    expect(pendingResp.headers()["location"]).toContain("/pending-approval");
  });

  test("participant token cross-claim is rejected", async ({ request }) => {
    const response = await request.get(`/api/events/${eventId}/state?participantToken=${participantToken}`, {
      headers: { Cookie: userBCookie },
    });
    expect(response.status()).toBe(403);
  });
});
