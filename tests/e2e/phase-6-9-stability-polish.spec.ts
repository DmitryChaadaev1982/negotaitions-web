/**
 * Phase 6.9 — Stability Polish Patch regression tests — NegotAItions
 *
 * DB/API-unit coverage (no browser required):
 *   1. Admin participant picker: PeoplePicker now excludes selected facilitator,
 *      not currentUser — admin can be invited as player when another is facilitator.
 *   2. Lobby first-load: lobby page redirects unauthenticated users to /login.
 *   3. Lobby status refresh: LOBBY_HEARTBEAT_INTERVAL_MS is 5 s (not 20 s).
 *      resolveConnectionStatusForLobby uses 12 s online threshold.
 *   4. Facilitator session details show all participants' role descriptions;
 *      participant sees only own role; observer sees none.
 *   5. Published AI report is visible to participant via materials/status API.
 *      Participant sees own personal feedback only.
 *      Response contains no rawPrompt / analysisContext / facilitatorNotes.
 *   6. Account room debrief path works without joinToken.
 *   7. Identity guard: lobby always resolves to currentUser's participant.
 *
 * Browser-required tests are stub-noted at the bottom with manual steps.
 *
 * Run:
 *   npx playwright test tests/e2e/phase-6-9-stability-polish.spec.ts
 */

import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "crypto";

import { cleanupE2eData, query } from "./helpers/db";

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createActiveUser(prefix: string, name: string, opts: { admin?: boolean } = {}) {
  const id = uid(prefix);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
     VALUES ($1,$2,'hash',$3,'PARTICIPANT',$4,'ACTIVE','en',NOW())`,
    [id, email, name, opts.admin ? "ADMIN" : "USER"],
  );
  return { id, email, name };
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

async function createEventWithParticipants(
  hostId: string,
  opts: { facilitatorUserId?: string; visibility?: "PUBLIC" | "PRIVATE" } = {},
) {
  const eventId = uid("ev69");
  const visibility = opts.visibility ?? "PUBLIC";
  const facilitatorUserId = opts.facilitatorUserId ?? hostId;
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","hostUserId","facilitatorUserId","visibility","status","publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,'E2E Phase 6.9 Event',$2,$3,$4,'LOBBY_OPEN',$5,$6,NOW(),NOW())`,
    [eventId, hostId, facilitatorUserId, visibility, uid("join69"), uid("host69")],
  );
  // host EventParticipant
  const hostEpId = uid("ep69h");
  await query(
    `INSERT INTO "EventParticipant"
       ("id","eventId","userId","displayName","participantToken","isHost","preference","createdAt","updatedAt")
     VALUES ($1,$2,$3,'Host User',$4,true,'UNDECIDED',NOW(),NOW())`,
    [hostEpId, eventId, hostId, uid("pt69h")],
  );
  return { eventId, hostEpId };
}

async function addEventParticipant(eventId: string, userId: string, displayName: string) {
  const epId = uid("ep69p");
  await query(
    `INSERT INTO "EventParticipant"
       ("id","eventId","userId","displayName","participantToken","isHost","preference","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,false,'UNDECIDED',NOW(),NOW())`,
    [epId, eventId, userId, displayName, uid("pt69p")],
  );
  return epId;
}

async function createCaseWithRoles(facilitatorId: string) {
  const caseId = uid("case69");
  await query(
    `INSERT INTO "NegotiationCase"
       ("id","title","description","businessContext","publicInstructions","targetSkills",
        "difficulty","caseLanguage","defaultPreparationDurationSeconds","defaultDurationSeconds",
        "facilitatorId","createdByUserId","visibility","createdAt","updatedAt")
     VALUES ($1,'E2E Phase 6.9 Case','desc','public ctx','public instructions','skills',
        'MEDIUM','EN',300,900,$2,$2,'PUBLIC',NOW(),NOW())`,
    [caseId, facilitatorId],
  );
  const roleAId = uid("roleA69");
  const roleBId = uid("roleB69");
  await query(
    `INSERT INTO "CaseRole"
       ("id","negotiationCaseId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
     VALUES ($1,$2,'Seller','E2E_PRIVATE_SELLER_ONLY','obj-seller','con-seller','hidden-seller','fallback-seller',0,NOW(),NOW())`,
    [roleAId, caseId],
  );
  await query(
    `INSERT INTO "CaseRole"
       ("id","negotiationCaseId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
     VALUES ($1,$2,'Buyer','E2E_PRIVATE_BUYER_ONLY','obj-buyer','con-buyer','hidden-buyer','fallback-buyer',1,NOW(),NOW())`,
    [roleBId, caseId],
  );
  return { caseId, roleAId, roleBId };
}

