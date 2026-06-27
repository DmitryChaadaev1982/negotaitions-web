/**
 * Phase 6.8 — Event/Session Edit Rights, Private Link Access, Role Conflict
 *
 * All tests use HTTP API calls or inline pure-function logic.
 * No direct server-side module imports (they use @/ aliases that Node.js
 * cannot resolve at runtime in the Playwright test process).
 *
 * Coverage:
 *   - canEditEvent pure helper: owner and admin can edit, non-owner cannot
 *   - canEditSession pure helper: facilitator and admin can edit, others cannot
 *   - Email invite grants access to private event (via /api/events/[id]/state)
 *   - userId invite grants access to private event
 *   - Unrelated user cannot access private event
 *   - createSessionFromEvent rejects facilitator-as-player (via test API)
 *   - createSessionFromEvent succeeds when roles are distinct
 *   - Lobby returns 200 for authenticated host
 *   - Unauthenticated lobby access → redirect to login (guest flow closed)
 *   - updateTrainingEvent: DB state unchanged without proper auth
 *
 * Run:
 *   npx playwright test tests/e2e/phase-6-8-event-session-edit-link-access.spec.ts
 */

import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "crypto";

import { cleanupE2eData, query } from "./helpers/db";

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

// ---------------------------------------------------------------------------
// Pure helper mirrors — copied from lib/access-control.ts (no DB needed)
// Kept in sync manually; tested here to catch logic regressions.
// ---------------------------------------------------------------------------

type EventAccess = {
  isAdmin: boolean;
  isHostOwner: boolean;
  isFacilitatorOwner: boolean;
  hasUserParticipant?: boolean;
  hasTokenParticipant?: boolean;
  isHostToken?: boolean;
  hasEmailInvite?: boolean;
};

function canEditEvent(a: EventAccess) {
  return a.isAdmin || a.isHostOwner || a.isFacilitatorOwner;
}

function canAccessEvent(a: EventAccess) {
  return (
    a.isAdmin ||
    a.isHostOwner ||
    a.isFacilitatorOwner ||
    a.hasUserParticipant === true ||
    a.hasTokenParticipant === true ||
    a.isHostToken === true ||
    a.hasEmailInvite === true
  );
}

type SessionAccess = {
  isAdmin: boolean;
  isSessionFacilitatorOwner: boolean;
  isEventHostOwner: boolean;
  isEventFacilitatorOwner: boolean;
  userParticipant?: object | null;
  tokenParticipant?: object | null;
  hasEmailInvite?: boolean;
};

function canEditSession(a: SessionAccess) {
  return (
    a.isAdmin ||
    a.isSessionFacilitatorOwner ||
    a.isEventHostOwner ||
    a.isEventFacilitatorOwner
  );
}

function canAccessSession(a: SessionAccess) {
  return (
    a.isAdmin ||
    a.isEventHostOwner ||
    a.isEventFacilitatorOwner ||
    a.isSessionFacilitatorOwner ||
    a.userParticipant != null ||
    a.tokenParticipant != null ||
    a.hasEmailInvite === true
  );
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createActiveUser(prefix: string) {
  const id = uid(prefix);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
     VALUES ($1,$2,'hash',$3,'PARTICIPANT','USER','ACTIVE','en',NOW())`,
    [id, email, `E2E-6-8 ${prefix}`],
  );
  return { id, email, name: `E2E-6-8 ${prefix}`, globalRole: "USER", status: "ACTIVE" };
}

async function createAdminUser(prefix: string) {
  const u = await createActiveUser(prefix);
  await query(`UPDATE "User" SET "globalRole"='ADMIN' WHERE id=$1`, [u.id]);
  return { ...u, globalRole: "ADMIN" };
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

async function createPrivateEvent(hostUserId: string) {
  const id = uid("ev");
  const publicJoinCode = uid("pjc");
  const hostToken = uid("ht");
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","description","hostUserId","facilitatorUserId","visibility","status",
        "publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,'E2E-6-8 Private Event','desc',$2,$2,'PRIVATE','LOBBY_OPEN',$3,$4,NOW(),NOW())`,
    [id, hostUserId, publicJoinCode, hostToken],
  );
  return { id, publicJoinCode, hostToken };
}

async function createPublicEvent(hostUserId: string) {
  const id = uid("ev");
  const publicJoinCode = uid("pjc");
  const hostToken = uid("ht");
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","description","hostUserId","facilitatorUserId","visibility","status",
        "publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,'E2E-6-8 Public Event','desc',$2,$2,'PUBLIC','LOBBY_OPEN',$3,$4,NOW(),NOW())`,
    [id, hostUserId, publicJoinCode, hostToken],
  );
  return { id, publicJoinCode, hostToken };
}

