/**
 * Phase 6.7 / 6.7.1 critical manual bug regressions — NegotAItions
 *
 * DB/API-unit coverage here avoids requiring a browser or LiveKit server:
 *   - Account room resolver creates/reuses one SessionParticipant per user.
 *   - Two users in the same public/open session get distinct rows.
 *   - LiveKit token identity is the stable SessionParticipant.id.
 *   - Sidebar roster includes both account participants.
 *   - Case owner/admin manage rules are enforced by helpers.
 *   - Lobby preference schema accepts account-cookie updates without participantToken.
 *
 * Phase 6.7.1 additions (event lobby identity fix):
 *   - Opening a lobby as admin never returns another user's participant.
 *   - currentParticipant is always resolved by eventId + currentUser.id.
 *   - Preference update changes only the current user's own EventParticipant.
 *   - Roster grows when a second user opens the lobby.
 *   - Refreshing the lobby does not duplicate EventParticipant rows.
 *   - Public event lobby creates/reuses participant for current user.
 *   - Private event denies unrelated user without creating a participant.
 *
 * Manual browser validation is still required for camera/video tiles:
 *   BASE_URL=http://localhost:3000 npx playwright test tests/e2e/phase-6-7-manual-bugs.spec.ts
 */

import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "crypto";

import { cleanupE2eData, query } from "./helpers/db";

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: string;
    name?: string;
  };
}

async function createActiveUser(prefix: string, name: string) {
  const id = uid(prefix);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
     VALUES ($1,$2,'hash',$3,'PARTICIPANT','USER','ACTIVE','en',NOW())`,
    [id, email, name],
  );
  return { id, email, name, globalRole: "USER", status: "ACTIVE", preferredLocale: "en" };
}

async function createUserSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,NOW() + INTERVAL '30 days',NOW())`,
    [userId, tokenHash],
  );
  return rawToken;
}

async function createCase(facilitatorId: string) {
  const caseId = uid("case");
  await query(
    `INSERT INTO "NegotiationCase"
       ("id","title","description","businessContext","publicInstructions","targetSkills",
        "difficulty","caseLanguage","defaultPreparationDurationSeconds","defaultDurationSeconds",
        "facilitatorId","createdByUserId","visibility","createdAt","updatedAt")
     VALUES ($1,'E2E Phase 6.7 Case','desc','public ctx','public instructions','skills',
        'MEDIUM','EN',300,900,$2,$2,'PUBLIC',NOW(),NOW())`,
    [caseId, facilitatorId],
  );
  return caseId;
}

async function createPublicSession(facilitatorId: string) {
  const caseId = await createCase(facilitatorId);
  const sessionId = uid("sess");
  await query(
    `INSERT INTO "Session"
       ("id","title","negotiationCaseId","facilitatorId","visibility","status",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","negotiationState","durationSeconds","preparationDurationSeconds",
        "createdAt","updatedAt")
     VALUES ($1,'E2E Phase 6.7 Public Session',$2,$3,'PUBLIC','DRAFT',
        'Case','Ctx','Instructions','EN','PREPARATION',900,300,NOW(),NOW())`,
    [sessionId, caseId, facilitatorId],
  );
  return sessionId;
}

