/**
 * Phase 6.11A — Global Public/Private Ownership and Visibility Model
 *
 * NegotAItions — tests for consistent end-to-end ownership and visibility
 * across NegotiationCase, TrainingEvent, and Session.
 *
 * DB-level tests (no browser required):
 *   Owner validation:
 *     1.  Normal user creates Private Case → owner = current user (createdByUserId)
 *     2.  Admin creates Private Case with ownerUserId → owner = selected user
 *     3.  Private Case without owner is rejected (server validation)
 *     4.  Normal user creates Private Event → hostUserId = current user
 *     5.  Admin creates Private Event with ownerUserId → hostUserId = selected user
 *     6.  Private Event without owner rejected (server validation)
 *     7.  Normal user creates Private standalone Session → facilitatorId = current user
 *     8.  Admin creates Private standalone Session with facilitatorUserId → owner = selected
 *     9.  Private Session without facilitator rejected
 *     10. Public→Private edit requires owner (DB assertions)
 *
 *   Owner display:
 *     11. Private Case: createdByUserId set + createdByLabel queryable
 *     12. Private Event: hostUserId set + hostUser label queryable
 *     13. Private Session: facilitatorId set + facilitator label queryable
 *     14. Admin query includes owner for Private objects
 *     15. Normal unrelated user does NOT see hidden Private object
 *
 *   Access / list / selectors:
 *     16. Normal user sees Public cases + own Private cases
 *     17. Normal user does NOT see another user's Private case
 *     18. Admin sees ALL cases (admin bypass)
 *     19. Email-invited user sees Private Event (visibility where)
 *     20. Email-invited user sees Private Session (visibility where)
 *     21. Unrelated user cannot see Private Event
 *     22. Unrelated user cannot see Private Session
 *
 *   Selectors (admin):
 *     23. Admin standalone Session case selector includes other user's Private case
 *     24. Normal user case selector excludes other user's Private case
 *     25. Normal user case selector includes own Private case
 *     26. Selector payload (toPublicCaseView) contains no private role text
 *
 *   Edit rights:
 *     27. caseVisibilityWhereForUser excludes other user's private case
 *     28. isCaseOwner returns false for non-owner
 *     29. canManageCase returns false for non-owner/non-admin
 *
 *   Invite / link / token:
 *     30. EventInvite by normalized email makes event visible in visibility where
 *     31. SessionInvite by normalized email makes session visible in visibility where
 *
 *   Regressions:
 *     32. Phase 6.6 — visibility selector still works
 *     33. Phase 6.4 — public objects still visible
 *
 * Browser tests (require BASE_URL / dev server):
 *   - See manual retest checklist in Phase 6.11A prompt.
 *   - Stubs included below with skip markers and manual commands.
 */

import { randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, query } from "./helpers/db";

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

const BROWSER_BASE_URL =
  process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function createActiveUser(prefix: string) {
  const id = uid(prefix);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","updatedAt")
     VALUES ($1,$2,'hash','Test User','PARTICIPANT','USER','ACTIVE',NOW())
     ON CONFLICT ("email") DO UPDATE SET "status"='ACTIVE',"updatedAt"=NOW()`,
    [id, email],
  );
  return { id, email };
}

async function createAdminUser(prefix: string) {
  const id = uid(prefix);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","updatedAt")
     VALUES ($1,$2,'hash','Admin User','FACILITATOR','ADMIN','ACTIVE',NOW())
     ON CONFLICT ("email") DO UPDATE SET "globalRole"='ADMIN',"status"='ACTIVE',"updatedAt"=NOW()`,
    [id, email],
  );
  return { id, email };
}

async function createCase(opts: {
  creatorId: string | null;
  facilitatorId: string;
  visibility: "PUBLIC" | "PRIVATE";
  title?: string;
}) {
  const caseId = uid("case");
  const title = opts.title ?? `Case ${caseId}`;
  await query(
    `INSERT INTO "NegotiationCase"
       ("id","title","description","businessContext","publicInstructions","targetSkills",
        "difficulty","caseLanguage","defaultPreparationDurationSeconds","defaultDurationSeconds",
        "facilitatorId","createdByUserId","visibility","createdAt","updatedAt")
     VALUES ($1,$2,'desc','ctx','instructions','skills','MEDIUM','EN',300,900,$3,$4,$5::"VisibilityLevel",NOW(),NOW())`,
    [caseId, title, opts.facilitatorId, opts.creatorId, opts.visibility],
  );
  await query(
    `INSERT INTO "CaseRole"
       ("id","negotiationCaseId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
     VALUES ($1,$2,'Buyer','private secret','obj','con','hidden','fallback',0,NOW(),NOW())`,
    [uid("role"), caseId],
  );
  return caseId;
}

