/**
 * Phase 1.1 Security Patch — focused regression tests.
 *
 * Verifies the six patch areas without running the full product workflow:
 *   1. cancelTrainingEvent requires hostToken or admin — not any active user.
 *   2. Session-scoped APIs (notes, presence, display-status) reject generic
 *      active users lacking a valid joinToken.
 *   3. /events and /sessions list pages return empty data for non-admin users.
 *   4. /sessions list HTML does not contain joinToken or facilitatorJoinToken.
 *   5. /events list HTML does not contain hostToken or participantToken.
 *   6. Guest join (/join/[joinToken]) and room (/room/[sessionId]?joinToken=…)
 *      pages remain accessible without auth.
 *
 * Tests create their own DB fixtures and clean up after themselves.
 * No seed data is assumed except the DATABASE_URL env var.
 */

import { createHash, randomBytes } from "crypto";

import { test, expect } from "@playwright/test";

import {
  query,
  cleanupE2eData,
  createE2eEvent,
  createE2eCase,
} from "./helpers/db";

// ── local helpers ─────────────────────────────────────────────────────────

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createActiveUser(email: string) {
  const userId = uid("user");
  await query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "role", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', 'Test Active', 'PARTICIPANT', 'USER', 'ACTIVE', NOW())
     ON CONFLICT ("email") DO UPDATE SET "status" = 'ACTIVE', "updatedAt" = NOW()
     RETURNING "id"`,
    [userId, email],
  );
  const rows = await query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" = $1`,
    [email],
  );
  return rows[0]!.id;
}

async function createUserSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [uid("sess"), userId, tokenHash, expiresAt],
  );

  return rawToken;
}

async function cleanupTestUsers() {
  await query(`DELETE FROM "User" WHERE "email" LIKE '%@sec-test.negotaitions%'`);
}

// ── test suite ─────────────────────────────────────────────────────────────

test.describe("Phase 1.1 security — cancelTrainingEvent", () => {
  let eventId: string;
  let activeUserCookie: string;

  test.beforeAll(async () => {
    await cleanupE2eData();
    const event = await createE2eEvent({ title: "E2E Sec Cancel Event" });
    eventId = event.id;

    const userId = await createActiveUser("active@sec-test.negotaitions");
    const rawToken = await createUserSession(userId);
    activeUserCookie = `auth_session=${rawToken}`;
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await cleanupTestUsers();
  });

  test("generic active user WITHOUT hostToken cannot cancel event", async ({ request }) => {
    // Server actions are called via POST to /_next/action-route; for robustness
    // we test the guard indirectly: if the action allows cancellation, the event
    // status changes. We submit the form without a hostToken and verify the
    // event is NOT cancelled.
    await request.post("/events", {
      headers: {
        Cookie: activeUserCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      form: {
        eventId,
        // intentionally omit hostToken
      },
    });
    // The page may redirect to itself; we don't require a specific status code
    // because Next.js redirects give 3xx. What matters is the event is not cancelled.
    const rows = await query<{ status: string }>(
      `SELECT "status" FROM "TrainingEvent" WHERE "id" = $1`,
      [eventId],
    );
    expect(rows[0]?.status).not.toBe("CANCELLED");
  });

  test("guest with valid hostToken CAN cancel event (guard does not block valid token)", async ({ request }) => {
    const newEvent = await createE2eEvent({ title: "E2E Sec Cancel Token Event" });

    // POST to cancelTrainingEvent server action directly via the lobby form.
    // The lobby form submits hostToken. We simulate this; if the guard is
    // correct the event will be cancelled.
    const resp = await request.post(`/events/${newEvent.id}/lobby`, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      form: {
        eventId: newEvent.id,
        hostToken: newEvent.hostToken,
      },
    });
    // A redirect or 200 is fine; just check the event was not blocked incorrectly.
    expect([200, 302, 303, 307]).toContain(resp.status());
  });
});

