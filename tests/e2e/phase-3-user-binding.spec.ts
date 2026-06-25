import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, createE2eCase, ensureDemoFacilitator, query } from "./helpers/db";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createActiveUser(email: string, name: string) {
  const id = uid("user");
  await query(
    `INSERT INTO "User"
      ("id", "email", "passwordHash", "name", "role", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', $3, 'PARTICIPANT', 'USER', 'ACTIVE', NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "status" = 'ACTIVE', "name" = $3, "updatedAt" = NOW()`,
    [id, email, name],
  );
  const rows = await query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" = $1`,
    [email],
  );
  return rows[0]!.id;
}

async function createUserSessionCookie(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO "UserSession"
      ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [uid("sess"), userId, tokenHash, expiresAt],
  );
  return `auth_session=${rawToken}`;
}

async function cleanupPhase3Users() {
  await query(`DELETE FROM "User" WHERE "email" LIKE '%@phase3.negotaitions'`);
}

test.describe("Phase 3 user binding access model", () => {
  let hostCookie: string;
  let participantCookie: string;
  let unrelatedCookie: string;
  let eventId: string;
  let sessionId: string;
  let participantJoinToken: string;
  let hostJoinToken: string;

  test.beforeAll(async () => {
    await cleanupE2eData();
    await cleanupPhase3Users();

    const hostUserId = await createActiveUser(
      "host@phase3.negotaitions",
      "Phase3 Host",
    );
    const participantUserId = await createActiveUser(
      "participant@phase3.negotaitions",
      "Phase3 Participant",
    );
    const unrelatedUserId = await createActiveUser(
      "unrelated@phase3.negotaitions",
      "Phase3 Stranger",
    );
    hostCookie = await createUserSessionCookie(hostUserId);
    participantCookie = await createUserSessionCookie(participantUserId);
    unrelatedCookie = await createUserSessionCookie(unrelatedUserId);

    const e2eCase = await createE2eCase();
    const demoFacilitator = await ensureDemoFacilitator();
    eventId = uid("event");
    sessionId = uid("session");
    participantJoinToken = `phase3-join-${Date.now()}`;
    hostJoinToken = `phase3-host-join-${Date.now()}`;

    const eventHostToken = `phase3-host-token-${Date.now()}`;
    const publicJoinCode = `phase3-${Date.now().toString().slice(-8)}`;

    await query(
      `INSERT INTO "TrainingEvent"
        ("id", "title", "status", "publicJoinCode", "hostToken", "hostUserId", "updatedAt")
       VALUES ($1, 'E2E Phase 3 Event', 'LOBBY_OPEN', $2, $3, $4, NOW())`,
      [eventId, publicJoinCode, eventHostToken, hostUserId],
    );

    const hostEventParticipantId = uid("ep");
    const participantEventParticipantId = uid("ep");
    await query(
      `INSERT INTO "EventParticipant"
        ("id", "eventId", "userId", "displayName", "participantToken", "preference",
         "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES
        ($1, $3, $4, 'Phase3 Host', $5, 'FACILITATE', true, false, false, true, NOW(), NOW(), NOW()),
        ($2, $3, $6, 'Phase3 Participant', $7, 'PLAY', false, true, false, false, NOW(), NOW(), NOW())`,
      [
        hostEventParticipantId,
        participantEventParticipantId,
        eventId,
        hostUserId,
        `phase3-host-participant-${Date.now()}`,
        participantUserId,
        `phase3-participant-token-${Date.now()}`,
      ],
    );

    await query(
      `INSERT INTO "Session"
        ("id", "negotiationCaseId", "facilitatorId", "eventId", "title", "snapshotCaseTitle",
         "snapshotCaseLanguage", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, $4, 'E2E Phase 3 Session', 'E2E Phase 3 Case', 'EN', 300, 900, NOW())`,
      [sessionId, e2eCase.id, demoFacilitator.id, eventId],
    );

    await query(
      `INSERT INTO "SessionParticipant"
        ("id", "sessionId", "userId", "eventParticipantId", "type", "joinToken", "displayName", "notes", "updatedAt")
       VALUES
        ($1, $4, $5, $2, 'FACILITATOR', $6, 'Phase3 Host', '', NOW()),
        ($3, $4, $7, $8, 'PARTICIPANT', $9, 'Phase3 Participant', '', NOW())`,
      [
        uid("sp"),
        hostEventParticipantId,
        uid("sp"),
        sessionId,
        hostUserId,
        hostJoinToken,
        participantUserId,
        participantEventParticipantId,
        participantJoinToken,
      ],
    );
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await cleanupPhase3Users();
  });

  test("events overview is scoped by relation", async ({ request }) => {
    const hostResp = await request.get("/api/events/overview", {
      headers: { Cookie: hostCookie },
    });
    expect(hostResp.status()).toBe(200);
    const hostBody = (await hostResp.json()) as { events: Array<{ id: string }> };
    expect(hostBody.events.some((event) => event.id === eventId)).toBeTruthy();

    const unrelatedResp = await request.get("/api/events/overview", {
      headers: { Cookie: unrelatedCookie },
    });
    expect(unrelatedResp.status()).toBe(200);
    const unrelatedBody = (await unrelatedResp.json()) as { events: Array<{ id: string }> };
    expect(unrelatedBody.events.some((event) => event.id === eventId)).toBeFalsy();
  });

  test("sessions overview is scoped by relation", async ({ request }) => {
    const participantResp = await request.get("/api/sessions/overview", {
      headers: { Cookie: participantCookie },
    });
    expect(participantResp.status()).toBe(200);
    const participantBody = (await participantResp.json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(participantBody.sessions.some((session) => session.id === sessionId)).toBeTruthy();

    const unrelatedResp = await request.get("/api/sessions/overview", {
      headers: { Cookie: unrelatedCookie },
    });
    expect(unrelatedResp.status()).toBe(200);
    const unrelatedBody = (await unrelatedResp.json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(unrelatedBody.sessions.some((session) => session.id === sessionId)).toBeFalsy();
  });

  test("session scoped APIs allow bound user and reject unrelated user", async ({
    request,
  }) => {
    const allowedPresence = await request.get(`/api/sessions/${sessionId}/presence`, {
      headers: { Cookie: participantCookie },
    });
    expect(allowedPresence.status()).toBe(200);

    const deniedPresence = await request.get(`/api/sessions/${sessionId}/presence`, {
      headers: { Cookie: unrelatedCookie },
    });
    expect(deniedPresence.status()).toBe(403);
  });

  test("facilitator relation can access notes without joinToken", async ({ request }) => {
    const notesResp = await request.get(`/api/sessions/${sessionId}/notes`, {
      headers: { Cookie: hostCookie },
    });
    expect(notesResp.status()).toBe(200);
  });

  test("guest token room flow remains available", async ({ page }) => {
    const resp = await page.goto(`/room/${sessionId}?joinToken=${participantJoinToken}`);
    expect(resp?.status()).not.toBe(401);
    expect(resp?.status()).not.toBe(403);
    expect(resp?.url()).not.toContain("/login");
  });
});