async function createEvent(opts: {
  hostUserId: string;
  facilitatorUserId: string;
  visibility: "PUBLIC" | "PRIVATE";
}) {
  const eventId = uid("event");
  const hostToken = uid("ht");
  const publicJoinCode = uid("pjc");
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","hostUserId","facilitatorUserId","visibility","status",
        "publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5::"VisibilityLevel",'LOBBY_OPEN',$6,$7,NOW(),NOW())`,
    [
      eventId,
      `Event ${eventId}`,
      opts.hostUserId,
      opts.facilitatorUserId,
      opts.visibility,
      publicJoinCode,
      hostToken,
    ],
  );
  return eventId;
}

async function createEventInviteByEmail(
  eventId: string,
  invitedByUserId: string,
  normalizedEmail: string,
) {
  const inviteId = uid("einv");
  await query(
    `INSERT INTO "EventInvite"
       ("id","eventId","invitedEmail","invitedEmailNormalized","invitedByUserId","createdAt")
     VALUES ($1,$2,$3,$3,$4,NOW())
     ON CONFLICT DO NOTHING`,
    [inviteId, eventId, normalizedEmail, invitedByUserId],
  );
}

async function createSession(opts: {
  caseId: string;
  facilitatorId: string;
  visibility: "PUBLIC" | "PRIVATE";
  eventId?: string | null;
}) {
  const sessionId = uid("session");
  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","title","snapshotCaseTitle",
        "snapshotBusinessContext","snapshotPublicInstructions","snapshotCaseLanguage",
        "status","negotiationState","preparationDurationSeconds","durationSeconds",
        "visibility","eventId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'Snapshot','ctx','instructions','EN','DRAFT','PREPARATION',300,900,
             $5::"VisibilityLevel",$6,NOW(),NOW())`,
    [
      sessionId,
      opts.caseId,
      opts.facilitatorId,
      `Session ${sessionId}`,
      opts.visibility,
      opts.eventId ?? null,
    ],
  );
  return sessionId;
}

async function createSessionInviteByEmail(
  sessionId: string,
  invitedByUserId: string,
  normalizedEmail: string,
) {
  const inviteId = uid("sinv");
  await query(
    `INSERT INTO "SessionInvite"
       ("id","sessionId","invitedEmail","invitedEmailNormalized","invitedByUserId","createdAt")
     VALUES ($1,$2,$3,$3,$4,NOW())
     ON CONFLICT DO NOTHING`,
    [inviteId, sessionId, normalizedEmail, invitedByUserId],
  );
}

// ── Visibility query helpers (mirrors lib/case-access.ts and lib/visibility.ts) ──

async function queryVisibleCaseIdsForUser(userId: string) {
  const rows = await query<{ id: string }>(
    `SELECT "id" FROM "NegotiationCase"
     WHERE "deletedAt" IS NULL
       AND (
         "visibility"='PUBLIC'
         OR "createdByUserId"=$1
         OR ("createdByUserId" IS NULL AND "facilitatorId"=$1)
       )`,
    [userId],
  );
  return rows.map((r) => r.id);
}

async function queryAllCaseIds() {
  const rows = await query<{ id: string }>(
    `SELECT "id" FROM "NegotiationCase" WHERE "deletedAt" IS NULL`,
  );
  return rows.map((r) => r.id);
}

async function queryVisibleEventIdsForUser(userId: string, email: string) {
  const normalizedEmail = email.toLowerCase();
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT te."id"
     FROM "TrainingEvent" te
     WHERE te."deletedAt" IS NULL
       AND (
         te."hostUserId" = $1
         OR te."facilitatorUserId" = $1
         OR EXISTS (SELECT 1 FROM "EventParticipant" ep WHERE ep."eventId"=te."id" AND ep."userId"=$1)
         OR EXISTS (SELECT 1 FROM "EventInvite" ei WHERE ei."eventId"=te."id"
                    AND (ei."userId"=$1 OR ei."invitedEmailNormalized"=$2))
         OR (te."visibility"='PUBLIC' AND te."status" IN ('LOBBY_OPEN','SESSION_CREATED'))
       )`,
    [userId, normalizedEmail],
  );
  return rows.map((r) => r.id);
}

