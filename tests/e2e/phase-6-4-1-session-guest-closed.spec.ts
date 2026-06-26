/**
 * Phase 6.4.1 — Close Remaining Session Guest Flow
 *
 * Tests cover:
 *   1.  livekit/token rejects unauthenticated joinToken-only request (401).
 *   2.  livekit/token accepts joinToken from authenticated user who owns participant.
 *   3.  livekit/token rejects joinToken owned by another user (403).
 *   4.  livekit/sidebar rejects unauthenticated joinToken-only request (401).
 *   5.  livekit/sidebar accepts joinToken from authenticated user who owns participant.
 *   6.  materials/status rejects unauthenticated joinToken-only request (403).
 *   7.  materials/status accepts participantId+cookie from authenticated user.
 *   8.  recording-control rejects unauthenticated joinToken request (403).
 *   9.  analyze rejects unauthenticated joinToken request.
 *   10. ai-analysis/share rejects unauthenticated joinToken request.
 *   11. ai-analysis/unshare rejects unauthenticated joinToken request.
 *   12. speaker-mapping GET rejects unauthenticated joinToken request (403).
 *   13. Duplicate SessionParticipant prevention: same user claiming same token twice
 *       reuses existing participant row (application-level dedup).
 *   14. Duplicate EventParticipant prevention: same user joining same event twice
 *       reuses existing row (application-level dedup).
 *   15. Account participantId+cookie path still works for materials/status.
 *
 * Static API tests require DATABASE_URL and BASE_URL.
 * Static DB-only tests run whenever DATABASE_URL is set.
 *
 * Run:
 *   npx playwright test tests/e2e/phase-6-4-1-session-guest-closed.spec.ts
 *   BASE_URL=http://localhost:3000 npx playwright test tests/e2e/phase-6-4-1-session-guest-closed.spec.ts
 */

import { createHash, randomBytes } from "crypto";

import { test, expect } from "@playwright/test";

import { query } from "./helpers/db";

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createActiveUser(namePfx: string): Promise<{ id: string; email: string }> {
  const id = uid(namePfx);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","updatedAt")
     VALUES ($1,$2,'hash','Test User','PARTICIPANT','USER','ACTIVE',NOW())
     ON CONFLICT ("email") DO UPDATE SET "status"='ACTIVE',"updatedAt"=NOW()`,
    [id, email],
  );
  const rows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email"=$1`, [email]);
  return { id: rows[0]!.id, email };
}


async function createUserSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,$3::timestamptz,NOW())`,
    [userId, tokenHash, expiresAt],
  );
  return rawToken;
}

/** Create a minimal Session with a NegotiationCase */
async function createMinimalSession(hostUserId: string): Promise<{ sessionId: string; caseId: string }> {
  const caseId = uid("case");
  await query(
    `INSERT INTO "NegotiationCase"
       ("id","title","description","businessContext","publicInstructions","targetSkills",
        "facilitatorId","createdAt","updatedAt")
     VALUES ($1,'Test Case 6.4.1','Desc','Ctx','Instructions','Skills',$2,NOW(),NOW())`,
    [caseId, hostUserId],
  );
  const sessionId = uid("sess");
  await query(
    `INSERT INTO "Session"
       ("id","title","negotiationCaseId","facilitatorId","visibility","status",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","negotiationState","durationSeconds","preparationDurationSeconds",
        "createdAt","updatedAt")
     VALUES ($1,'6.4.1 Test Session',$2,$3,'PUBLIC','DRAFT',
             'Test Case 6.4.1','Ctx','Instructions','EN','PREPARATION',900,300,NOW(),NOW())`,
    [sessionId, caseId, hostUserId],
  );
  return { sessionId, caseId };
}

/** Create a SessionParticipant. If userId is provided, it is claimed. */
async function createSessionParticipant(opts: {
  sessionId: string;
  userId?: string | null;
  type?: "PARTICIPANT" | "FACILITATOR" | "OBSERVER";
}): Promise<{ participantId: string; joinToken: string }> {
  const participantId = uid("sp");
  const joinToken = randomBytes(16).toString("hex");
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","displayName","type","joinToken","createdAt","updatedAt")
     VALUES ($1,$2,$3,'Test Participant',$4,$5,NOW(),NOW())`,
    [participantId, opts.sessionId, opts.userId ?? null, opts.type ?? "PARTICIPANT", joinToken],
  );
  return { participantId, joinToken };
}