test.describe("Phase 6.7 - account room identity", () => {
  test("two account users get distinct reusable participants, LiveKit identities, and roster rows", async ({ request }) => {
    const userA = await createActiveUser("phase67_a", "Паша");
    const userB = await createActiveUser("phase67_b", "Дмитрий Чаадаев");
    const sessionId = await createPublicSession(userA.id);
    const tokenA = await createUserSession(userA.id);
    const tokenB = await createUserSession(userB.id);

    await expect(
      request.get(`/room/${sessionId}`, {
        headers: { Cookie: `auth_session=${tokenA}` },
      }),
    ).resolves.toBeOK();
    await expect(
      request.get(`/room/${sessionId}`, {
        headers: { Cookie: `auth_session=${tokenB}` },
      }),
    ).resolves.toBeOK();
    await expect(
      request.get(`/room/${sessionId}`, {
        headers: { Cookie: `auth_session=${tokenA}` },
      }),
    ).resolves.toBeOK();

    const rows = await query<{ id: string; userId: string; displayName: string }>(
      `SELECT "id","userId","displayName" FROM "SessionParticipant" WHERE "sessionId"=$1 ORDER BY "createdAt" ASC`,
      [sessionId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([userA.id, userB.id].sort());
    expect(rows.find((row) => row.userId === userA.id)?.displayName).toBe("Паша");
    expect(rows.find((row) => row.userId === userB.id)?.displayName).toBe("Дмитрий Чаадаев");

    const participantA = rows.find((row) => row.userId === userA.id)!;
    const participantB = rows.find((row) => row.userId === userB.id)!;
    const livekitA = await request.post("/api/livekit/token", {
      headers: { Cookie: `auth_session=${tokenA}` },
      data: { participantId: participantA.id },
    });
    const livekitB = await request.post("/api/livekit/token", {
      headers: { Cookie: `auth_session=${tokenB}` },
      data: { participantId: participantB.id },
    });
    expect(livekitA.ok()).toBe(true);
    expect(livekitB.ok()).toBe(true);
    const livekitPayloadA = await livekitA.json() as { token: string; displayName: string };
    const livekitPayloadB = await livekitB.json() as { token: string; displayName: string };

    expect(livekitPayloadA.displayName).toBe("Паша");
    expect(livekitPayloadB.displayName).toBe("Дмитрий Чаадаев");
    expect(decodeJwtPayload(livekitPayloadA.token).sub).toBe(participantA.id);
    expect(decodeJwtPayload(livekitPayloadB.token).sub).toBe(participantB.id);
    expect(decodeJwtPayload(livekitPayloadA.token).sub).not.toBe(
      decodeJwtPayload(livekitPayloadB.token).sub,
    );

    const sidebarResponse = await request.get(
      `/api/livekit/sidebar?participantId=${participantA.id}`,
      { headers: { Cookie: `auth_session=${tokenA}` } },
    );
    expect(sidebarResponse.ok()).toBe(true);
    const sidebar = await sidebarResponse.json() as {
      displayName: string;
      roster: Array<{ id: string }>;
    };
    expect(sidebar.displayName).toBe("Паша");
    expect(sidebar.roster.map((participant) => participant.id).sort()).toEqual(
      [participantA.id, participantB.id].sort(),
    );
  });
});

test.describe("Phase 6.7 - case owner permissions", () => {
  test("owner or admin can manage a case; non-owner cannot", async () => {
    const { canManageCase } = await import("../../lib/case-access");

    const owner = { id: "owner" };
    const other = { id: "other" };
    const admin = { id: "admin" };
    const ownedCase = { createdByUserId: "owner", facilitatorId: "legacy_owner" };
    const legacyCase = { createdByUserId: null, facilitatorId: "owner" };

    expect(canManageCase(owner, ownedCase, false)).toBe(true);
    expect(canManageCase(other, ownedCase, false)).toBe(false);
    expect(canManageCase(admin, ownedCase, true)).toBe(true);
    expect(canManageCase(owner, legacyCase, false)).toBe(true);
  });
});

test.describe("Phase 6.7 - lobby preference account payload", () => {
  test("account user can change own preference without participantToken", async ({ request }) => {
    const user = await createActiveUser("phase67_pref", "Preference User");
    const authToken = await createUserSession(user.id);
    const eventId = uid("event");
    const eventParticipantId = uid("ep");
    await query(
      `INSERT INTO "TrainingEvent"
         ("id","title","hostUserId","visibility","status","publicJoinCode","hostToken","createdAt","updatedAt")
       VALUES ($1,'E2E Phase 6.7 Preference Event',$2,'PUBLIC','LOBBY_OPEN',$3,$4,NOW(),NOW())`,
      [eventId, user.id, uid("join"), uid("host")],
    );
    await query(
      `INSERT INTO "EventParticipant"
         ("id","eventId","userId","displayName","participantToken","preference","createdAt","updatedAt")
       VALUES ($1,$2,$3,'Preference User',$4,'UNDECIDED',NOW(),NOW())`,
      [eventParticipantId, eventId, user.id, uid("participant")],
    );

    const unauthenticated = await request.patch(`/api/events/${eventId}/participant`, {
      data: { preference: "PLAY" },
    });
    expect(unauthenticated.status()).toBe(401);

    const response = await request.patch(`/api/events/${eventId}/participant`, {
      headers: { Cookie: `auth_session=${authToken}` },
      data: { preference: "PLAY" },
    });
    expect(response.ok()).toBe(true);

    const rows = await query<{ preference: string }>(
      `SELECT "preference" FROM "EventParticipant" WHERE "id"=$1`,
      [eventParticipantId],
    );
    expect(rows[0]?.preference).toBe("PLAY");
  });
});

// ---------------------------------------------------------------------------
// Phase 6.7.1 — Event lobby identity fix
// Rule: currentParticipant must always be resolved by eventId + currentUser.id.
//       Never fall back to host/facilitator/first participant.
// ---------------------------------------------------------------------------

/** Insert a minimal TrainingEvent owned by hostUserId. Returns eventId. */
async function createEvent671(
  hostUserId: string,
  opts: {
    visibility?: "PUBLIC" | "PRIVATE";
    withHostParticipant?: boolean;
    hostDisplayName?: string;
  } = {},
) {
  const eventId = uid("event671");
  const visibility = opts.visibility ?? "PUBLIC";
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","hostUserId","facilitatorUserId","visibility","status","publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,'E2E Phase 6.7.1 Event',$2,$2,$3,'LOBBY_OPEN',$4,$5,NOW(),NOW())`,
    [eventId, hostUserId, visibility, uid("join671"), uid("host671")],
  );
  if (opts.withHostParticipant !== false) {
    // Simulate the EventParticipant created when the host created the event.
    const displayName = opts.hostDisplayName ?? "Паша";
    await query(
      `INSERT INTO "EventParticipant"
         ("id","eventId","userId","displayName","participantToken","isHost","preference","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,true,'UNDECIDED',NOW(),NOW())`,
      [uid("ep671_host"), eventId, hostUserId, displayName, uid("pt671_host")],
    );
  }
  return eventId;
}