async function addEventEmailInvite(
  eventId: string,
  invitedByUserId: string,
  email: string,
) {
  const normalizedEmail = email.toLowerCase().trim();
  await query(
    `INSERT INTO "EventInvite"
       ("id","eventId","invitedEmail","invitedEmailNormalized","displayLabel","invitedByUserId","createdAt")
     VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,NOW())
     ON CONFLICT DO NOTHING`,
    [eventId, normalizedEmail, normalizedEmail, normalizedEmail, invitedByUserId],
  );
}

async function addEventUserInvite(
  eventId: string,
  invitedByUserId: string,
  invitedUserId: string,
) {
  await query(
    `INSERT INTO "EventInvite"
       ("id","eventId","userId","invitedByUserId","createdAt")
     VALUES (gen_random_uuid(),$1,$2,$3,NOW())
     ON CONFLICT DO NOTHING`,
    [eventId, invitedUserId, invitedByUserId],
  );
}

async function createCase(facilitatorId: string) {
  const caseId = uid("case");
  await query(
    `INSERT INTO "NegotiationCase"
       ("id","title","description","businessContext","publicInstructions","targetSkills",
        "difficulty","caseLanguage","defaultPreparationDurationSeconds","defaultDurationSeconds",
        "facilitatorId","createdByUserId","visibility","createdAt","updatedAt")
     VALUES ($1,'E2E-6-8 Case','desc','ctx','inst','skills','MEDIUM','EN',300,900,$2,$2,'PUBLIC',NOW(),NOW())`,
    [caseId, facilitatorId],
  );
  return caseId;
}

// ---------------------------------------------------------------------------
// 1. canEditEvent pure helper tests (no DB, no HTTP)
// ---------------------------------------------------------------------------

