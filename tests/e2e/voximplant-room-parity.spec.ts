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

async function createParityFixture() {
  const kase = await createE2eCase();

  const facilitatorUserId = await createActiveUser(
    `vox-parity-facilitator-${Date.now()}@test.invalid`,
    "Parity Facilitator",
  );
  const p1UserId = await createActiveUser(
    `vox-parity-p1-${Date.now()}@test.invalid`,
    "Parity P1",
  );
  const p2UserId = await createActiveUser(
    `vox-parity-p2-${Date.now()}@test.invalid`,
    "Parity P2",
  );
  const o1UserId = await createActiveUser(
    `vox-parity-o1-${Date.now()}@test.invalid`,
    "Parity O1",
  );
  const o2UserId = await createActiveUser(
    `vox-parity-o2-${Date.now()}@test.invalid`,
    "Parity O2",
  );

  const sessionId = `e2e-vox-parity-${Date.now()}`;
  await query(
    `INSERT INTO "Session"
      ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
       "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
       "preparationDurationSeconds", "durationSeconds", "updatedAt")
    VALUES ($1, $2, $3, 'E2E Vox Parity Session', $4,
       'E2E parity context', 'E2E parity instructions', 'EN', 300, 900, NOW())`,
    [sessionId, kase.id, facilitatorUserId, kase.title],
  );

  const role1Id = id("srole");
  const role2Id = id("srole");
  await query(
    `INSERT INTO "SessionRole"
      ("id", "sessionId", "name", "privateInstructions", "objectives", "constraints",
       "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
     VALUES
      ($1, $3, 'Participant A', '', '', '', '', '', 0, NOW()),
      ($2, $3, 'Participant B', '', '', '', '', '', 1, NOW())`,
    [role1Id, role2Id, sessionId],
  );

  const facilitatorParticipantId = id("sp");
  const participant1Id = id("sp");
  const participant2Id = id("sp");
  const observer1Id = id("sp");
  const observer2Id = id("sp");
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","sessionRoleId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES
      ($1,$6,$7,NULL,'FACILITATOR',$11,'Facilitator',NOW(),NOW(),NOW()),
      ($2,$6,$8,$12,'PARTICIPANT',$13,'Participant 1',NOW(),NOW(),NOW()),
      ($3,$6,$9,$14,'PARTICIPANT',$15,'Participant 2',NOW(),NOW(),NOW()),
      ($4,$6,$10,NULL,'OBSERVER',$16,'Observer 1',NOW(),NOW(),NOW()),
      ($5,$6,$17,NULL,'OBSERVER',$18,'Observer 2',NOW(),NOW(),NOW())`,
    [
      facilitatorParticipantId,
      participant1Id,
      participant2Id,
      observer1Id,
      observer2Id,
      sessionId,
      facilitatorUserId,
      p1UserId,
      p2UserId,
      o1UserId,
      `fac-${Date.now()}`,
      role1Id,
      `p1-${Date.now()}`,
      role2Id,
      `p2-${Date.now()}`,
      `o1-${Date.now()}`,
      o2UserId,
      `o2-${Date.now()}`,
    ],
  );

  return {
    sessionId,
    facilitatorParticipantId,
    participant1Id,
    facilitatorCookie: await createUserSession(facilitatorUserId),
    participantCookie: await createUserSession(p1UserId),
  };
}

function cookieHeader(rawToken: string) {
  return { Cookie: `auth_session=${rawToken}` };
}

test.describe("Vox room parity (API state)", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: Awaited<ReturnType<typeof createParityFixture>>;

  test.beforeAll(async () => {
    fixture = await createParityFixture();
  });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  test("roster returns facilitator + 2 participants + 2 observers", async ({ request }) => {
    const res = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=parity-roster-1&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { roster: Array<{ participantType: string }> };
    expect(body.roster.filter((item) => item.participantType === "FACILITATOR")).toHaveLength(1);
    expect(body.roster.filter((item) => item.participantType === "PARTICIPANT")).toHaveLength(2);
    expect(body.roster.filter((item) => item.participantType === "OBSERVER")).toHaveLength(2);
  });

  test("timer/control-state is server-backed and survives transitions", async ({ request }) => {
    const authHeaders = cookieHeader(fixture.facilitatorCookie);
    const connectionId = "parity-timer-fac-1";

    const stateBefore = await request.get(
      `/api/sessions/${fixture.sessionId}/control-state?participantId=${fixture.facilitatorParticipantId}&connectionId=${connectionId}&claimLease=1`,
      { headers: authHeaders },
    );
    expect(stateBefore.ok()).toBeTruthy();
    const beforeBody = (await stateBefore.json()) as {
      negotiationState: string;
      remainingSeconds: number;
      preparationRemainingSeconds: number;
    };
    expect(beforeBody.negotiationState).toBe("PREPARATION");
    expect(beforeBody.remainingSeconds).toBeGreaterThan(0);
    expect(beforeBody.preparationRemainingSeconds).toBeGreaterThan(0);

    const start = await request.post(`/api/sessions/${fixture.sessionId}/control`, {
      headers: authHeaders,
      data: {
        participantId: fixture.facilitatorParticipantId,
        connectionId,
        action: "START",
      },
    });
    expect(start.ok()).toBeTruthy();
    const started = (await start.json()) as { negotiationState: string };
    expect(started.negotiationState).toBe("RUNNING");

    const paused = await request.post(`/api/sessions/${fixture.sessionId}/control`, {
      headers: authHeaders,
      data: {
        participantId: fixture.facilitatorParticipantId,
        connectionId,
        action: "PAUSE",
      },
    });
    expect(paused.ok()).toBeTruthy();
    const pausedBody = (await paused.json()) as { negotiationState: string };
    expect(pausedBody.negotiationState).toBe("PAUSED");
  });

  test("audio policy state transitions are role-aware", async ({ request }) => {
    const facilitatorState = await request.get(
      `/api/sessions/${fixture.sessionId}/control-state?participantId=${fixture.facilitatorParticipantId}&connectionId=parity-audio-fac&claimLease=1`,
      { headers: cookieHeader(fixture.facilitatorCookie) },
    );
    expect(facilitatorState.ok()).toBeTruthy();
    const facBody = (await facilitatorState.json()) as { negotiationState: string; micAllowed: boolean };
    expect(facBody.negotiationState).toBe("PAUSED");
    expect(facBody.micAllowed).toBe(false);

    const participantState = await request.get(
      `/api/sessions/${fixture.sessionId}/control-state?participantId=${fixture.participant1Id}&connectionId=parity-audio-p1&claimLease=1`,
      { headers: cookieHeader(fixture.participantCookie) },
    );
    expect(participantState.ok()).toBeTruthy();
    const pBody = (await participantState.json()) as { negotiationState: string; micAllowed: boolean };
    expect(pBody.negotiationState).toBe("PAUSED");
    expect(pBody.micAllowed).toBe(false);
  });
});
