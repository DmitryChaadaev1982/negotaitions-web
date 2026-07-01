import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, createE2eCase, query } from "./helpers/db";

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
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'FACILITATOR',$4,'Presence Facilitator',NOW(),NOW(),NOW())`,
    [facilitatorParticipantId, sessionId, facilitatorUserId, `presence-fac-${Date.now()}`],
  );

  return {
    sessionId,
    facilitatorParticipantId,
    facilitatorCookie: await createUserSession(facilitatorUserId),
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
});