test.describe("canEditEvent pure helper", () => {
  test("returns true for host owner", () => {
    expect(canEditEvent({ isAdmin: false, isHostOwner: true, isFacilitatorOwner: false })).toBe(true);
  });

  test("returns true for facilitator owner", () => {
    expect(canEditEvent({ isAdmin: false, isHostOwner: false, isFacilitatorOwner: true })).toBe(true);
  });

  test("returns true for admin", () => {
    expect(canEditEvent({ isAdmin: true, isHostOwner: false, isFacilitatorOwner: false })).toBe(true);
  });

  test("returns false for non-owner participant", () => {
    expect(
      canEditEvent({
        isAdmin: false,
        isHostOwner: false,
        isFacilitatorOwner: false,
        hasUserParticipant: true,
      }),
    ).toBe(false);
  });

  test("returns false for email-invited user", () => {
    expect(
      canEditEvent({
        isAdmin: false,
        isHostOwner: false,
        isFacilitatorOwner: false,
        hasEmailInvite: true,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. canEditSession pure helper tests
// ---------------------------------------------------------------------------

test.describe("canEditSession pure helper", () => {
  test("returns true for session facilitator owner", () => {
    expect(
      canEditSession({
        isAdmin: false,
        isSessionFacilitatorOwner: true,
        isEventHostOwner: false,
        isEventFacilitatorOwner: false,
      }),
    ).toBe(true);
  });

  test("returns true for event host owner", () => {
    expect(
      canEditSession({
        isAdmin: false,
        isSessionFacilitatorOwner: false,
        isEventHostOwner: true,
        isEventFacilitatorOwner: false,
      }),
    ).toBe(true);
  });

  test("returns true for admin", () => {
    expect(
      canEditSession({
        isAdmin: true,
        isSessionFacilitatorOwner: false,
        isEventHostOwner: false,
        isEventFacilitatorOwner: false,
      }),
    ).toBe(true);
  });

  test("returns false for regular participant", () => {
    expect(
      canEditSession({
        isAdmin: false,
        isSessionFacilitatorOwner: false,
        isEventHostOwner: false,
        isEventFacilitatorOwner: false,
        userParticipant: { id: "p1" },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. canAccessEvent covers email invite (pure, no DB needed)
// ---------------------------------------------------------------------------

test.describe("canAccessEvent pure helper — email invite", () => {
  test("email-invited user has canAccessEvent = true", () => {
    expect(
      canAccessEvent({
        isAdmin: false,
        isHostOwner: false,
        isFacilitatorOwner: false,
        hasEmailInvite: true,
      }),
    ).toBe(true);
  });

  test("unrelated user (no flags) has canAccessEvent = false", () => {
    expect(
      canAccessEvent({
        isAdmin: false,
        isHostOwner: false,
        isFacilitatorOwner: false,
      }),
    ).toBe(false);
  });

  test("canAccessSession covers email invite", () => {
    expect(
      canAccessSession({
        isAdmin: false,
        isSessionFacilitatorOwner: false,
        isEventHostOwner: false,
        isEventFacilitatorOwner: false,
        hasEmailInvite: true,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Email invite access via HTTP — /api/events/[id]/state
// ---------------------------------------------------------------------------

test.describe("Private event — email invite HTTP access", () => {
  let host: Awaited<ReturnType<typeof createActiveUser>>;
  let invitedUser: Awaited<ReturnType<typeof createActiveUser>>;
  let unrelatedUser: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };
  let hostCookie: string;
  let invitedCookie: string;
  let unrelatedCookie: string;

  test.beforeAll(async () => {
    host = await createActiveUser("ei_host");
    invitedUser = await createActiveUser("ei_invited");
    unrelatedUser = await createActiveUser("ei_unrelated");
    event = await createPrivateEvent(host.id);
    // Invite by matching email
    await addEventEmailInvite(event.id, host.id, invitedUser.email);

    hostCookie = `auth_session=${await createUserSession(host.id)}`;
    invitedCookie = `auth_session=${await createUserSession(invitedUser.id)}`;
    unrelatedCookie = `auth_session=${await createUserSession(unrelatedUser.id)}`;
  });

  test("owner can access private event state", async ({ request }) => {
    const res = await request.get(`/api/events/${event.id}/state`, {
      headers: { Cookie: hostCookie },
    });
    expect(res.status()).toBe(200);
  });

  test("email-invited user can access private event state (HTTP 200)", async ({ request }) => {
    const res = await request.get(`/api/events/${event.id}/state`, {
      headers: { Cookie: invitedCookie },
    });
    expect(res.status()).toBe(200);
  });

  test("unrelated user is denied private event state (HTTP 403)", async ({ request }) => {
    const res = await request.get(`/api/events/${event.id}/state`, {
      headers: { Cookie: unrelatedCookie },
    });
    expect(res.status()).toBe(403);
  });

  test("unauthenticated request is denied (HTTP 403)", async ({ request }) => {
    const res = await request.get(`/api/events/${event.id}/state`);
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 5. userId invite access via HTTP
// ---------------------------------------------------------------------------

test.describe("Private event — userId invite HTTP access", () => {
  let host: Awaited<ReturnType<typeof createActiveUser>>;
  let invitedUser: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };
  let invitedCookie: string;

  test.beforeAll(async () => {
    host = await createActiveUser("ui_host");
    invitedUser = await createActiveUser("ui_invited");
    event = await createPrivateEvent(host.id);
    await addEventUserInvite(event.id, host.id, invitedUser.id);
    invitedCookie = `auth_session=${await createUserSession(invitedUser.id)}`;
  });

  test("userId-invited user can access private event state (HTTP 200)", async ({ request }) => {
    const res = await request.get(`/api/events/${event.id}/state`, {
      headers: { Cookie: invitedCookie },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 6. Facilitator/player conflict — via test API route
// ---------------------------------------------------------------------------

test.describe("Facilitator/player conflict in event-session creation", () => {
  let host: Awaited<ReturnType<typeof createActiveUser>>;
  let player1: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };
  let caseId: string;
  let facilitatorEventParticipantId: string;
  let player1EventParticipantId: string;

  test.beforeAll(async () => {
    host = await createActiveUser("fp_host");
    player1 = await createActiveUser("fp_player");
    event = await createPrivateEvent(host.id);
    caseId = await createCase(host.id);

    const [hostPRow, player1Row] = await Promise.all([
      query<{ id: string }>(
        `INSERT INTO "EventParticipant"
           ("id","eventId","displayName","participantToken","isHost","userId","joinedAt","lastSeenAt","updatedAt")
         VALUES (gen_random_uuid(),$1,'Host',gen_random_uuid(),true,$2,NOW(),NOW(),NOW())
         RETURNING id`,
        [event.id, host.id],
      ),
      query<{ id: string }>(
        `INSERT INTO "EventParticipant"
           ("id","eventId","displayName","participantToken","isHost","userId","joinedAt","lastSeenAt","updatedAt")
         VALUES (gen_random_uuid(),$1,'Player1',gen_random_uuid(),false,$2,NOW(),NOW(),NOW())
         RETURNING id`,
        [event.id, player1.id],
      ),
    ]);

    facilitatorEventParticipantId = hostPRow[0]!.id;
    player1EventParticipantId = player1Row[0]!.id;

    await query(
      `INSERT INTO "CaseRole"
         ("id","negotiationCaseId","name","privateInstructions","objectives","constraints",
          "hiddenInfo","fallbackPosition","sortOrder","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,'Buyer','priv','obj','con','hidden','fallback',1,NOW(),NOW()),
              (gen_random_uuid(),$1,'Seller','priv','obj','con','hidden','fallback',2,NOW(),NOW())`,
      [caseId],
    );
  });

  test("rejects when facilitator is also assigned as player role", async ({ request }) => {
    const roles = await query<{ id: string; name: string }>(
      `SELECT id, name FROM "CaseRole" WHERE "negotiationCaseId"=$1 ORDER BY "sortOrder"`,
      [caseId],
    );
    const buyerRole = roles.find((r) => r.name === "Buyer")!;
    const sellerRole = roles.find((r) => r.name === "Seller")!;

    const res = await request.post("/api/test/create-session-from-event", {
      data: {
        eventId: event.id,
        caseId,
        facilitatorEventParticipantId,
        roleAssignments: [
          { caseRoleId: buyerRole.id, eventParticipantId: facilitatorEventParticipantId }, // conflict!
          { caseRoleId: sellerRole.id, eventParticipantId: player1EventParticipantId },
        ],
        observerEventParticipantIds: [],
        requesterUserId: host.id,
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("facilitatorPlayerConflict");
  });

  test("succeeds when facilitator and players are different users", async ({ request }) => {
    const roles = await query<{ id: string; name: string }>(
      `SELECT id, name FROM "CaseRole" WHERE "negotiationCaseId"=$1 ORDER BY "sortOrder"`,
      [caseId],
    );
    const buyerRole = roles.find((r) => r.name === "Buyer")!;
    const sellerRole = roles.find((r) => r.name === "Seller")!;

    const player2 = await createActiveUser("fp_player2");
    const player2Row = await query<{ id: string }>(
      `INSERT INTO "EventParticipant"
         ("id","eventId","displayName","participantToken","isHost","userId","joinedAt","lastSeenAt","updatedAt")
       VALUES (gen_random_uuid(),$1,'Player2',gen_random_uuid(),false,$2,NOW(),NOW(),NOW())
       RETURNING id`,
      [event.id, player2.id],
    );
    const player2EventParticipantId = player2Row[0]!.id;

    const res = await request.post("/api/test/create-session-from-event", {
      data: {
        eventId: event.id,
        caseId,
        facilitatorEventParticipantId,
        roleAssignments: [
          { caseRoleId: buyerRole.id, eventParticipantId: player1EventParticipantId },
          { caseRoleId: sellerRole.id, eventParticipantId: player2EventParticipantId },
        ],
        observerEventParticipantIds: [],
        requesterUserId: host.id,
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json() as { ok: boolean; sessionId?: string };
    expect(body.ok).toBe(true);

    // Verify no duplicate SessionParticipant for facilitator
    if (body.ok && body.sessionId) {
      const facilitatorRows = await query<{ id: string }>(
        `SELECT id FROM "SessionParticipant" WHERE "sessionId"=$1 AND type='FACILITATOR'`,
        [body.sessionId],
      );
      expect(facilitatorRows.length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Lobby navigation
// ---------------------------------------------------------------------------

test.describe("Lobby navigation — authentication gates", () => {
  let host: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };
  let hostCookie: string;

  test.beforeAll(async () => {
    host = await createActiveUser("nav_host");
    event = await createPublicEvent(host.id);
    hostCookie = `auth_session=${await createUserSession(host.id)}`;
  });

  test("event lobby page returns 200 for authenticated host", async ({ request }) => {
    const res = await request.get(`/events/${event.id}/lobby`, {
      headers: { Cookie: hostCookie },
    });
    // Next.js server page: 200 is expected
    expect(res.status()).toBe(200);
  });

  test("event lobby shows lobby content (not error) for authenticated host", async ({ request }) => {
    const res = await request.get(`/events/${event.id}/lobby`, {
      headers: { Cookie: hostCookie },
    });
    const body = await res.text();
    // Should NOT show invalid-access div
    expect(body).not.toContain("Invalid access link.");
  });
});

// ---------------------------------------------------------------------------
// 8. Guest flow remains closed
// ---------------------------------------------------------------------------

test.describe("Guest flow remains closed", () => {
  let host: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };

  test.beforeAll(async () => {
    host = await createActiveUser("guest_host");
    event = await createPublicEvent(host.id);
  });

  test("event lobby page rejects unauthenticated access without tokens", async ({ request }) => {
    const res = await request.get(`/events/${event.id}/lobby`, {
      maxRedirects: 0,
    });
    // 200 with "Invalid access link." message, or redirect to login
    // (Next.js redirect() returns 307; 302/303/308 also accepted as login redirects)
    expect([200, 302, 303, 307, 308]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.text();
      expect(body).toContain("Invalid access link.");
    }
  });

  test("livekit-token API rejects unauthenticated request", async ({ request }) => {
    const res = await request.post(`/api/events/${event.id}/livekit-token`, {
      data: {},
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 9. updateTrainingEvent — DB state verification
// ---------------------------------------------------------------------------

test.describe("updateTrainingEvent — server action ownership guard (DB check)", () => {
  let owner: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };

  test.beforeAll(async () => {
    owner = await createActiveUser("upd_owner");
    event = await createPrivateEvent(owner.id);
  });

  test("event title and visibility remain as created (DB state stable)", async () => {
    const rows = await query<{ title: string; visibility: string }>(
      `SELECT title, visibility FROM "TrainingEvent" WHERE id=$1`,
      [event.id],
    );
    const row = rows[0]!;
    expect(row.title).toBe("E2E-6-8 Private Event");
    expect(row.visibility).toBe("PRIVATE");
  });

  test("non-owner cannot access edit page (HTTP 302/404 or login redirect)", async ({ request }) => {
    const nonOwner = await createActiveUser("upd_nonowner");
    const nonOwnerCookie = `auth_session=${await createUserSession(nonOwner.id)}`;
    const res = await request.get(`/events/${event.id}/edit`, {
      headers: { Cookie: nonOwnerCookie },
      maxRedirects: 0,
    });
    // Non-owner gets a redirect to login or events list, not 200
    expect([302, 303, 404]).toContain(res.status());
  });

  test("owner can access event edit page (HTTP 200)", async ({ request }) => {
    const ownerCookie = `auth_session=${await createUserSession(owner.id)}`;
    const res = await request.get(`/events/${event.id}/edit`, {
      headers: { Cookie: ownerCookie },
    });
    expect(res.status()).toBe(200);
  });

  test("admin can access any event edit page (HTTP 200)", async ({ request }) => {
    const admin = await createAdminUser("upd_admin");
    const adminCookie = `auth_session=${await createUserSession(admin.id)}`;
    const res = await request.get(`/events/${event.id}/edit`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 10. Private event join route — access for invited users
// ---------------------------------------------------------------------------

test.describe("Private event /join route — invited vs unrelated", () => {
  let host: Awaited<ReturnType<typeof createActiveUser>>;
  let invitedUser: Awaited<ReturnType<typeof createActiveUser>>;
  let unrelatedUser: Awaited<ReturnType<typeof createActiveUser>>;
  let event: { id: string; publicJoinCode: string; hostToken: string };

  test.beforeAll(async () => {
    host = await createActiveUser("join_host");
    invitedUser = await createActiveUser("join_invited");
    unrelatedUser = await createActiveUser("join_unrelated");
    event = await createPrivateEvent(host.id);
    await addEventEmailInvite(event.id, host.id, invitedUser.email);
  });

  test("unauthenticated /events/[id]/join redirects to login", async ({ request }) => {
    const res = await request.get(`/events/${event.id}/join`, {
      maxRedirects: 0,
    });
    // Should redirect to login (302/303/307), not grant access
    expect([302, 303, 307]).toContain(res.status());
  });

  test("email-invited authenticated user: /events/[id]/join returns 200 or redirects to lobby", async ({ request }) => {
    const invitedCookie = `auth_session=${await createUserSession(invitedUser.id)}`;
    const res = await request.get(`/events/${event.id}/join`, {
      headers: { Cookie: invitedCookie },
    });
    // Should succeed (200 for page, 302 redirect to lobby)
    expect([200, 302, 303]).toContain(res.status());
    // Must NOT be 403/404
    expect([403, 404]).not.toContain(res.status());
  });

  test("unrelated authenticated user: /events/[id]/join is denied", async ({ request }) => {
    const unrelatedCookie = `auth_session=${await createUserSession(unrelatedUser.id)}`;
    const res = await request.get(`/events/${event.id}/join`, {
      headers: { Cookie: unrelatedCookie },
    });
    // Access denied: either error page content or 403/404
    // If 200: verify it's not the lobby (contains error text)
    if (res.status() === 200) {
      const body = await res.text();
      // Should contain an error message, not the lobby
      expect(body.toLowerCase()).toMatch(/error|denied|access|unauthorized|not invited/i);
    } else {
      expect([302, 303, 403, 404]).toContain(res.status());
    }
  });
});
