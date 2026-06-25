/**
 * Phase 4.2 — Overview API guard regression check.
 *
 * Verifies /api/events/overview and /api/sessions/overview are:
 *   1. Protected — unauthenticated request → 401.
 *   2. Protected — PENDING_APPROVAL / REJECTED / BLOCKED user → 403.
 *   3. Scoped — normal ACTIVE user only receives own data, not global data.
 *   4. Token-safe — response body contains no hostToken / participantToken /
 *      joinToken / facilitatorJoinToken / hostParticipantToken /
 *      passwordHash / sessionTokenHash.
 *   5. Admin accessible — admin user can access admin-scoped overview.
 *
 * NOTE: These tests require a running dev/preview server.
 * Run: npm run dev   before executing with Playwright.
 *
 * Tests create their own DB fixtures and clean up after themselves.
 */

import { createHash, randomBytes } from "crypto";

import { test, expect } from "@playwright/test";

import { query, cleanupE2eData, createE2eCase, ensureDemoFacilitator } from "./helpers/db";

// ── helpers ────────────────────────────────────────────────────────────────

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

type UserStatus = "ACTIVE" | "PENDING_APPROVAL" | "REJECTED" | "BLOCKED";

async function createUser(email: string, status: UserStatus = "ACTIVE"): Promise<string> {
  const id = uid("user");
  await query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "role", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', 'Test User', 'PARTICIPANT', 'USER', $3, NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "status" = $3, "updatedAt" = NOW()`,
    [id, email, status],
  );
  const rows = await query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" = $1`,
    [email],
  );
  return rows[0]!.id;
}

async function createAdminUser(email: string): Promise<string> {
  const id = uid("admin");
  await query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "role", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', 'Admin User', 'PARTICIPANT', 'ADMIN', 'ACTIVE', NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "globalRole" = 'ADMIN', "status" = 'ACTIVE', "updatedAt" = NOW()`,
    [id, email],
  );
  const rows = await query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" = $1`,
    [email],
  );
  return rows[0]!.id;
}

async function createSessionCookie(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [uid("sess"), userId, hash, expiresAt],
  );
  return `auth_session=${raw}`;
}

async function cleanupTestUsers() {
  await query(`DELETE FROM "User" WHERE "email" LIKE '%@p42.negotaitions'`);
}

// ── 1. Unauthenticated → 401 ───────────────────────────────────────────────

test.describe("Phase 4.2 — unauthenticated requests return 401", () => {
  test("GET /api/events/overview without auth → 401", async ({ request }) => {
    const resp = await request.get("/api/events/overview");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/sessions/overview without auth → 401", async ({ request }) => {
    const resp = await request.get("/api/sessions/overview");
    expect(resp.status()).toBe(401);
  });
});

// ── 2. Non-ACTIVE users → 403 ─────────────────────────────────────────────

test.describe("Phase 4.2 — non-ACTIVE users receive 403", () => {
  const pendingEmail = "pending@p42.negotaitions";
  const rejectedEmail = "rejected@p42.negotaitions";
  const blockedEmail = "blocked@p42.negotaitions";

  let pendingCookie: string;
  let rejectedCookie: string;
  let blockedCookie: string;

  test.beforeAll(async () => {
    const pendingId = await createUser(pendingEmail, "PENDING_APPROVAL");
    const rejectedId = await createUser(rejectedEmail, "REJECTED");
    const blockedId = await createUser(blockedEmail, "BLOCKED");
    pendingCookie = await createSessionCookie(pendingId);
    rejectedCookie = await createSessionCookie(rejectedId);
    blockedCookie = await createSessionCookie(blockedId);
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
  });

  for (const path of ["/api/events/overview", "/api/sessions/overview"] as const) {
    test(`PENDING_APPROVAL user → 403 on ${path}`, async ({ request }) => {
      const resp = await request.get(path, { headers: { Cookie: pendingCookie } });
      expect(resp.status()).toBe(403);
    });

    test(`REJECTED user → 403 on ${path}`, async ({ request }) => {
      const resp = await request.get(path, { headers: { Cookie: rejectedCookie } });
      expect(resp.status()).toBe(403);
    });

    test(`BLOCKED user → 403 on ${path}`, async ({ request }) => {
      const resp = await request.get(path, { headers: { Cookie: blockedCookie } });
      expect(resp.status()).toBe(403);
    });
  }
});

// ── 3 & 5. Scoping: User A cannot see User B data; tokens not in body ──────