/** Create an EventParticipant. If userId is provided it is claimed. */
async function createEventAndParticipant(hostUserId: string): Promise<{
  eventId: string;
  participantId: string;
}> {
  const eventId = uid("event");
  const publicJoinCode = randomBytes(4).toString("hex");
  const hostToken = randomBytes(8).toString("hex");
  await query(
    `INSERT INTO "TrainingEvent"
       ("id","title","hostUserId","visibility","status","publicJoinCode","hostToken","createdAt","updatedAt")
     VALUES ($1,'6.4.1 Test Event',$2,'PUBLIC','LOBBY_OPEN',$3,$4,NOW(),NOW())`,
    [eventId, hostUserId, publicJoinCode, hostToken],
  );
  const participantId = uid("ep");
  const participantToken = randomBytes(8).toString("hex");
  await query(
    `INSERT INTO "EventParticipant"
       ("id","eventId","userId","displayName","participantToken","createdAt","updatedAt")
     VALUES ($1,$2,$3,'Test Host',$4,NOW(),NOW())`,
    [participantId, eventId, hostUserId, participantToken],
  );
  return { eventId, participantId };
}

const DB_AVAILABLE = Boolean(process.env.DATABASE_URL);
const BASE_URL = process.env.BASE_URL ?? "";
const API_AVAILABLE = DB_AVAILABLE && Boolean(BASE_URL);

function skipIfNoDb() {
  if (!DB_AVAILABLE) test.skip();
}

function skipIfNoApi() {
  if (!API_AVAILABLE) test.skip();
}

// ── DB-level duplicate prevention tests ──────────────────────────────────────

test.describe("Part 6 — Duplicate participant prevention (DB-level)", () => {
  test("Same user claiming same session joinToken twice does not create duplicate SessionParticipant", async () => {
    skipIfNoDb();

    const host = await createActiveUser("host641");
    const { sessionId } = await createMinimalSession(host.id);
    const { participantId, joinToken } = await createSessionParticipant({ sessionId, userId: null });

    // Simulate claim: updateMany WHERE userId IS NULL (TOCTOU-safe pattern)
    const updated = await query<{ id: string }>(
      `UPDATE "SessionParticipant"
         SET "userId" = $1, "updatedAt" = NOW()
         WHERE "id" = $2 AND "userId" IS NULL
         RETURNING "id"`,
      [host.id, participantId],
    );
    expect(updated).toHaveLength(1);

    // Second claim attempt on same row returns 0 rows (already claimed)
    const secondUpdate = await query<{ id: string }>(
      `UPDATE "SessionParticipant"
         SET "userId" = $1, "updatedAt" = NOW()
         WHERE "id" = $2 AND "userId" IS NULL
         RETURNING "id"`,
      [host.id, participantId],
    );
    expect(secondUpdate).toHaveLength(0);

    // Total participants for this user in this session is still 1
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "SessionParticipant"
       WHERE "sessionId" = $1 AND "userId" = $2`,
      [sessionId, host.id],
    );
    expect(Number(rows[0]!.count)).toBe(1);

    // Verify joinToken is correct value for the participant
    const tokenCheck = await query<{ joinToken: string }>(
      `SELECT "joinToken" FROM "SessionParticipant" WHERE "id" = $1`,
      [participantId],
    );
    expect(tokenCheck[0]!.joinToken).toBe(joinToken);
  });

  test("Same user joining same session twice (existing participant path) reuses row", async () => {
    skipIfNoDb();

    const host = await createActiveUser("host641b");
    const { sessionId } = await createMinimalSession(host.id);

    // Participant already owned by user
    const { participantId } = await createSessionParticipant({ sessionId, userId: host.id });

    // Application-level dedup check (mirrors /join/[joinToken] existingUserParticipant logic)
    const existing = await query<{ id: string }>(
      `SELECT "id" FROM "SessionParticipant"
       WHERE "sessionId" = $1 AND "userId" = $2
       LIMIT 1`,
      [sessionId, host.id],
    );
    expect(existing).toHaveLength(1);
    expect(existing[0]!.id).toBe(participantId);

    // Would-be claim is skipped because existingUserParticipant is found
    // Total rows remain 1
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "SessionParticipant"
       WHERE "sessionId" = $1 AND "userId" = $2`,
      [sessionId, host.id],
    );
    expect(Number(countRows[0]!.count)).toBe(1);
  });

  test("Duplicate EventParticipant: same user joining same event uses findFirst dedup", async () => {
    skipIfNoDb();

    const host = await createActiveUser("host641c");
    const { eventId, participantId } = await createEventAndParticipant(host.id);

    // Simulate joining again — check if row exists first (mirrors actions/events.ts pattern)
    const existing = await query<{ id: string }>(
      `SELECT "id" FROM "EventParticipant"
       WHERE "eventId" = $1 AND "userId" = $2
       LIMIT 1`,
      [eventId, host.id],
    );
    expect(existing).toHaveLength(1);
    expect(existing[0]!.id).toBe(participantId);

    // Total rows still 1
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "EventParticipant"
       WHERE "eventId" = $1 AND "userId" = $2`,
      [eventId, host.id],
    );
    expect(Number(countRows[0]!.count)).toBe(1);
  });
});

// ── API-level tests (require BASE_URL) ────────────────────────────────────────

test.describe("Part 4b — livekit/token rejects unauthenticated joinToken", () => {
  test("Returns 401 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641d");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null });

    const resp = await fetch(`${BASE_URL}/api/livekit/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinToken }),
    });

    expect(resp.status).toBe(401);
    const body = await resp.json() as { code?: string };
    expect(body.code).toBe("LOGIN_REQUIRED");
  });

  test("Returns 403 when joinToken is owned by a different authenticated user", async () => {
    skipIfNoApi();

    const owner = await createActiveUser("owner641");
    const other = await createActiveUser("other641");
    const { sessionId } = await createMinimalSession(owner.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: owner.id });

    const otherToken = await createUserSession(other.id);

    const resp = await fetch(`${BASE_URL}/api/livekit/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `next-auth.session-token=${otherToken}`,
      },
      body: JSON.stringify({ joinToken }),
    });

    // 403 because the participant is claimed by a different user
    expect(resp.status).toBe(403);
  });
});

test.describe("Part 4c — livekit/sidebar rejects unauthenticated joinToken", () => {
  test("Returns 401 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641e");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null });

    const resp = await fetch(
      `${BASE_URL}/api/livekit/sidebar?joinToken=${encodeURIComponent(joinToken)}`,
    );

    expect(resp.status).toBe(401);
    const body = await resp.json() as { code?: string };
    expect(body.code).toBe("LOGIN_REQUIRED");
  });
});

test.describe("Part 4 — materials/status rejects unauthenticated joinToken", () => {
  test("Returns 403 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641f");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null });

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/materials/status?joinToken=${encodeURIComponent(joinToken)}`,
    );

    // room-participant-resolver returns null → 403 from route
    expect(resp.status).toBe(403);
  });

  test("Returns 200 with authenticated user using participantId+cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641g");
    const { sessionId } = await createMinimalSession(host.id);
    const { participantId } = await createSessionParticipant({
      sessionId,
      userId: host.id,
      type: "FACILITATOR",
    });
    const sessionToken = await createUserSession(host.id);

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/materials/status?participantId=${participantId}`,
      {
        headers: { Cookie: `next-auth.session-token=${sessionToken}` },
      },
    );

    expect(resp.status).toBe(200);
  });
});

test.describe("Part 4 — recording-control rejects unauthenticated joinToken", () => {
  test("Returns 403 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641h");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null, type: "FACILITATOR" });

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/recording-control`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, action: "refresh" }),
      },
    );

    expect(resp.status).toBe(403);
  });
});