async function createSession(
  caseId: string,
  facilitatorId: string,
  eventId: string | null,
  opts: { visibility?: "PUBLIC" | "PRIVATE" } = {},
) {
  const sessionId = uid("sess69");
  await query(
    `INSERT INTO "Session"
       ("id","title","negotiationCaseId","facilitatorId","eventId","visibility","status",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","negotiationState","durationSeconds","preparationDurationSeconds",
        "createdAt","updatedAt")
     VALUES ($1,'E2E Phase 6.9 Session',$2,$3,$4,$5,'DRAFT',
        'Case','public ctx','pub instructions','EN','PREPARATION',900,300,NOW(),NOW())`,
    [sessionId, caseId, facilitatorId, eventId, opts.visibility ?? "PRIVATE"],
  );
  return sessionId;
}

async function addSessionRole(sessionId: string, name: string, sortOrder: number) {
  const roleId = uid("sr69");
  await query(
    `INSERT INTO "SessionRole"
       ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'obj','con','hidden','fallback',$5,NOW(),NOW())`,
    [roleId, sessionId, name, `E2E_PRIVATE_${name.toUpperCase()}_ONLY`, sortOrder],
  );
  return roleId;
}

async function addSessionParticipant(
  sessionId: string,
  userId: string | null,
  displayName: string,
  type: "FACILITATOR" | "PARTICIPANT" | "OBSERVER",
  sessionRoleId: string | null = null,
  eventParticipantId: string | null = null,
) {
  const participantId = uid("sp69");
  const joinToken = uid("jt69");
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","displayName","type","joinToken","sessionRoleId","eventParticipantId","notes","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,''::text,NOW(),NOW())`,
    [participantId, sessionId, userId, displayName, type, joinToken, sessionRoleId, eventParticipantId],
  );
  return { participantId, joinToken };
}

// ---------------------------------------------------------------------------
// Part 1 — Admin participant picker: server-side conflict validation
// ---------------------------------------------------------------------------

test.describe("Phase 6.9 - Part 1: admin participant picker conflict validation", () => {
  /**
   * These tests use the /api/events/[id]/host POST endpoint (same path the
   * lobby uses when creating a session) so they run against the real HTTP stack
   * without needing the Prisma @/ alias to be resolved in the test env.
   */

  test("server rejects facilitator/player same user (facilitatorPlayerConflict)", async ({ request }) => {
    const host = await createActiveUser("p69_host1", "Host One", { admin: true });
    const otherUser = await createActiveUser("p69_other1", "Other One");
    const { eventId, hostEpId } = await createEventWithParticipants(host.id);
    const otherEpId = await addEventParticipant(eventId, otherUser.id, "Other One");
    const { caseId } = await createCaseWithRoles(host.id);
    await query(`UPDATE "TrainingEvent" SET "selectedCaseId"=$1 WHERE "id"=$2`, [caseId, eventId]);

    const roles = await query<{ id: string; name: string }>(
      `SELECT "id","name" FROM "CaseRole" WHERE "negotiationCaseId"=$1 ORDER BY "sortOrder" ASC`,
      [caseId],
    );

    const hostToken = await createUserSession(host.id);

    // Same EP as both facilitator AND player — must be rejected.
    const res = await request.post(`/api/events/${eventId}/host`, {
      headers: { Cookie: `auth_session=${hostToken}` },
      data: {
        facilitatorEventParticipantId: hostEpId,
        roleAssignments: [
          { caseRoleId: roles[0]!.id, eventParticipantId: hostEpId },  // conflict!
          { caseRoleId: roles[1]!.id, eventParticipantId: otherEpId },
        ],
        observerEventParticipantIds: [],
      },
    });
    expect(res.ok()).toBe(false);
    const body = await res.json() as { error?: string };
    // The API returns an error for facilitatorPlayerConflict.
    expect(body.error ?? "").toBeTruthy();
  });

  test("admin as player, different user as facilitator — server allows session creation", async ({ request }) => {
    const admin = await createActiveUser("p69_admin2", "Admin Two", { admin: true });
    const facilitatorUser = await createActiveUser("p69_fac2", "Facilitator Two");
    const thirdUser = await createActiveUser("p69_third2", "Third Two");
    const { eventId, hostEpId: adminEpId } = await createEventWithParticipants(admin.id, {
      facilitatorUserId: facilitatorUser.id,
    });
    const facEpId = await addEventParticipant(eventId, facilitatorUser.id, "Facilitator Two");
    const thirdEpId = await addEventParticipant(eventId, thirdUser.id, "Third Two");
    const { caseId } = await createCaseWithRoles(admin.id);
    await query(`UPDATE "TrainingEvent" SET "selectedCaseId"=$1 WHERE "id"=$2`, [caseId, eventId]);

    const roles = await query<{ id: string; name: string }>(
      `SELECT "id","name" FROM "CaseRole" WHERE "negotiationCaseId"=$1 ORDER BY "sortOrder" ASC`,
      [caseId],
    );

    const adminToken = await createUserSession(admin.id);

    // Facilitator = facUser; admin = player role 0; thirdUser = player role 1 → allowed.
    const res = await request.post(`/api/events/${eventId}/host`, {
      headers: { Cookie: `auth_session=${adminToken}` },
      data: {
        facilitatorEventParticipantId: facEpId,
        roleAssignments: [
          { caseRoleId: roles[0]!.id, eventParticipantId: adminEpId },
          { caseRoleId: roles[1]!.id, eventParticipantId: thirdEpId },
        ],
        observerEventParticipantIds: [],
      },
    });
    expect(res.ok()).toBe(true);

    // Confirm a session was created.
    const created = await query<{ id: string }>(
      `SELECT "id" FROM "Session" WHERE "eventId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
      [eventId],
    );
    expect(created.length).toBeGreaterThan(0);
  });

  test("duplicate user in different roles — server rejects (duplicateUserAssignment)", async ({ request }) => {
    const host = await createActiveUser("p69_dup3", "Dup Host Three");
    const playerUser = await createActiveUser("p69_plyr3", "Player Three");
    const { eventId, hostEpId } = await createEventWithParticipants(host.id);
    // Two EventParticipants for the same userId (simulates duplicate assignment).
    const playerEpId = await addEventParticipant(eventId, playerUser.id, "Player Three");
    const playerEpId2 = await addEventParticipant(eventId, playerUser.id, "Player Three Alt");
    const { caseId } = await createCaseWithRoles(host.id);
    await query(`UPDATE "TrainingEvent" SET "selectedCaseId"=$1 WHERE "id"=$2`, [caseId, eventId]);

    const roles = await query<{ id: string; name: string }>(
      `SELECT "id","name" FROM "CaseRole" WHERE "negotiationCaseId"=$1 ORDER BY "sortOrder" ASC`,
      [caseId],
    );

    const hostToken = await createUserSession(host.id);

    // playerUser appears twice via different EPs — must be rejected.
    const res = await request.post(`/api/events/${eventId}/host`, {
      headers: { Cookie: `auth_session=${hostToken}` },
      data: {
        facilitatorEventParticipantId: hostEpId,
        roleAssignments: [
          { caseRoleId: roles[0]!.id, eventParticipantId: playerEpId },
          { caseRoleId: roles[1]!.id, eventParticipantId: playerEpId2 },
        ],
        observerEventParticipantIds: [],
      },
    });
    expect(res.ok()).toBe(false);
    const body = await res.json() as { error?: string };
    expect(body.error ?? "").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Part 3 — Lobby status refresh: presence constants
// ---------------------------------------------------------------------------

test.describe("Phase 6.9 - Part 3: lobby presence constants", () => {
  test("LOBBY_HEARTBEAT_INTERVAL_MS is 5 seconds (much less than 20 s)", async () => {
    const { LOBBY_HEARTBEAT_INTERVAL_MS } = await import("../../lib/presence");
    expect(LOBBY_HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(5_000);
    expect(LOBBY_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
  });

  test("LOBBY_ONLINE_THRESHOLD_MS is 12 seconds (not the global 30 s)", async () => {
    const { LOBBY_ONLINE_THRESHOLD_MS, PRESENCE_ONLINE_THRESHOLD_MS } = await import("../../lib/presence");
    expect(LOBBY_ONLINE_THRESHOLD_MS).toBeLessThan(PRESENCE_ONLINE_THRESHOLD_MS);
    expect(LOBBY_ONLINE_THRESHOLD_MS).toBeLessThanOrEqual(12_000);
  });

  test("resolveConnectionStatusForLobby marks RECENTLY_DISCONNECTED after LOBBY threshold", async () => {
    const { resolveConnectionStatusForLobby, LOBBY_ONLINE_THRESHOLD_MS } = await import("../../lib/presence");

    // Last seen 1 ms before the lobby online threshold → still ONLINE.
    const justOnline = new Date(Date.now() - LOBBY_ONLINE_THRESHOLD_MS + 1);
    expect(resolveConnectionStatusForLobby(justOnline)).toBe("ONLINE");

    // Last seen 1 ms after the lobby online threshold → RECENTLY_DISCONNECTED.
    const justDisconnected = new Date(Date.now() - LOBBY_ONLINE_THRESHOLD_MS - 1);
    expect(resolveConnectionStatusForLobby(justDisconnected)).toBe("RECENTLY_DISCONNECTED");

    // Null lastSeen → OFFLINE.
    expect(resolveConnectionStatusForLobby(null)).toBe("OFFLINE");
  });

  test("global resolveConnectionStatus still uses 30 s online threshold (room presence unchanged)", async () => {
    const { resolveConnectionStatus, PRESENCE_ONLINE_THRESHOLD_MS } = await import("../../lib/presence");

    // 15 s since last seen — online by global threshold, might be offline by lobby threshold.
    const fifteenSecondsAgo = new Date(Date.now() - 15_000);
    expect(resolveConnectionStatus(fifteenSecondsAgo)).toBe("ONLINE");

    // Exactly at the global threshold boundary.
    const atThreshold = new Date(Date.now() - PRESENCE_ONLINE_THRESHOLD_MS - 1);
    expect(resolveConnectionStatus(atThreshold)).toBe("RECENTLY_DISCONNECTED");
  });
});

// ---------------------------------------------------------------------------
// Part 4 — Facilitator session details role descriptions
// ---------------------------------------------------------------------------

test.describe("Phase 6.9 - Part 4: facilitator session details role visibility", () => {
  test("scopeAssignedParticipantsForFacilitator returns full private instructions", async () => {
    const { scopeAssignedParticipantsForFacilitator } = await import("../../lib/privacy/serializers");

    const participants = [
      {
        id: "ep1",
        displayName: "Alice",
        type: "PARTICIPANT",
        sessionRole: {
          name: "Seller",
          privateInstructions: "SECRET_SELLER_INSTRUCTIONS",
          objectives: "obj",
          constraints: "con",
          hiddenInfo: "hidden",
          fallbackPosition: "fall",
        },
      },
      {
        id: "ep2",
        displayName: "Bob",
        type: "PARTICIPANT",
        sessionRole: {
          name: "Buyer",
          privateInstructions: "SECRET_BUYER_INSTRUCTIONS",
          objectives: "obj2",
          constraints: "con2",
          hiddenInfo: "hidden2",
          fallbackPosition: "fall2",
        },
      },
    ];

    const result = scopeAssignedParticipantsForFacilitator(participants);
    expect(result).toHaveLength(2);
    expect(result[0]!.role.privateInstructions).toBe("SECRET_SELLER_INSTRUCTIONS");
    expect(result[1]!.role.privateInstructions).toBe("SECRET_BUYER_INSTRUCTIONS");
  });

  test("scopeAssignedParticipantsForParticipant returns only own private instructions", async () => {
    const { scopeAssignedParticipantsForParticipant } = await import("../../lib/privacy/serializers");

    const participants = [
      {
        id: "ep1",
        displayName: "Alice",
        type: "PARTICIPANT",
        sessionRole: {
          name: "Seller",
          privateInstructions: "SECRET_SELLER_INSTRUCTIONS",
          objectives: "obj",
          constraints: "con",
          hiddenInfo: "hidden",
          fallbackPosition: "fall",
        },
      },
      {
        id: "ep2",
        displayName: "Bob",
        type: "PARTICIPANT",
        sessionRole: {
          name: "Buyer",
          privateInstructions: "SECRET_BUYER_INSTRUCTIONS",
          objectives: "obj2",
          constraints: "con2",
          hiddenInfo: "hidden2",
          fallbackPosition: "fall2",
        },
      },
    ];

    // Alice (ep1) sees own private instructions; Bob's are hidden.
    const resultAlice = scopeAssignedParticipantsForParticipant(participants, "ep1");
    const aliceEntry = resultAlice.find((p) => p.id === "ep1");
    const bobEntry = resultAlice.find((p) => p.id === "ep2");
    expect(aliceEntry?.role.privateInstructions).toBe("SECRET_SELLER_INSTRUCTIONS");
    // Bob's privateInstructions must be empty/redacted for Alice.
    expect(bobEntry?.role.privateInstructions).toBeFalsy();
  });

  test("scopeAssignedParticipantsForObserver returns no private instructions", async () => {
    const { scopeAssignedParticipantsForObserver } = await import("../../lib/privacy/serializers");

    const participants = [
      {
        id: "ep1",
        displayName: "Alice",
        type: "PARTICIPANT",
        sessionRole: {
          name: "Seller",
          privateInstructions: "SECRET_SELLER_INSTRUCTIONS",
          objectives: "obj",
          constraints: "con",
          hiddenInfo: "hidden",
          fallbackPosition: "fall",
        },
      },
    ];

    const result = scopeAssignedParticipantsForObserver(participants);
    expect(result.every((p) => !p.role.privateInstructions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Part 5 — Published AI report visibility (API-level)
// ---------------------------------------------------------------------------

test.describe("Phase 6.9 - Part 5: AI report visibility for participants", () => {
  test("materials/status returns canView:true and analysisJson when AI is shared", async ({ request }) => {
    const facilitatorUser = await createActiveUser("p69_fac5", "Facilitator Five");
    const participantUser = await createActiveUser("p69_par5", "Participant Five");

    const { caseId } = await createCaseWithRoles(facilitatorUser.id);
    const sessionId = await createSession(caseId, facilitatorUser.id, null, { visibility: "PRIVATE" });
    const sellerRoleId = await addSessionRole(sessionId, "SellerP5", 0);
    await addSessionRole(sessionId, "BuyerP5", 1);

    await addSessionParticipant(
      sessionId,
      facilitatorUser.id,
      "Facilitator Five",
      "FACILITATOR",
    );
    const { participantId: partParticipantId } = await addSessionParticipant(
      sessionId,
      participantUser.id,
      "Participant Five",
      "PARTICIPANT",
      sellerRoleId,
    );

    // Mark session finished so shared report is accessible.
    await query(
      `UPDATE "Session" SET "negotiationState"='FINISHED' WHERE "id"=$1`,
      [sessionId],
    );

    // Create and share an AI analysis.
    const aiId = uid("ai69");
    const sharedAnalysis = JSON.stringify({
      executiveSummary: "Great negotiation",
      overallScore: 8,
      strengths: ["good communication"],
      areasForImprovement: ["be more assertive"],
      negotiationStyle: "collaborative",
      keyMoments: [],
      participantPersonalFeedback: [
        {
          participantId: partParticipantId,
          displayName: "Participant Five",
          summary: "Excellent work",
          strengths: ["listening"],
          improvements: [],
          score: 9,
        },
      ],
    });
    await query(
      `INSERT INTO "AiAnalysis"
         ("id","sessionId","status","analysisJson","sharedAnalysisJson","sharedExecutiveSummary",
          "visibility","executiveSummary","overallScore","createdAt","updatedAt")
       VALUES ($1,$2,'COMPLETED',$3,$3,'Great negotiation','SHARED_WITH_SESSION','Great negotiation',8,NOW(),NOW())`,
      [aiId, sessionId, sharedAnalysis],
    );

    const participantToken = await createUserSession(participantUser.id);
    const statusRes = await request.get(
      `/api/sessions/${sessionId}/materials/status?participantId=${partParticipantId}`,
      { headers: { Cookie: `auth_session=${participantToken}` } },
    );
    expect(statusRes.ok()).toBe(true);

    const statusData = await statusRes.json() as {
      aiAnalysis: {
        canView: boolean;
        analysisJson: unknown;
        visibility: string | null;
        isSharedWithSession: boolean;
        participantPlaceholder: boolean;
        notSharedMessage: string | null;
      };
    };

    expect(statusData.aiAnalysis.canView).toBe(true);
    expect(statusData.aiAnalysis.isSharedWithSession).toBe(true);
    expect(statusData.aiAnalysis.analysisJson).not.toBeNull();
    expect(statusData.aiAnalysis.participantPlaceholder).toBe(false);
    expect(statusData.aiAnalysis.notSharedMessage).toBeNull();
    // visibility must not be exposed to participants.
    expect(statusData.aiAnalysis.visibility).toBeNull();
  });

  test("participant cannot see AI report before it is published", async ({ request }) => {
    const facilitatorUser = await createActiveUser("p69_fac5b", "Facilitator FiveB");
    const participantUser = await createActiveUser("p69_par5b", "Participant FiveB");

    const { caseId } = await createCaseWithRoles(facilitatorUser.id);
    const sessionId = await createSession(caseId, facilitatorUser.id, null, { visibility: "PRIVATE" });
    const sellerRoleId = await addSessionRole(sessionId, "SellerP5B", 0);

    await addSessionParticipant(
      sessionId,
      facilitatorUser.id,
      "Facilitator FiveB",
      "FACILITATOR",
    );
    const { participantId: partParticipantId } = await addSessionParticipant(
      sessionId,
      participantUser.id,
      "Participant FiveB",
      "PARTICIPANT",
      sellerRoleId,
    );

    await query(`UPDATE "Session" SET "negotiationState"='FINISHED' WHERE "id"=$1`, [sessionId]);

    // AI analysis exists but NOT shared.
    const aiId = uid("ai69b");
    await query(
      `INSERT INTO "AiAnalysis"
         ("id","sessionId","status","analysisJson","visibility","executiveSummary","overallScore","createdAt","updatedAt")
       VALUES ($1,$2,'COMPLETED',$3,'FACILITATOR_ONLY','Summary',7,NOW(),NOW())`,
      [aiId, sessionId, JSON.stringify({ executiveSummary: "private" })],
    );

    const participantToken = await createUserSession(participantUser.id);
    const statusRes = await request.get(
      `/api/sessions/${sessionId}/materials/status?participantId=${partParticipantId}`,
      { headers: { Cookie: `auth_session=${participantToken}` } },
    );
    expect(statusRes.ok()).toBe(true);

    const statusData = await statusRes.json() as {
      aiAnalysis: {
        canView: boolean;
        analysisJson: unknown;
        isSharedWithSession: boolean;
        participantPlaceholder: boolean;
        notSharedMessage: string | null;
      };
    };

    expect(statusData.aiAnalysis.canView).toBe(false);
    expect(statusData.aiAnalysis.analysisJson).toBeNull();
    expect(statusData.aiAnalysis.isSharedWithSession).toBe(false);
    expect(statusData.aiAnalysis.participantPlaceholder).toBe(true);
    expect(statusData.aiAnalysis.notSharedMessage).toBeTruthy();
  });

  test("participant cannot see another participant's personal feedback", async ({ request }) => {
    const facilitatorUser = await createActiveUser("p69_fac5c", "Facilitator FiveC");
    const participantA = await createActiveUser("p69_parA5c", "Participant A");
    const participantB = await createActiveUser("p69_parB5c", "Participant B");

    const { caseId } = await createCaseWithRoles(facilitatorUser.id);
    const sessionId = await createSession(caseId, facilitatorUser.id, null, { visibility: "PRIVATE" });
    const sellerRoleId = await addSessionRole(sessionId, "SellerP5C", 0);
    const buyerRoleId = await addSessionRole(sessionId, "BuyerP5C", 1);

    await addSessionParticipant(sessionId, facilitatorUser.id, "Facilitator FiveC", "FACILITATOR");
    const { participantId: partAId } = await addSessionParticipant(
      sessionId,
      participantA.id,
      "Participant A",
      "PARTICIPANT",
      sellerRoleId,
    );
    const { participantId: partBId } = await addSessionParticipant(
      sessionId,
      participantB.id,
      "Participant B",
      "PARTICIPANT",
      buyerRoleId,
    );

    await query(`UPDATE "Session" SET "negotiationState"='FINISHED' WHERE "id"=$1`, [sessionId]);

    // Use sessionParticipantId (the field name filterPersonalFeedbackForParticipant uses).
    const sharedAnalysis = JSON.stringify({
      executiveSummary: "Shared summary",
      overallScore: 7,
      strengths: [],
      areasForImprovement: [],
      negotiationStyle: "competitive",
      keyMoments: [],
      participantPersonalFeedback: [
        {
          sessionParticipantId: partAId,
          participantName: "Participant A",
          summary: "A's private feedback",
          strengths: ["A strength"],
          improvements: [],
          score: 8,
        },
        {
          sessionParticipantId: partBId,
          participantName: "Participant B",
          summary: "B's private feedback",
          strengths: ["B strength"],
          improvements: [],
          score: 7,
        },
      ],
    });

    const aiId = uid("ai69c");
    await query(
      `INSERT INTO "AiAnalysis"
         ("id","sessionId","status","analysisJson","sharedAnalysisJson","sharedExecutiveSummary",
          "visibility","executiveSummary","overallScore","createdAt","updatedAt")
       VALUES ($1,$2,'COMPLETED',$3,$3,'Shared summary','SHARED_WITH_SESSION','Shared summary',7,NOW(),NOW())`,
      [aiId, sessionId, sharedAnalysis],
    );

    // Participant A fetches status — should see own feedback but NOT B's.
    const tokenA = await createUserSession(participantA.id);
    const resA = await request.get(
      `/api/sessions/${sessionId}/materials/status?participantId=${partAId}`,
      { headers: { Cookie: `auth_session=${tokenA}` } },
    );
    expect(resA.ok()).toBe(true);
    const dataA = await resA.json() as {
      aiAnalysis: { analysisJson: unknown };
    };
    const analysisA = dataA.aiAnalysis.analysisJson as {
      participantPersonalFeedback?: Array<{ sessionParticipantId: string }>;
    } | null;

    expect(analysisA).not.toBeNull();
    const feedbackA = analysisA?.participantPersonalFeedback ?? [];
    // Only A's feedback should be present.
    expect(feedbackA.some((f) => f.sessionParticipantId === partAId)).toBe(true);
    expect(feedbackA.some((f) => f.sessionParticipantId === partBId)).toBe(false);
  });

  test("shared AI response for participant contains no rawPrompt/analysisContext/facilitatorNotes", async () => {
    const { sanitizeSharedAiReport, BLOCKED_AI_SHARED_FIELDS } = await import("../../lib/privacy/serializers");

    const mockAnalysis = {
      executiveSummary: "Good session",
      overallScore: 8,
      strengths: ["communication"],
      areasForImprovement: ["pacing"],
      negotiationStyle: "collaborative",
      keyMoments: [],
      participantPersonalFeedback: [],
      rawPrompt: "SHOULD_BE_REMOVED",
      analysisContext: "SHOULD_BE_REMOVED",
      facilitatorNotes: "SHOULD_BE_REMOVED",
    };

    const sanitized = sanitizeSharedAiReport(mockAnalysis as Parameters<typeof sanitizeSharedAiReport>[0]);
    const sanitizedStr = JSON.stringify(sanitized);

    for (const blockedField of BLOCKED_AI_SHARED_FIELDS) {
      expect(sanitizedStr).not.toContain(blockedField);
    }
    expect(sanitizedStr).not.toContain("SHOULD_BE_REMOVED");
    expect(sanitized).toHaveProperty("executiveSummary", "Good session");
  });

  test("account room materials status works without joinToken (participantId only)", async ({ request }) => {
    const participantUser = await createActiveUser("p69_nojt5", "No JoinToken User");
    const facilitatorUser = await createActiveUser("p69_fac5nojt", "Fac NoJoinToken");

    const { caseId } = await createCaseWithRoles(facilitatorUser.id);
    const sessionId = await createSession(caseId, facilitatorUser.id, null, { visibility: "PRIVATE" });
    const sellerRoleId = await addSessionRole(sessionId, "SellerNoJt", 0);

    await addSessionParticipant(sessionId, facilitatorUser.id, "Fac NoJoinToken", "FACILITATOR");
    const { participantId } = await addSessionParticipant(
      sessionId,
      participantUser.id,
      "No JoinToken User",
      "PARTICIPANT",
      sellerRoleId,
    );

    const token = await createUserSession(participantUser.id);

    // Call without joinToken — must succeed using participantId + auth cookie only.
    const res = await request.get(
      `/api/sessions/${sessionId}/materials/status?participantId=${participantId}`,
      { headers: { Cookie: `auth_session=${token}` } },
    );
    expect(res.ok()).toBe(true);
    const data = await res.json() as { session: { id: string } };
    expect(data.session.id).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — Lobby first-load redirect (API-level check for redirect response)
// ---------------------------------------------------------------------------

test.describe("Phase 6.9 - Part 2: lobby login redirect", () => {
  test("unauthenticated user opening lobby without tokens is redirected to /login", async ({ request }) => {
    // Use a real event id (even a fake one triggers the page render).
    // The Next.js page calls redirect() which returns a 3xx response.
    const fakeEventId = "nonexistent-event-6-9";
    const res = await request.get(`/events/${fakeEventId}/lobby`, {
      maxRedirects: 0,
    });
    // Should redirect to login (302/307/308).
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("returnUrl");
  });

  test("authenticated user opening lobby without tokens gets lobby (not redirect to /login)", async ({ request }) => {
    const user = await createActiveUser("p69_lobby2", "Lobby Auth User");
    const eventHost = await createActiveUser("p69_lobbyhost2", "Lobby Host");
    const authToken = await createUserSession(user.id);

    const eventId = uid("ev69lb");
    await query(
      `INSERT INTO "TrainingEvent"
         ("id","title","hostUserId","facilitatorUserId","visibility","status","publicJoinCode","hostToken","createdAt","updatedAt")
       VALUES ($1,'E2E Phase 6.9 Lobby Test',$2,$2,'PUBLIC','LOBBY_OPEN',$3,$4,NOW(),NOW())`,
      [eventId, eventHost.id, uid("join69lb"), uid("host69lb")],
    );
    // Add a participant for the user so they can access.
    await query(
      `INSERT INTO "EventParticipant"
         ("id","eventId","userId","displayName","participantToken","isHost","preference","createdAt","updatedAt")
       VALUES ($1,$2,$3,'Lobby Auth User',$4,false,'UNDECIDED',NOW(),NOW())`,
      [uid("ep69lb"), eventId, user.id, uid("pt69lb")],
    );

    const res = await request.get(`/events/${eventId}/lobby`, {
      headers: { Cookie: `auth_session=${authToken}` },
      maxRedirects: 0,
    });
    // Should return 200 (rendered lobby page) or possibly a redirect within the app —
    // NOT a redirect to /login.
    const location = (res.headers()["location"] ?? "").toLowerCase();
    expect(location).not.toContain("/login");
  });
});

// ---------------------------------------------------------------------------
// Identity guard — lobby always returns currentUser's participant
// ---------------------------------------------------------------------------

test.describe("Phase 6.9 - identity guard", () => {
  test("no guest flow: state API returns 403 for unauthenticated request to private event", async ({ request }) => {
    const host = await createActiveUser("p69_priv_host", "Priv Host");
    const { eventId } = await createEventWithParticipants(host.id, { visibility: "PRIVATE" });

    const res = await request.get(`/api/events/${eventId}/state`);
    expect(res.status()).toBe(403);
  });

  test("currentParticipant is always the requesting user's own participant", async ({ request }) => {
    const admin = await createActiveUser("p69_ident_adm", "Identity Admin", { admin: true });
    const host = await createActiveUser("p69_ident_host", "Identity Host");
    const { eventId } = await createEventWithParticipants(host.id);
    const adminToken = await createUserSession(admin.id);

    const stateRes = await request.get(`/api/events/${eventId}/state`, {
      headers: { Cookie: `auth_session=${adminToken}` },
    });
    expect(stateRes.ok()).toBe(true);
    const state = await stateRes.json() as {
      currentParticipant: { displayName: string } | null;
    };
    expect(state.currentParticipant?.displayName).toBe("Identity Admin");
    expect(state.currentParticipant?.displayName).not.toBe("Identity Host");
  });
});

// ---------------------------------------------------------------------------
// Browser-required stubs (manual verification needed)
// ---------------------------------------------------------------------------
//
// The following scenarios require a running dev server and cannot be automated
// in this DB/API test suite. Run with:
//   BASE_URL=http://localhost:3000 npx playwright test tests/e2e/phase-6-9-stability-polish.spec.ts --project chromium
//
// Manual verification checklist:
//   1. Admin creates event, selects another user as facilitator, adds self as invitee via PeoplePicker → succeeds.
//   2. Invited participant opens lobby link without being logged in → redirected to /login?returnUrl=... → after login, lobby loads without refresh.
//   3. In active lobby, disconnect one participant → connection status changes within ~10-15 seconds.
//   4. Facilitator opens /sessions/[id]/materials → sees full role briefings for all participants.
//   5. Participant opens /sessions/[id]/materials → sees own role briefing only; AI section shows report once shared.
//   6. Facilitator publishes AI report → participant refreshes materials page → AI report is visible.
//   7. Participant in video room (debrief mode) sees AI report via DebriefPanel.
//   8. No joinToken visible in HTML, URL, localStorage, or browser DevTools.
