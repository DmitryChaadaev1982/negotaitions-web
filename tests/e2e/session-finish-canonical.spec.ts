import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  createE2eEvent,
  getEventParticipants,
  participantByName,
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
    facilitatorUserId,
    facilitatorCookie: await createUserSession(facilitatorUserId),
  };
}

async function createEventLinkedSessionFixture() {
  const kase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: `E2E Complete Auth Event ${Date.now()}`,
  });

  const eventHostUserId = await createActiveUser(
    `event-host-${Date.now()}@test.invalid`,
    "Event Host",
  );
  const eventFacilitatorOwnerUserId = await createActiveUser(
    `event-fac-owner-${Date.now()}@test.invalid`,
    "Event Facilitator Owner",
  );
  const assignedSessionFacilitatorUserId = await createActiveUser(
    `event-session-fac-${Date.now()}@test.invalid`,
    "Assigned Session Facilitator",
  );
  const eventParticipantUserId = await createActiveUser(
    `event-participant-${Date.now()}@test.invalid`,
    "Event Participant",
  );
  const sessionObserverUserId = await createActiveUser(
    `event-observer-${Date.now()}@test.invalid`,
    "Event Observer",
  );

  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId" = $2,
         "facilitatorUserId" = $3,
         "visibility" = 'PUBLIC',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, eventHostUserId, eventFacilitatorOwnerUserId],
  );

  const eventParticipants = await getEventParticipants(event.id);
  const dmitry = participantByName(eventParticipants, "Dmitry");
  const igor = participantByName(eventParticipants, "Igor");
  const serg = participantByName(eventParticipants, "Serg");
  await query(`UPDATE "EventParticipant" SET "userId" = $2 WHERE "id" = $1`, [
    dmitry.id,
    eventHostUserId,
  ]);
  await query(`UPDATE "EventParticipant" SET "userId" = $2 WHERE "id" = $1`, [
    igor.id,
    eventParticipantUserId,
  ]);
  await query(`UPDATE "EventParticipant" SET "userId" = $2 WHERE "id" = $1`, [
    serg.id,
    sessionObserverUserId,
  ]);

  const sessionId = `e2e-event-finish-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await query(
    `INSERT INTO "Session"
      ("id", "negotiationCaseId", "facilitatorId", "eventId", "title", "snapshotCaseTitle",
       "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
       "preparationDurationSeconds", "durationSeconds", "status", "updatedAt")
    VALUES ($1, $2, $3, $4, 'E2E Event Complete Session', $5,
       'E2E canonical context', 'E2E canonical instructions', 'EN', 300, 900, 'READY', NOW())`,
    [sessionId, kase.id, assignedSessionFacilitatorUserId, event.id, kase.title],
  );

  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","eventParticipantId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES
      ($1,$4,$5,$6,'FACILITATOR',$7,'Assigned Session Facilitator',NOW(),NOW(),NOW()),
      ($2,$4,$8,$9,'PARTICIPANT',$10,'Event Participant',NOW(),NOW(),NOW()),
      ($3,$4,$11,$12,'OBSERVER',$13,'Event Observer',NOW(),NOW(),NOW())`,
    [
      id("sp"),
      id("sp"),
      id("sp"),
      sessionId,
      assignedSessionFacilitatorUserId,
      dmitry.id,
      `join-fac-${Date.now()}`,
      eventParticipantUserId,
      igor.id,
      `join-part-${Date.now()}`,
      sessionObserverUserId,
      serg.id,
      `join-obs-${Date.now()}`,
    ],
  );

  return {
    sessionId,
    eventId: event.id,
    hostToken: event.hostToken,
    users: {
      eventHostUserId,
      eventFacilitatorOwnerUserId,
      assignedSessionFacilitatorUserId,
      eventParticipantUserId,
      sessionObserverUserId,
    },
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

  test("administrative complete endpoint is idempotent for manager", async ({
    request,
  }) => {
    const fixture = await createSessionFixture();
    const headers = cookieHeader(fixture.facilitatorCookie);

    const first = await request.post(`/api/sessions/${fixture.sessionId}/complete`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {},
    });
    expect(first.ok()).toBeTruthy();
    const firstPayload = (await first.json()) as {
      completed: boolean;
      alreadyCompleted: boolean;
      negotiationState: string;
    };
    expect(firstPayload.completed).toBe(true);
    expect(firstPayload.alreadyCompleted).toBe(false);
    expect(firstPayload.negotiationState).toBe("FINISHED");

    const second = await request.post(`/api/sessions/${fixture.sessionId}/complete`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {},
    });
    expect(second.ok()).toBeTruthy();
    const secondPayload = (await second.json()) as {
      completed: boolean;
      alreadyCompleted: boolean;
      negotiationState: string;
    };
    expect(secondPayload.completed).toBe(false);
    expect(secondPayload.alreadyCompleted).toBe(true);
    expect(secondPayload.negotiationState).toBe("FINISHED");
  });

  test("administrative complete endpoint denies participant", async ({
    request,
  }) => {
    const fixture = await createSessionFixture();
    const participantUserId = await createActiveUser(
      `finish-participant-${Date.now()}@test.invalid`,
      "Finish Participant",
    );
    const participantCookie = await createUserSession(participantUserId);
    await query(
      `INSERT INTO "SessionParticipant"
        ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
       VALUES ($1,$2,$3,'PARTICIPANT',$4,'Finish Participant',NOW(),NOW(),NOW())`,
      [id("sp"), fixture.sessionId, participantUserId, `finish-player-${Date.now()}`],
    );

    const response = await request.post(`/api/sessions/${fixture.sessionId}/complete`, {
      headers: {
        ...cookieHeader(participantCookie),
        "Content-Type": "application/json",
      },
      data: {},
    });

    expect(response.status()).toBe(403);
  });

  test("administrative complete endpoint denies observer [ST310-SESSION-007]", async ({
    request,
  }) => {
    const fixture = await createSessionFixture();
    const observerUserId = await createActiveUser(
      `finish-observer-${Date.now()}@test.invalid`,
      "Finish Observer",
    );
    const observerCookie = await createUserSession(observerUserId);
    await query(
      `INSERT INTO "SessionParticipant"
        ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
       VALUES ($1,$2,$3,'OBSERVER',$4,'Finish Observer',NOW(),NOW(),NOW())`,
      [id("sp"), fixture.sessionId, observerUserId, `finish-observer-${Date.now()}`],
    );

    const response = await request.post(`/api/sessions/${fixture.sessionId}/complete`, {
      headers: {
        ...cookieHeader(observerCookie),
        "Content-Type": "application/json",
      },
      data: {},
    });

    expect(response.status()).toBe(403);
  });

  test("administrative complete authorization matrix for event sessions and host tokens", async ({
    request,
  }) => {
    const fixture = await createEventLinkedSessionFixture();
    const nonMemberUserId = await createActiveUser(
      `finish-nonmember-${Date.now()}@test.invalid`,
      "Finish NonMember",
    );
    const adminUserId = id("admin");
    await query(
      `INSERT INTO "User"
         ("id","email","passwordHash","name","globalRole","status","updatedAt")
       VALUES ($1,$2,'hash','Finish Admin','ADMIN','ACTIVE',NOW())`,
      [adminUserId, `finish-admin-${Date.now()}@test.invalid`],
    );

    const eventHostCookie = await createUserSession(fixture.users.eventHostUserId);
    const eventFacilitatorOwnerCookie = await createUserSession(
      fixture.users.eventFacilitatorOwnerUserId,
    );
    const sessionFacilitatorCookie = await createUserSession(
      fixture.users.assignedSessionFacilitatorUserId,
    );
    const participantCookie = await createUserSession(fixture.users.eventParticipantUserId);
    const observerCookie = await createUserSession(fixture.users.sessionObserverUserId);
    const nonMemberCookie = await createUserSession(nonMemberUserId);
    const adminCookie = await createUserSession(adminUserId);

    // wrong-event host token must not authorize.
    const anotherEvent = await createE2eEvent({ title: `Wrong Host Token ${Date.now()}` });

    // Participant/observer deny.
    {
      const participantResponse = await request.post(
        `/api/sessions/${fixture.sessionId}/complete`,
        {
          headers: {
            ...cookieHeader(participantCookie),
            "Content-Type": "application/json",
          },
          data: {},
        },
      );
      expect(participantResponse.status()).toBe(403);

      const observerResponse = await request.post(
        `/api/sessions/${fixture.sessionId}/complete`,
        {
          headers: {
            ...cookieHeader(observerCookie),
            "Content-Type": "application/json",
          },
          data: {},
        },
      );
      expect(observerResponse.status()).toBe(403);
    }

    // Non-member is non-disclosing.
    {
      const nonMemberResponse = await request.post(
        `/api/sessions/${fixture.sessionId}/complete`,
        {
          headers: {
            ...cookieHeader(nonMemberCookie),
            "Content-Type": "application/json",
          },
          data: {},
        },
      );
      expect(nonMemberResponse.status()).toBe(404);
    }

    // Host/facilitator/admin/assigned facilitator are authorized.
    for (const token of [
      adminCookie,
      eventHostCookie,
      eventFacilitatorOwnerCookie,
      sessionFacilitatorCookie,
    ]) {
      const response = await request.post(`/api/sessions/${fixture.sessionId}/complete`, {
        headers: {
          ...cookieHeader(token),
          "Content-Type": "application/json",
        },
        data: {},
      });
      expect(response.ok()).toBeTruthy();
    }

    // Host-token flow: valid, invalid, wrong-event
    {
      const validHostToken = await request.post(
        `/api/sessions/${fixture.sessionId}/complete`,
        {
          headers: { "Content-Type": "application/json" },
          data: { hostToken: fixture.hostToken },
        },
      );
      expect(validHostToken.ok()).toBeTruthy();

      const invalidHostToken = await request.post(
        `/api/sessions/${fixture.sessionId}/complete`,
        {
          headers: { "Content-Type": "application/json" },
          data: { hostToken: "invalid-token" },
        },
      );
      expect(invalidHostToken.status()).toBe(404);

      const wrongEventHostToken = await request.post(
        `/api/sessions/${fixture.sessionId}/complete`,
        {
          headers: { "Content-Type": "application/json" },
          data: { hostToken: anotherEvent.hostToken },
        },
      );
      expect(wrongEventHostToken.status()).toBe(404);
    }
  });

  test("event lobby state keeps room entry in DEBRIEF_OPEN for authorized users", async ({
    request,
  }) => {
    const fixture = await createEventLinkedSessionFixture();
    const eventHostCookie = await createUserSession(fixture.users.eventHostUserId);
    const eventFacilitatorOwnerCookie = await createUserSession(
      fixture.users.eventFacilitatorOwnerUserId,
    );
    const participantCookie = await createUserSession(fixture.users.eventParticipantUserId);
    const observerCookie = await createUserSession(fixture.users.sessionObserverUserId);

    await query(
      `UPDATE "Session"
       SET "negotiationState" = 'FINISHED',
           "status" = 'READY',
           "roomLifecycle" = 'DEBRIEF_OPEN',
           "closedByEventAt" = NULL,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [fixture.sessionId],
    );

    type EventStatePayload = {
      sessions: Array<{
        id: string;
        roomLifecycle: string | null;
        canEnterRoom: boolean;
        roomAccessDecision: string | null;
        roomUrl: string | null;
      }>;
    };

    for (const actor of [
      { cookie: eventHostCookie },
      { cookie: eventFacilitatorOwnerCookie },
      { cookie: participantCookie },
      { cookie: observerCookie },
    ]) {
      const response = await request.get(`/api/events/${fixture.eventId}/state`, {
        headers: cookieHeader(actor.cookie),
      });
      expect(response.ok()).toBeTruthy();
      const payload = (await response.json()) as EventStatePayload;
      const session = payload.sessions.find((item) => item.id === fixture.sessionId);
      expect(session?.roomLifecycle).toBe("DEBRIEF_OPEN");
      expect(session?.roomAccessDecision).toBe("ALLOW_DEBRIEF");
      expect(session?.canEnterRoom).toBe(true);
      expect(session?.roomUrl).toContain(`/room/${fixture.sessionId}`);
    }
  });

  test("host-token cannot complete standalone sessions", async ({ request }) => {
    const fixture = await createSessionFixture();
    const event = await createE2eEvent({ title: `Host token standalone deny ${Date.now()}` });

    const response = await request.post(`/api/sessions/${fixture.sessionId}/complete`, {
      headers: { "Content-Type": "application/json" },
      data: { hostToken: event.hostToken },
    });

    expect(response.status()).toBe(404);
  });
});