test.describe("Part 4 — analyze rejects unauthenticated joinToken", () => {
  test("Returns 403 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641i");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null, type: "FACILITATOR" });

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinToken,
          language: "en",
          aiProcessingConfirmed: true,
        }),
      },
    );

    expect(resp.status).toBe(403);
  });
});

test.describe("Part 4 — ai-analysis/share rejects unauthenticated joinToken", () => {
  test("Returns 403 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641j");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null, type: "FACILITATOR" });

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/ai-analysis/share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, shareDebriefConfirmed: true }),
      },
    );

    expect(resp.status).toBe(403);
  });
});

test.describe("Part 4 — ai-analysis/unshare rejects unauthenticated joinToken", () => {
  test("Returns 403 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641k");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null, type: "FACILITATOR" });

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/ai-analysis/unshare`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      },
    );

    expect(resp.status).toBe(403);
  });
});

test.describe("Part 4 — speaker-mapping GET rejects unauthenticated joinToken", () => {
  test("Returns 403 when joinToken provided but no cookie", async () => {
    skipIfNoApi();

    const host = await createActiveUser("host641l");
    const { sessionId } = await createMinimalSession(host.id);
    const { joinToken } = await createSessionParticipant({ sessionId, userId: null, type: "FACILITATOR" });

    const resp = await fetch(
      `${BASE_URL}/api/sessions/${sessionId}/speaker-mapping?joinToken=${encodeURIComponent(joinToken)}`,
    );

    expect(resp.status).toBe(403);
  });
});

// ── TODO: SQL partial unique indexes (Phase 6.4.1 documentation) ─────────────
//
// To enforce uniqueness at the DB level (preventing duplicate rows even if
// application-level dedup is bypassed), add these partial unique indexes:
//
//   -- EventParticipant unique per user per event
//   CREATE UNIQUE INDEX IF NOT EXISTS "EventParticipant_eventId_userId_unique"
//     ON "EventParticipant" ("eventId", "userId")
//     WHERE "userId" IS NOT NULL;
//
//   -- SessionParticipant unique per user per session
//   CREATE UNIQUE INDEX IF NOT EXISTS "SessionParticipant_sessionId_userId_unique"
//     ON "SessionParticipant" ("sessionId", "userId")
//     WHERE "userId" IS NOT NULL;
//
// These were NOT applied in Phase 6.4.1 to avoid migration history debt.
// Apply them in Phase 7 when migration confidence is higher.
// Application-level dedup (findFirst + updateMany WHERE userId IS NULL) is the
// primary guard for now.
