import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  getRecordingBySession,
  getRecordingStopOperations,
  getSessionNegotiationState,
  query,
  upsertRecordingForSession,
} from "./helpers/db";

// Stage 3.10 traceability:
// ST310-SESSION-001, ST310-SESSION-002, ST310-SESSION-003, ST310-RECORDING-004, ST310-RECORDING-010

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

async function createSessionFixture() {
  const kase = await createE2eCase();
  const facilitatorUserId = await createActiveUser(
    `finish-facilitator-${Date.now()}@test.invalid`,
    "Finish Facilitator",
  );
  const sessionId = `e2e-finish-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  await query(
    `INSERT INTO "Session"
      ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
       "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
       "preparationDurationSeconds", "durationSeconds", "updatedAt")
    VALUES ($1, $2, $3, 'E2E Canonical Finish Session', $4,
       'E2E canonical context', 'E2E canonical instructions', 'EN', 300, 900, NOW())`,
    [sessionId, kase.id, facilitatorUserId, kase.title],
  );

  const facilitatorParticipantId = id("sp");
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'FACILITATOR',$4,'Finish Facilitator',NOW(),NOW(),NOW())`,
    [facilitatorParticipantId, sessionId, facilitatorUserId, `finish-fac-${Date.now()}`],
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

test.describe("Canonical session finish", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  test("finish with active room connection keeps DEBRIEF_OPEN and is idempotent", async ({
    request,
  }) => {
    const fixture = await createSessionFixture();
    const headers = cookieHeader(fixture.facilitatorCookie);

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=finish-active&claimLease=1`,
      { headers },
    );
    expect(claim.ok()).toBeTruthy();

    // Ensure session is in active negotiation before finish semantics are asserted.
    const start = await request.post(`/api/sessions/${fixture.sessionId}/control`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        participantId: fixture.facilitatorParticipantId,
        connectionId: "finish-active",
        action: "START",
      },
    });
    expect(start.ok()).toBeTruthy();

    const firstFinish = await request.post(
      `/api/sessions/${fixture.sessionId}/control`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: "finish-active",
          action: "FINISH",
        },
      },
    );
    expect(firstFinish.ok()).toBeTruthy();

    const stateAfterFirstFinish = await getSessionNegotiationState(fixture.sessionId);
    expect(stateAfterFirstFinish.negotiationState).toBe("FINISHED");
    expect(stateAfterFirstFinish.roomLifecycle).toBe("DEBRIEF_OPEN");

    const secondFinish = await request.post(
      `/api/sessions/${fixture.sessionId}/control`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: "finish-active",
          action: "FINISH",
        },
      },
    );
    expect(secondFinish.ok()).toBeTruthy();

    const stateAfterSecondFinish = await getSessionNegotiationState(fixture.sessionId);
    expect(stateAfterSecondFinish.negotiationState).toBe("FINISHED");
    expect(stateAfterSecondFinish.roomLifecycle).toBe("DEBRIEF_OPEN");
  });

  test("finish without active room connection closes room", async ({ request }) => {
    const fixture = await createSessionFixture();
    const headers = cookieHeader(fixture.facilitatorCookie);

    const finish = await request.post(`/api/sessions/${fixture.sessionId}/control`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        participantId: fixture.facilitatorParticipantId,
        action: "FINISH",
      },
    });
    expect(finish.ok()).toBeTruthy();

    const state = await getSessionNegotiationState(fixture.sessionId);
    expect(state.negotiationState).toBe("FINISHED");
    expect(state.roomLifecycle).toBe("CLOSED");
  });

  test("finish creates one logical stop operation", async ({ request }) => {
    const fixture = await createSessionFixture();
    const headers = cookieHeader(fixture.facilitatorCookie);

    await upsertRecordingForSession({
      sessionId: fixture.sessionId,
      status: "RECORDING",
      provider: "LIVEKIT_CLOUD",
      egressId: null,
    });

    const claim = await request.get(
      `/api/livekit/sidebar?participantId=${fixture.facilitatorParticipantId}&connectionId=finish-stop&claimLease=1`,
      { headers },
    );
    expect(claim.ok()).toBeTruthy();

    const firstFinish = await request.post(
      `/api/sessions/${fixture.sessionId}/control`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: "finish-stop",
          action: "FINISH",
        },
      },
    );
    expect(firstFinish.ok()).toBeTruthy();

    const secondFinish = await request.post(
      `/api/sessions/${fixture.sessionId}/control`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: {
          participantId: fixture.facilitatorParticipantId,
          connectionId: "finish-stop",
          action: "FINISH",
        },
      },
    );
    expect(secondFinish.ok()).toBeTruthy();

    const operations = await getRecordingStopOperations(fixture.sessionId);
    expect(operations.length).toBe(1);
    expect(operations[0]!.state).toBe("DELIVERED");

    const recording = await getRecordingBySession(fixture.sessionId);
    expect(["STOPPED", "COMPLETED"]).toContain(recording?.status);
  });
});