test.describe("Phase 4.2 — data scoping and token-safety", () => {
  let userACookie: string;
  let userBCookie: string;
  let adminCookie: string;

  let eventId: string;
  let sessionId: string;
  let hostToken: string;
  let participantToken: string;
  let joinToken: string;

  test.beforeAll(async () => {
    await cleanupE2eData();
    await cleanupTestUsers();

    const facilitator = await ensureDemoFacilitator();
    const negotiationCase = await createE2eCase();

    // User A owns the event and session
    const userAId = await createUser("usera@p42.negotaitions", "ACTIVE");
    userACookie = await createSessionCookie(userAId);

    // User B is unrelated
    const userBId = await createUser("userb@p42.negotaitions", "ACTIVE");
    userBCookie = await createSessionCookie(userBId);

    // Admin
    const adminId = await createAdminUser("admin@p42.negotaitions");
    adminCookie = await createSessionCookie(adminId);

    // Create an event owned by User A
    eventId = uid("event");
    hostToken = `p42-host-${Date.now()}`;
    participantToken = `p42-pt-${Date.now()}`;

    await query(
      `INSERT INTO "TrainingEvent"
         ("id", "title", "status", "publicJoinCode", "hostToken", "hostUserId", "updatedAt")
       VALUES ($1, 'P42 Overview Event', 'LOBBY_OPEN', $2, $3, $4, NOW())`,
      [eventId, `p42-${Date.now().toString().slice(-8)}`, hostToken, userAId],
    );

    const epId = uid("ep");
    await query(
      `INSERT INTO "EventParticipant"
         ("id", "eventId", "userId", "displayName", "participantToken", "preference",
          "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate",
          "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, $3, 'User A Host', $4, 'FACILITATE', true, false, false, true, NOW(), NOW(), NOW())`,
      [epId, eventId, userAId, participantToken],
    );

    // Create a session linked to User A
    sessionId = uid("session");
    joinToken = `p42-join-${Date.now()}`;

    await query(
      `INSERT INTO "Session"
         ("id", "negotiationCaseId", "facilitatorId", "eventId", "title", "snapshotCaseTitle",
          "snapshotCaseLanguage", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, $4, 'P42 Overview Session', 'P42 Case', 'EN', 300, 900, NOW())`,
      [sessionId, negotiationCase.id, facilitator.id, eventId],
    );

    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "eventParticipantId", "type", "joinToken",
          "displayName", "notes", "updatedAt")
       VALUES ($1, $2, $3, $4, 'FACILITATOR', $5, 'User A Host', '', NOW())`,
      [uid("sp"), sessionId, userAId, epId, joinToken],
    );
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await cleanupTestUsers();
  });

  // ── Scoping tests ─────────────────────────────────────────────────────────

  test("User A receives own event in /api/events/overview", async ({ request }) => {
    const resp = await request.get("/api/events/overview", {
      headers: { Cookie: userACookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { events: Array<{ id: string }> };
    const ids = body.events.map((e) => e.id);
    expect(ids).toContain(eventId);
  });

  test("User B does NOT receive User A event in /api/events/overview", async ({ request }) => {
    const resp = await request.get("/api/events/overview", {
      headers: { Cookie: userBCookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { events: Array<{ id: string }> };
    const ids = body.events.map((e) => e.id);
    expect(ids).not.toContain(eventId);
  });

  test("User A receives own session in /api/sessions/overview", async ({ request }) => {
    const resp = await request.get("/api/sessions/overview", {
      headers: { Cookie: userACookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { sessions: Array<{ id: string }> };
    const ids = body.sessions.map((s) => s.id);
    expect(ids).toContain(sessionId);
  });

  test("User B does NOT receive User A session in /api/sessions/overview", async ({ request }) => {
    const resp = await request.get("/api/sessions/overview", {
      headers: { Cookie: userBCookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { sessions: Array<{ id: string }> };
    const ids = body.sessions.map((s) => s.id);
    expect(ids).not.toContain(sessionId);
  });

  test("Admin receives all events including User A event in /api/events/overview", async ({
    request,
  }) => {
    const resp = await request.get("/api/events/overview", {
      headers: { Cookie: adminCookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { events: Array<{ id: string }> };
    const ids = body.events.map((e) => e.id);
    expect(ids).toContain(eventId);
  });

  test("Admin receives all sessions including User A session in /api/sessions/overview", async ({
    request,
  }) => {
    const resp = await request.get("/api/sessions/overview", {
      headers: { Cookie: adminCookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { sessions: Array<{ id: string }> };
    const ids = body.sessions.map((s) => s.id);
    expect(ids).toContain(sessionId);
  });

  // ── Token safety ──────────────────────────────────────────────────────────

  const TOKEN_FIELDS = [
    "hostToken",
    "participantToken",
    "joinToken",
    "facilitatorJoinToken",
    "hostParticipantToken",
    "passwordHash",
    "sessionTokenHash",
  ] as const;

  test("/api/events/overview response body contains no token fields (User A)", async ({
    request,
  }) => {
    const resp = await request.get("/api/events/overview", {
      headers: { Cookie: userACookie },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    for (const field of TOKEN_FIELDS) {
      expect(text, `Response must not contain "${field}"`).not.toContain(field);
    }
    // Also verify actual token values are absent
    expect(text).not.toContain(hostToken);
    expect(text).not.toContain(participantToken);
  });

  test("/api/sessions/overview response body contains no token fields (User A)", async ({
    request,
  }) => {
    const resp = await request.get("/api/sessions/overview", {
      headers: { Cookie: userACookie },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    for (const field of TOKEN_FIELDS) {
      expect(text, `Response must not contain "${field}"`).not.toContain(field);
    }
    expect(text).not.toContain(joinToken);
  });

  test("/api/events/overview response body contains no token fields (Admin)", async ({
    request,
  }) => {
    const resp = await request.get("/api/events/overview", {
      headers: { Cookie: adminCookie },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    for (const field of TOKEN_FIELDS) {
      expect(text, `Response must not contain "${field}" in admin response`).not.toContain(field);
    }
    expect(text).not.toContain(hostToken);
    expect(text).not.toContain(participantToken);
  });

  test("/api/sessions/overview response body contains no token fields (Admin)", async ({
    request,
  }) => {
    const resp = await request.get("/api/sessions/overview", {
      headers: { Cookie: adminCookie },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    for (const field of TOKEN_FIELDS) {
      expect(text, `Response must not contain "${field}" in admin response`).not.toContain(field);
    }
    expect(text).not.toContain(joinToken);
  });
});