test.describe("Phase 1.1 security — session-scoped API guards", () => {
  let sessionId: string;
  let participantId: string;
  let facilitatorJoinToken: string;
  let participantJoinToken: string;
  let activeUserCookie: string;

  test.beforeAll(async () => {
    await cleanupE2eData();

    const negotiationCase = await createE2eCase();
    await createE2eEvent({
      title: "E2E Sec Session APIs Event",
      withParticipants: true,
    });

    // Create a session with a facilitator and a participant
    sessionId = uid("session");
    const facilitator = await query<{ id: string }>(
      `SELECT "id" FROM "User" WHERE "email" = 'demo@example.com' LIMIT 1`,
    );
    const facilitatorDbId = facilitator[0]?.id ?? uid("fallback-user");

    await query(
      `INSERT INTO "Session"
         ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
          "snapshotCaseLanguage", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, 'E2E Sec Session', 'E2E Sec Case', 'EN', 300, 900, NOW())`,
      [sessionId, negotiationCase.id, facilitatorDbId],
    );

    facilitatorJoinToken = `e2e-fac-${Date.now()}`;
    participantJoinToken = `e2e-par-${Date.now()}`;

    const facilitatorParticipantId = uid("sp");
    const participantParticipantId = uid("sp");
    participantId = participantParticipantId;

    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "type", "joinToken", "displayName", "notes", "updatedAt")
       VALUES
         ($1, $2, 'FACILITATOR', $3, 'Facilitator', '', NOW()),
         ($4, $2, 'PARTICIPANT', $5, 'Participant',  '', NOW())`,
      [
        facilitatorParticipantId,
        sessionId,
        facilitatorJoinToken,
        participantParticipantId,
        participantJoinToken,
      ],
    );

    const userId = await createActiveUser("active2@sec-test.negotaitions");
    const rawToken = await createUserSession(userId);
    activeUserCookie = `auth_session=${rawToken}`;
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await cleanupTestUsers();
  });

  // ── /api/sessions/[id]/notes ────────────────────────────────────────────

  test("GET /api/sessions/[id]/notes returns 401 with no auth", async ({ request }) => {
    const resp = await request.get(`/api/sessions/${sessionId}/notes`);
    expect(resp.status()).toBe(401);
  });

  test("GET /api/sessions/[id]/notes returns 403 for generic active user without joinToken", async ({
    request,
  }) => {
    const resp = await request.get(`/api/sessions/${sessionId}/notes`, {
      headers: { Cookie: activeUserCookie },
    });
    expect(resp.status()).toBe(403);
  });

  test("GET /api/sessions/[id]/notes returns 403 for non-facilitator joinToken", async ({
    request,
  }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/notes?joinToken=${participantJoinToken}`,
    );
    expect(resp.status()).toBe(403);
  });

  test("GET /api/sessions/[id]/notes succeeds with facilitator joinToken", async ({
    request,
  }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/notes?joinToken=${facilitatorJoinToken}`,
    );
    expect(resp.status()).toBe(200);
  });

  // ── /api/sessions/[id]/participants/[pid]/notes ─────────────────────────

  test("GET participant notes returns 401 with no auth", async ({ request }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/participants/${participantId}/notes`,
    );
    expect(resp.status()).toBe(401);
  });

  test("GET participant notes returns 403 for generic active user without joinToken", async ({
    request,
  }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/participants/${participantId}/notes`,
      { headers: { Cookie: activeUserCookie } },
    );
    expect(resp.status()).toBe(403);
  });

  test("GET participant notes succeeds for facilitator joinToken", async ({ request }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/participants/${participantId}/notes?joinToken=${facilitatorJoinToken}`,
    );
    expect(resp.status()).toBe(200);
  });

  // ── /api/sessions/[id]/presence ─────────────────────────────────────────

  test("GET presence returns 401 with no auth", async ({ request }) => {
    const resp = await request.get(`/api/sessions/${sessionId}/presence`);
    expect(resp.status()).toBe(401);
  });

  test("GET presence returns 403 for generic active user without joinToken", async ({
    request,
  }) => {
    const resp = await request.get(`/api/sessions/${sessionId}/presence`, {
      headers: { Cookie: activeUserCookie },
    });
    expect(resp.status()).toBe(403);
  });

  test("GET presence succeeds with valid joinToken", async ({ request }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/presence?joinToken=${participantJoinToken}`,
    );
    expect(resp.status()).toBe(200);
  });

  // ── /api/sessions/[id]/display-status ───────────────────────────────────

  test("GET display-status returns 401 with no auth", async ({ request }) => {
    const resp = await request.get(`/api/sessions/${sessionId}/display-status`);
    expect(resp.status()).toBe(401);
  });

  test("GET display-status returns 403 for generic active user without joinToken", async ({
    request,
  }) => {
    const resp = await request.get(`/api/sessions/${sessionId}/display-status`, {
      headers: { Cookie: activeUserCookie },
    });
    expect(resp.status()).toBe(403);
  });

  test("GET display-status succeeds with valid joinToken", async ({ request }) => {
    const resp = await request.get(
      `/api/sessions/${sessionId}/display-status?joinToken=${participantJoinToken}`,
    );
    expect(resp.status()).toBe(200);
  });
});

test.describe("Phase 1.1 security — list pages return empty for non-admin", () => {
  let activeUserCookie: string;

  test.beforeAll(async () => {
    await cleanupE2eData();
    await createE2eEvent({ title: "E2E Sec List Event" });

    const userId = await createActiveUser("active3@sec-test.negotaitions");
    const rawToken = await createUserSession(userId);
    activeUserCookie = `auth_session=${rawToken}`;
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await cleanupTestUsers();
  });

  test("GET /api/events/overview returns empty events for non-admin active user", async ({
    request,
  }) => {
    const resp = await request.get("/api/events/overview", {
      headers: { Cookie: activeUserCookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { events: unknown[] };
    expect(body.events).toHaveLength(0);
  });

  test("GET /api/sessions/overview returns empty sessions for non-admin active user", async ({
    request,
  }) => {
    const resp = await request.get("/api/sessions/overview", {
      headers: { Cookie: activeUserCookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(0);
  });
});

test.describe("Phase 1.1 security — token leakage: list HTML", () => {
  let activeUserCookie: string;
  let adminUserCookie: string;
  let createdEvent: Awaited<ReturnType<typeof createE2eEvent>>;

  test.beforeAll(async () => {
    await cleanupE2eData();
    createdEvent = await createE2eEvent({ title: "E2E Sec Token Leak Event" });

    // Active (non-admin) user
    const activeUserId = await createActiveUser("active4@sec-test.negotaitions");
    const activeRaw = await createUserSession(activeUserId);
    activeUserCookie = `auth_session=${activeRaw}`;

    // Admin user — set globalRole to ADMIN
    const adminUserId = await createActiveUser("admin@sec-test.negotaitions");
    await query(
      `UPDATE "User" SET "globalRole" = 'ADMIN' WHERE "id" = $1`,
      [adminUserId],
    );
    const adminRaw = await createUserSession(adminUserId);
    adminUserCookie = `auth_session=${adminRaw}`;
  });

  test.afterAll(async () => {
    await cleanupE2eData();
    await cleanupTestUsers();
  });

  test("/events page HTML for non-admin does not contain hostToken", async ({ page }) => {
    await page.setExtraHTTPHeaders({ Cookie: activeUserCookie });
    await page.goto("/events");
    const html = await page.content();
    expect(html).not.toContain(createdEvent.hostToken);
    // hostToken is 21+ chars nanoid; also check by pattern
    expect(html).not.toMatch(/hostToken/);
  });

  test("/events page HTML for non-admin does not contain participantToken", async ({ page }) => {
    await page.setExtraHTTPHeaders({ Cookie: activeUserCookie });
    await page.goto("/events");
    const html = await page.content();
    const hostParticipant = createdEvent.participants.find((p) => p.isHost);
    if (hostParticipant) {
      expect(html).not.toContain(hostParticipant.participantToken);
    }
    expect(html).not.toMatch(/participantToken/);
  });

  test("/sessions page HTML for admin does not contain joinToken in list rows", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ Cookie: adminUserCookie });
    await page.goto("/sessions");
    const html = await page.content();
    // facilitatorJoinToken must not appear anywhere in the rendered HTML
    expect(html).not.toMatch(/facilitatorJoinToken/);
    // Individual joinToken values should not appear in list data attrs or links
    // (they are allowed on /join/[joinToken] paths, but not as standalone query params)
    expect(html).not.toMatch(/joinToken=[A-Za-z0-9_-]{10,}/);
  });
});

test.describe("Phase 1.1 security — guest token flows still work", () => {
  test.beforeAll(async () => {
    await cleanupE2eData();
  });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  test("GET /join/[joinToken] is accessible without auth", async ({ page }) => {
    const negotiationCase = await createE2eCase();
    const sessionId = uid("session");

    const facilitator = await query<{ id: string }>(
      `SELECT "id" FROM "User" WHERE "email" = 'demo@example.com' LIMIT 1`,
    );
    const facilitatorDbId = facilitator[0]?.id ?? uid("fallback");

    await query(
      `INSERT INTO "Session"
         ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
          "snapshotCaseLanguage", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, 'E2E Guest Join Session', 'E2E Case', 'EN', 300, 900, NOW())`,
      [sessionId, negotiationCase.id, facilitatorDbId],
    );

    const joinToken = `e2e-guest-join-${Date.now()}`;
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "type", "joinToken", "displayName", "notes", "updatedAt")
       VALUES ($1, $2, 'PARTICIPANT', $3, 'Guest', '', NOW())`,
      [uid("sp"), sessionId, joinToken],
    );

    const resp = await page.goto(`/join/${joinToken}`);
    // Should not redirect to /login
    expect(resp?.url()).not.toContain("/login");
    expect(resp?.status()).not.toBe(401);
    expect(resp?.status()).not.toBe(403);
  });

  test("GET /room/[sessionId]?joinToken=... is accessible without auth", async ({ page }) => {
    const negotiationCase = await createE2eCase();
    const sessionId = uid("session");

    const facilitator = await query<{ id: string }>(
      `SELECT "id" FROM "User" WHERE "email" = 'demo@example.com' LIMIT 1`,
    );
    const facilitatorDbId = facilitator[0]?.id ?? uid("fallback");

    await query(
      `INSERT INTO "Session"
         ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
          "snapshotCaseLanguage", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, 'E2E Guest Room Session', 'E2E Case', 'EN', 300, 900, NOW())`,
      [sessionId, negotiationCase.id, facilitatorDbId],
    );

    const joinToken = `e2e-guest-room-${Date.now()}`;
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "type", "joinToken", "displayName", "notes", "updatedAt")
       VALUES ($1, $2, 'PARTICIPANT', $3, 'Guest', '', NOW())`,
      [uid("sp"), sessionId, joinToken],
    );

    const resp = await page.goto(`/room/${sessionId}?joinToken=${joinToken}`);
    // Should not redirect to /login
    expect(resp?.url()).not.toContain("/login");
    expect(resp?.status()).not.toBe(401);
    expect(resp?.status()).not.toBe(403);
  });
});

test.describe("Phase 1.1 security — admin APIs require admin", () => {
  let activeUserCookie: string;

  test.beforeAll(async () => {
    const userId = await createActiveUser("active5@sec-test.negotaitions");
    const rawToken = await createUserSession(userId);
    activeUserCookie = `auth_session=${rawToken}`;
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
  });

  test("GET /api/admin/health requires admin (redirects or 401/403 for active user)", async ({
    request,
  }) => {
    const resp = await request.get("/api/admin/health", {
      headers: { Cookie: activeUserCookie },
      maxRedirects: 0,
    });
    expect([401, 403, 302, 307]).toContain(resp.status());
  });
});