test.describe("Phase 6.7.1 - event lobby identity (admin must not become host)", () => {
  test("admin opening another user's event lobby gets own participant, not host row", async ({ request }) => {
    // Паша creates the event; Дмитрий (admin) opens the lobby.
    const pasha = await createActiveUser("671_pasha", "Паша");
    const dmitry = await createActiveUser("671_dmitry", "Дмитрий Чаадаев");
    // Make Дмитрий an admin.
    await query(`UPDATE "User" SET "globalRole"='ADMIN' WHERE "id"=$1`, [dmitry.id]);

    const eventId = await createEvent671(pasha.id, { withHostParticipant: true });
    const dmitrySession = await createUserSession(dmitry.id);

    // GET state as Дмитрий — should auto-create participant for Дмитрий.
    const stateRes = await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: `auth_session=${dmitrySession}` },
    });
    expect(stateRes.ok()).toBe(true);
    const state = await stateRes.json() as {
      currentParticipant: { id: string; displayName: string } | null;
      participants: Array<{ id: string; displayName: string; isHost: boolean }>;
    };

    // currentParticipant must be Дмитрий, not Паша.
    expect(state.currentParticipant).not.toBeNull();
    expect(state.currentParticipant?.displayName).toBe("Дмитрий Чаадаев");
    expect(state.currentParticipant?.displayName).not.toBe("Паша");

    // Roster must include both Паша (host) and Дмитрий.
    const names = state.participants.map((p) => p.displayName);
    expect(names).toContain("Паша");
    expect(names).toContain("Дмитрий Чаадаев");

    // DB: exactly one EventParticipant for Дмитрий (no duplicates).
    const dmitryRows = await query<{ id: string; userId: string }>(
      `SELECT "id","userId" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, dmitry.id],
    );
    expect(dmitryRows).toHaveLength(1);
  });

  test("refreshing lobby does not duplicate EventParticipant for admin", async ({ request }) => {
    const pasha = await createActiveUser("671_pasha2", "Паша");
    const dmitry = await createActiveUser("671_dmitry2", "Дмитрий 2");
    await query(`UPDATE "User" SET "globalRole"='ADMIN' WHERE "id"=$1`, [dmitry.id]);

    const eventId = await createEvent671(pasha.id);
    const session = await createUserSession(dmitry.id);

    // Call GET state three times (simulate refresh).
    for (let i = 0; i < 3; i++) {
      const res = await request.get(`/api/events/${eventId}/state`, {
        headers: { Cookie: `auth_session=${session}` },
      });
      expect(res.ok()).toBe(true);
    }

    const rows = await query<{ id: string }>(
      `SELECT "id" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, dmitry.id],
    );
    expect(rows).toHaveLength(1);
  });

  test("preference update changes only current user's EventParticipant", async ({ request }) => {
    const pasha = await createActiveUser("671_pref_pasha", "Паша");
    const dmitry = await createActiveUser("671_pref_dmitry", "Дмитрий Pref");
    await query(`UPDATE "User" SET "globalRole"='ADMIN' WHERE "id"=$1`, [dmitry.id]);

    const eventId = await createEvent671(pasha.id, { withHostParticipant: true });
    const dmitrySession = await createUserSession(dmitry.id);

    // Bootstrap Дмитрий's participant via state GET.
    await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: `auth_session=${dmitrySession}` },
    });

    // Fetch Паша's participant id to check it later.
    const pashaRows = await query<{ id: string; preference: string }>(
      `SELECT "id","preference" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, pasha.id],
    );
    expect(pashaRows).toHaveLength(1);
    const pashaParticipantId = pashaRows[0]!.id;
    const pashaInitialPref = pashaRows[0]!.preference;

    // Дмитрий sets preference to OBSERVE.
    const patchRes = await request.patch(`/api/events/${eventId}/participant`, {
      headers: { Cookie: `auth_session=${dmitrySession}` },
      data: { preference: "OBSERVE" },
    });
    expect(patchRes.ok()).toBe(true);

    // Дмитрий's preference changed.
    const dmitryRows = await query<{ preference: string }>(
      `SELECT "preference" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, dmitry.id],
    );
    expect(dmitryRows[0]?.preference).toBe("OBSERVE");

    // Паша's preference must be unchanged.
    const pashaAfter = await query<{ preference: string }>(
      `SELECT "preference" FROM "EventParticipant" WHERE "id"=$1`,
      [pashaParticipantId],
    );
    expect(pashaAfter[0]?.preference).toBe(pashaInitialPref);
  });

  test("hostOwner opening lobby without token gets own participant (userParticipant lookup)", async ({ request }) => {
    // Паша creates the event and already has isHost participant linked to her userId.
    const pasha = await createActiveUser("671_host_own", "Паша Host");
    const eventId = await createEvent671(pasha.id, {
      withHostParticipant: true,
      hostDisplayName: "Паша Host",
    });
    const pashaSession = await createUserSession(pasha.id);

    // GET state without any token — must resolve Паша's own participant via userId.
    const stateRes = await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: `auth_session=${pashaSession}` },
    });
    expect(stateRes.ok()).toBe(true);
    const state = await stateRes.json() as {
      currentParticipant: { displayName: string } | null;
      isHost: boolean;
    };

    expect(state.currentParticipant?.displayName).toBe("Паша Host");
    expect(state.isHost).toBe(true);

    // No duplicate rows.
    const rows = await query<{ id: string }>(
      `SELECT "id" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, pasha.id],
    );
    expect(rows).toHaveLength(1);
  });

  test("private event denies unrelated user without creating a participant", async ({ request }) => {
    const pasha = await createActiveUser("671_priv_pasha", "Паша Priv");
    const stranger = await createActiveUser("671_priv_stranger", "Stranger");

    const eventId = await createEvent671(pasha.id, { visibility: "PRIVATE", withHostParticipant: true });
    const strangerSession = await createUserSession(stranger.id);

    const stateRes = await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: `auth_session=${strangerSession}` },
    });
    expect(stateRes.status()).toBe(403);

    // No EventParticipant created for stranger.
    const rows = await query<{ id: string }>(
      `SELECT "id" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, stranger.id],
    );
    expect(rows).toHaveLength(0);
  });

  test("account-mode heartbeat updates lastSeenAt for auth user without token", async ({ request }) => {
    // The participant created by createEvent671 has lastSeenAt=NULL.
    // After the heartbeat, it must become non-null.
    const pasha = await createActiveUser("671_hb_pasha", "Паша HB");
    const eventId = await createEvent671(pasha.id, { withHostParticipant: true });
    const pashaSession = await createUserSession(pasha.id);

    // Bootstrap participant (ensureUserEventParticipant finds existing row, no lastSeenAt update).
    await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: `auth_session=${pashaSession}` },
    });

    // Confirm lastSeenAt is null before heartbeat.
    const beforeRows = await query<{ lastSeenAt: unknown }>(
      `SELECT "lastSeenAt" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, pasha.id],
    );
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0]!.lastSeenAt).toBeNull();

    // Heartbeat with no token — account-mode path.
    const hbRes = await request.post(`/api/events/${eventId}/heartbeat`, {
      headers: { Cookie: `auth_session=${pashaSession}` },
      data: {},
    });
    expect(hbRes.ok()).toBe(true);

    // lastSeenAt must now be set (non-null).
    const afterRows = await query<{ lastSeenAt: unknown }>(
      `SELECT "lastSeenAt" FROM "EventParticipant" WHERE "eventId"=$1 AND "userId"=$2`,
      [eventId, pasha.id],
    );
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0]!.lastSeenAt).not.toBeNull();
  });
});