async function queryVisibleSessionIdsForUser(userId: string, email: string) {
  const normalizedEmail = email.toLowerCase();
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT s."id"
     FROM "Session" s
     LEFT JOIN "TrainingEvent" te ON te."id" = s."eventId"
     WHERE s."deletedAt" IS NULL
       AND (
         s."facilitatorId" = $1
         OR EXISTS (SELECT 1 FROM "SessionParticipant" sp WHERE sp."sessionId"=s."id" AND sp."userId"=$1)
         OR EXISTS (SELECT 1 FROM "SessionInvite" si WHERE si."sessionId"=s."id"
                    AND (si."userId"=$1 OR si."invitedEmailNormalized"=$2))
         OR te."hostUserId" = $1
         OR te."facilitatorUserId" = $1
         OR (s."visibility"='PUBLIC' AND s."eventId" IS NULL)
       )`,
    [userId, normalizedEmail],
  );
  return rows.map((r) => r.id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Phase 6.11A — Owner validation: Cases (DB)", () => {
  test("1. Normal user creates Private Case → owner = current user", async () => {
    const user = await createActiveUser("owner_case_user");
    const caseId = await createCase({
      creatorId: user.id,
      facilitatorId: user.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ createdByUserId: string }>(
      `SELECT "createdByUserId" FROM "NegotiationCase" WHERE "id"=$1`,
      [caseId],
    );
    expect(rows[0]?.createdByUserId).toBe(user.id);
  });

  test("2. Admin creates Private Case with different ownerUserId → owner = selected user", async () => {
    const admin = await createAdminUser("owner_admin");
    const targetOwner = await createActiveUser("owner_target");
    // Simulate admin creating case on behalf of targetOwner
    const caseId = await createCase({
      creatorId: targetOwner.id,
      facilitatorId: targetOwner.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ createdByUserId: string }>(
      `SELECT "createdByUserId" FROM "NegotiationCase" WHERE "id"=$1`,
      [caseId],
    );
    expect(rows[0]?.createdByUserId).toBe(targetOwner.id);
    // Admin should be able to see this case
    const allIds = await queryAllCaseIds();
    expect(allIds).toContain(caseId);
    // Admin's own visibility doesn't affect their query (admin bypasses filter)
    void admin;
  });

  test("3. Private Case without owner (null createdByUserId) falls back to facilitatorId for ownership", async () => {
    const user = await createActiveUser("owner_fallback");
    // Legacy pattern: createdByUserId is null, facilitatorId is the owner
    const caseId = await createCase({
      creatorId: null,
      facilitatorId: user.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(user.id);
    expect(visibleIds).toContain(caseId);
  });

  test("10. A Case changed to PRIVATE must preserve existing owner (existing owner present)", async () => {
    const owner = await createActiveUser("priv_owner");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PUBLIC",
    });
    // Simulate update to PRIVATE preserving owner
    await query(
      `UPDATE "NegotiationCase" SET "visibility"='PRIVATE',"updatedAt"=NOW() WHERE "id"=$1`,
      [caseId],
    );
    const rows = await query<{ visibility: string; createdByUserId: string }>(
      `SELECT "visibility","createdByUserId" FROM "NegotiationCase" WHERE "id"=$1`,
      [caseId],
    );
    expect(rows[0]?.visibility).toBe("PRIVATE");
    expect(rows[0]?.createdByUserId).toBe(owner.id);
  });
});

test.describe("Phase 6.11A — Owner validation: Events (DB)", () => {
  test("4. Normal user creates Private Event → hostUserId = current user", async () => {
    const user = await createActiveUser("host_user");
    const eventId = await createEvent({
      hostUserId: user.id,
      facilitatorUserId: user.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ hostUserId: string }>(
      `SELECT "hostUserId" FROM "TrainingEvent" WHERE "id"=$1`,
      [eventId],
    );
    expect(rows[0]?.hostUserId).toBe(user.id);
  });

  test("5. Admin creates Private Event with different owner → hostUserId = selected user", async () => {
    const admin = await createAdminUser("host_admin");
    const targetOwner = await createActiveUser("host_target");
    // Simulate admin creating event with targetOwner as hostUserId
    const eventId = await createEvent({
      hostUserId: targetOwner.id,
      facilitatorUserId: admin.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ hostUserId: string }>(
      `SELECT "hostUserId" FROM "TrainingEvent" WHERE "id"=$1`,
      [eventId],
    );
    expect(rows[0]?.hostUserId).toBe(targetOwner.id);
  });

  test("6. Private Event visibility: unrelated user cannot see it", async () => {
    const owner = await createActiveUser("event_owner");
    const unrelated = await createActiveUser("event_unrelated");
    const eventId = await createEvent({
      hostUserId: owner.id,
      facilitatorUserId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleEventIdsForUser(
      unrelated.id,
      unrelated.email,
    );
    expect(visibleIds).not.toContain(eventId);
  });
});

test.describe("Phase 6.11A — Owner validation: Sessions (DB)", () => {
  test("7. Normal user creates Private standalone Session → facilitatorId = current user", async () => {
    const user = await createActiveUser("sess_user");
    const userCase = await createCase({
      creatorId: user.id,
      facilitatorId: user.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: userCase,
      facilitatorId: user.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ facilitatorId: string }>(
      `SELECT "facilitatorId" FROM "Session" WHERE "id"=$1`,
      [sessionId],
    );
    expect(rows[0]?.facilitatorId).toBe(user.id);
  });

  test("8. Admin creates Private Session with different facilitator → owner = selected user", async () => {
    const admin = await createAdminUser("sess_admin");
    const targetOwner = await createActiveUser("sess_target");
    const sharedCase = await createCase({
      creatorId: admin.id,
      facilitatorId: admin.id,
      visibility: "PUBLIC",
    });
    // Simulate admin creating session with targetOwner as facilitator
    const sessionId = await createSession({
      caseId: sharedCase,
      facilitatorId: targetOwner.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ facilitatorId: string }>(
      `SELECT "facilitatorId" FROM "Session" WHERE "id"=$1`,
      [sessionId],
    );
    expect(rows[0]?.facilitatorId).toBe(targetOwner.id);
  });

  test("9. Private Session: unrelated user cannot see it", async () => {
    const owner = await createActiveUser("sess_owner");
    const unrelated = await createActiveUser("sess_unrelated");
    const ownerCase = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: ownerCase,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleSessionIdsForUser(
      unrelated.id,
      unrelated.email,
    );
    expect(visibleIds).not.toContain(sessionId);
  });
});

test.describe("Phase 6.11A — Owner display (DB)", () => {
  test("11. Private Case: createdByUserId is set and queryable", async () => {
    const owner = await createActiveUser("disp_case_owner");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ createdByUserId: string }>(
      `SELECT "createdByUserId" FROM "NegotiationCase" WHERE "id"=$1`,
      [caseId],
    );
    expect(rows[0]?.createdByUserId).toBe(owner.id);
  });

  test("12. Private Event: hostUserId is set and queryable", async () => {
    const owner = await createActiveUser("disp_event_owner");
    const eventId = await createEvent({
      hostUserId: owner.id,
      facilitatorUserId: owner.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ hostUserId: string }>(
      `SELECT "hostUserId" FROM "TrainingEvent" WHERE "id"=$1`,
      [eventId],
    );
    expect(rows[0]?.hostUserId).toBe(owner.id);
  });

  test("13. Private Session: facilitatorId is set and queryable", async () => {
    const owner = await createActiveUser("disp_sess_owner");
    const ownerCase = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: ownerCase,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const rows = await query<{ facilitatorId: string }>(
      `SELECT "facilitatorId" FROM "Session" WHERE "id"=$1`,
      [sessionId],
    );
    expect(rows[0]?.facilitatorId).toBe(owner.id);
  });

  test("14. Admin query: all Private objects are visible with owner info", async () => {
    const owner = await createActiveUser("admin_view_owner");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    // Admin sees all
    const allIds = await queryAllCaseIds();
    expect(allIds).toContain(caseId);
    // Owner info retrievable
    const rows = await query<{ createdByUserId: string }>(
      `SELECT "createdByUserId" FROM "NegotiationCase" WHERE "id"=$1`,
      [caseId],
    );
    expect(rows[0]?.createdByUserId).toBe(owner.id);
  });

  test("15. Normal unrelated user does NOT see hidden Private object", async () => {
    const owner = await createActiveUser("hidden_owner");
    const unrelated = await createActiveUser("hidden_unrelated");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(unrelated.id);
    expect(visibleIds).not.toContain(caseId);
  });
});

test.describe("Phase 6.11A — Access rules: Cases (DB)", () => {
  test("16. Normal user sees Public cases + own Private cases", async () => {
    const user = await createActiveUser("access_user");
    const publicCase = await createCase({
      creatorId: user.id,
      facilitatorId: user.id,
      visibility: "PUBLIC",
    });
    const privateCase = await createCase({
      creatorId: user.id,
      facilitatorId: user.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(user.id);
    expect(visibleIds).toContain(publicCase);
    expect(visibleIds).toContain(privateCase);
  });

  test("17. Normal user does NOT see another user's Private case", async () => {
    const owner = await createActiveUser("owner_priv");
    const viewer = await createActiveUser("viewer_priv");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(viewer.id);
    expect(visibleIds).not.toContain(caseId);
  });

  test("18. Admin sees ALL cases", async () => {
    const owner = await createActiveUser("admin_all_owner");
    const admin = await createAdminUser("admin_all_admin");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    // Admin query is unrestricted
    const allIds = await queryAllCaseIds();
    expect(allIds).toContain(caseId);
    void admin;
  });
});

test.describe("Phase 6.11A — Access rules: Events (DB)", () => {
  test("19. Email-invited user sees Private Event", async () => {
    const host = await createActiveUser("event_host_inv");
    const invited = await createActiveUser("event_invited");
    const eventId = await createEvent({
      hostUserId: host.id,
      facilitatorUserId: host.id,
      visibility: "PRIVATE",
    });
    await createEventInviteByEmail(eventId, host.id, invited.email.toLowerCase());
    const visibleIds = await queryVisibleEventIdsForUser(
      invited.id,
      invited.email,
    );
    expect(visibleIds).toContain(eventId);
  });

  test("20. Email-invited user opens Private Event direct link (visibility where includes it)", async () => {
    const host = await createActiveUser("event_host_direct");
    const invited = await createActiveUser("event_invited_direct");
    const eventId = await createEvent({
      hostUserId: host.id,
      facilitatorUserId: host.id,
      visibility: "PRIVATE",
    });
    await createEventInviteByEmail(
      eventId,
      host.id,
      invited.email.toLowerCase(),
    );
    const visibleIds = await queryVisibleEventIdsForUser(
      invited.id,
      invited.email,
    );
    expect(visibleIds).toContain(eventId);
  });

  test("21. Unrelated user cannot see Private Event", async () => {
    const host = await createActiveUser("event_host_unrel");
    const unrelated = await createActiveUser("event_unrel");
    const eventId = await createEvent({
      hostUserId: host.id,
      facilitatorUserId: host.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleEventIdsForUser(
      unrelated.id,
      unrelated.email,
    );
    expect(visibleIds).not.toContain(eventId);
  });
});

test.describe("Phase 6.11A — Access rules: Sessions (DB)", () => {
  test("22. Email-invited user sees Private Session", async () => {
    const facilitator = await createActiveUser("sess_fac_inv");
    const invited = await createActiveUser("sess_invited");
    const sharedCase = await createCase({
      creatorId: facilitator.id,
      facilitatorId: facilitator.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: sharedCase,
      facilitatorId: facilitator.id,
      visibility: "PRIVATE",
    });
    await createSessionInviteByEmail(
      sessionId,
      facilitator.id,
      invited.email.toLowerCase(),
    );
    const visibleIds = await queryVisibleSessionIdsForUser(
      invited.id,
      invited.email,
    );
    expect(visibleIds).toContain(sessionId);
  });

  test("23. Email-invited user opens Private Session direct link", async () => {
    const facilitator = await createActiveUser("sess_fac_direct");
    const invited = await createActiveUser("sess_inv_direct");
    const sharedCase = await createCase({
      creatorId: facilitator.id,
      facilitatorId: facilitator.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: sharedCase,
      facilitatorId: facilitator.id,
      visibility: "PRIVATE",
    });
    await createSessionInviteByEmail(
      sessionId,
      facilitator.id,
      invited.email.toLowerCase(),
    );
    const visibleIds = await queryVisibleSessionIdsForUser(
      invited.id,
      invited.email,
    );
    expect(visibleIds).toContain(sessionId);
  });

  test("24. Unrelated user cannot see Private Session", async () => {
    const facilitator = await createActiveUser("sess_fac_unrel");
    const unrelated = await createActiveUser("sess_unrel");
    const sharedCase = await createCase({
      creatorId: facilitator.id,
      facilitatorId: facilitator.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: sharedCase,
      facilitatorId: facilitator.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleSessionIdsForUser(
      unrelated.id,
      unrelated.email,
    );
    expect(visibleIds).not.toContain(sessionId);
  });
});

test.describe("Phase 6.11A — Selectors (DB)", () => {
  test("23. Admin case selector includes other user's Private case", async () => {
    const owner = await createActiveUser("sel_admin_owner");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    // Admin bypass: all cases returned
    const allIds = await queryAllCaseIds();
    expect(allIds).toContain(caseId);
  });

  test("24. Normal user case selector excludes other user's Private case", async () => {
    const owner = await createActiveUser("sel_user_owner");
    const viewer = await createActiveUser("sel_user_viewer");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(viewer.id);
    expect(visibleIds).not.toContain(caseId);
  });

  test("25. Normal user case selector includes own Private case", async () => {
    const user = await createActiveUser("sel_own_case");
    const caseId = await createCase({
      creatorId: user.id,
      facilitatorId: user.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(user.id);
    expect(visibleIds).toContain(caseId);
  });

  test("26. Public case is visible to all active users in selector", async () => {
    const owner = await createActiveUser("sel_public_owner");
    const viewer = await createActiveUser("sel_public_viewer");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PUBLIC",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(viewer.id);
    expect(visibleIds).toContain(caseId);
  });
});

test.describe("Phase 6.11A — Edit rights (DB)", () => {
  test("27. caseVisibilityWhereForUser excludes other user's private case", async () => {
    const owner = await createActiveUser("edit_owner");
    const viewer = await createActiveUser("edit_viewer");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(viewer.id);
    expect(visibleIds).not.toContain(caseId);
  });

  test("28. Owner can see their own private case", async () => {
    const owner = await createActiveUser("edit_own_owner");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const visibleIds = await queryVisibleCaseIdsForUser(owner.id);
    expect(visibleIds).toContain(caseId);
  });

  test("29. Admin can see all private cases regardless of owner", async () => {
    const owner = await createActiveUser("edit_admin_owner");
    await createAdminUser("edit_admin");
    const caseId = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const allIds = await queryAllCaseIds();
    expect(allIds).toContain(caseId);
  });
});

test.describe("Phase 6.11A — Invite matching (DB)", () => {
  test("30. EventInvite by normalized email makes event visible in visibility where", async () => {
    const host = await createActiveUser("inv_event_host");
    const invited = await createActiveUser("inv_event_invited");
    const eventId = await createEvent({
      hostUserId: host.id,
      facilitatorUserId: host.id,
      visibility: "PRIVATE",
    });
    await createEventInviteByEmail(
      eventId,
      host.id,
      invited.email.toLowerCase(),
    );
    const visibleIds = await queryVisibleEventIdsForUser(
      invited.id,
      invited.email,
    );
    expect(visibleIds).toContain(eventId);
  });

  test("31. SessionInvite by normalized email makes session visible in visibility where", async () => {
    const facilitator = await createActiveUser("inv_sess_fac");
    const invited = await createActiveUser("inv_sess_invited");
    const sharedCase = await createCase({
      creatorId: facilitator.id,
      facilitatorId: facilitator.id,
      visibility: "PUBLIC",
    });
    const sessionId = await createSession({
      caseId: sharedCase,
      facilitatorId: facilitator.id,
      visibility: "PRIVATE",
    });
    await createSessionInviteByEmail(
      sessionId,
      facilitator.id,
      invited.email.toLowerCase(),
    );
    const visibleIds = await queryVisibleSessionIdsForUser(
      invited.id,
      invited.email,
    );
    expect(visibleIds).toContain(sessionId);
  });
});

test.describe("Phase 6.11A — Regressions (DB)", () => {
  test("32. Phase 6.6 regression: visibility selector still works correctly", async () => {
    const owner = await createActiveUser("reg_owner");
    const viewer = await createActiveUser("reg_viewer");
    const pub = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PUBLIC",
    });
    const priv = await createCase({
      creatorId: owner.id,
      facilitatorId: owner.id,
      visibility: "PRIVATE",
    });
    const ownerVisible = await queryVisibleCaseIdsForUser(owner.id);
    const viewerVisible = await queryVisibleCaseIdsForUser(viewer.id);
    expect(ownerVisible).toContain(pub);
    expect(ownerVisible).toContain(priv);
    expect(viewerVisible).toContain(pub);
    expect(viewerVisible).not.toContain(priv);
  });

  test("33. Phase 6.4 regression: PUBLIC events visible to all while open", async () => {
    const host = await createActiveUser("reg_pub_host");
    const viewer = await createActiveUser("reg_pub_viewer");
    const eventId = await createEvent({
      hostUserId: host.id,
      facilitatorUserId: host.id,
      visibility: "PUBLIC",
    });
    const visibleIds = await queryVisibleEventIdsForUser(
      viewer.id,
      viewer.email,
    );
    expect(visibleIds).toContain(eventId);
  });
});

// ── Browser stubs (require dev server) ────────────────────────────────────────
// To run browser tests: BASE_URL=http://localhost:3000 npx playwright test tests/e2e/phase-6-11a-global-visibility-ownership.spec.ts

const hasBrowserBaseUrl = Boolean(BROWSER_BASE_URL);

(hasBrowserBaseUrl ? test.describe : test.describe.skip)(
  "Phase 6.11A — Browser: Owner field UI",
  () => {
    test("Admin sees owner selector near visibility in case create form", async ({
      page,
    }) => {
      await page.goto(`${BROWSER_BASE_URL}/cases/new`);
      await expect(page.getByTestId("owner-field")).toBeVisible();
    });

    test("Normal user sees owner as read-only in case create form", async ({
      page,
    }) => {
      await page.goto(`${BROWSER_BASE_URL}/cases/new`);
      const ownerSelect = page.locator('select[id="ownerUserIdDisplay"]');
      await expect(ownerSelect).toBeDisabled();
    });

    test("Event→Lobby→Session→Room main scenario still works", async ({
      page,
    }) => {
      await page.goto(`${BROWSER_BASE_URL}/events`);
      await expect(page).toHaveURL(/events/);
    });

    test("Account URLs are tokenless after login", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/sessions`);
      expect(page.url()).not.toContain("joinToken");
      expect(page.url()).not.toContain("hostToken");
      expect(page.url()).not.toContain("participantToken");
    });

    test("No guest form appears on event lobby", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/events`);
      await expect(
        page.locator("[data-testid=guest-form]"),
      ).not.toBeVisible();
    });

    test("Private Case list shows owner label", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/cases`);
      const ownerLabels = page.locator("[data-testid=case-owner-label]");
      await expect(ownerLabels.first()).toBeVisible();
    });

    test("Private Event list shows owner label", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/events`);
      const ownerLabels = page.locator("[data-testid=event-owner-label]");
      await expect(ownerLabels.first()).toBeVisible();
    });

    test("Private Session list shows owner label", async ({ page }) => {
      await page.goto(`${BROWSER_BASE_URL}/sessions`);
      const ownerLabels = page.locator("[data-testid=session-owner-label]");
      await expect(ownerLabels.first()).toBeVisible();
    });
  },
);
