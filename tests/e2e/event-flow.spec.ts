import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  countEventParticipants,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  getE2eRunId,
  getEventParticipants,
  getSession,
  getTrainingEvent,
  participantByName,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

async function createUserSessionCookie(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,NOW() + INTERVAL '30 days',NOW())`,
    [userId, tokenHash],
  );
  return `auth_session=${rawToken}`;
}

async function loginToPageWithSessionCookie(
  page: import("@playwright/test").Page,
  cookieHeader: string,
  baseUrl: string,
) {
  const rawToken = cookieHeader.replace(/^auth_session=/, "");
  await page.context().addCookies([
    {
      name: "auth_session",
      value: rawToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("account-first join redirects unauth users and prevents duplicate event participants @browser-smoke", async ({
  page,
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Club Event Rejoin" });
  await query(`UPDATE "TrainingEvent" SET "visibility"='PUBLIC' WHERE "id"=$1`, [event.id]);
  const user = await createActiveUser();
  const authCookie = await createUserSessionCookie(user.id);

  await page.goto(`/events/${event.id}/join`);
  await expect(page).toHaveURL(new RegExp(`/login\\?returnUrl=.*events%2F${event.id}%2Fjoin`));

  const stateBefore = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: authCookie },
  });
  expect(stateBefore.ok()).toBeTruthy();
  await expect.poll(async () => countEventParticipants(event.id)).toBe(1);

  const stateAfter = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: authCookie },
  });
  expect(stateAfter.ok()).toBeTruthy();
  await expect.poll(async () => countEventParticipants(event.id)).toBe(1);

  const participants = await getEventParticipants(event.id);
  expect(participants).toHaveLength(1);
  expect(participants[0]?.displayName).toBeTruthy();
});

test("event session keeps event, preparation, and negotiation durations separate", async ({
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  const assignmentDraft = {
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: alex.id,
    },
    observerEventParticipantIds: [serg.id],
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createResponse.ok()).toBeTruthy();

  const body = (await createResponse.json()) as {
    session: { id: string };
    state: unknown;
  };

  const [updatedEvent, session] = await Promise.all([
    getTrainingEvent(event.id),
    getSession(body.session.id),
  ]);

  expect(updatedEvent.estimatedEventDurationSeconds).toBe(90 * 60);
  expect(session.eventId).toBe(event.id);
  expect(session.preparationDurationSeconds).toBe(5 * 60);
  expect(session.durationSeconds).toBe(15 * 60);
  expect(session.durationSeconds).not.toBe(updatedEvent.estimatedEventDurationSeconds);
  expect(session.snapshotCaseTitle).toBe(negotiationCase.title);
  expect(session.sessionRoles).toHaveLength(2);

  const sessionParticipants = session.participants;
  expect(participantByName(sessionParticipants, "Dmitry").type).toBe("FACILITATOR");
  expect(participantByName(sessionParticipants, "Igor").sessionRole?.name).toBe("Buyer");
  expect(participantByName(sessionParticipants, "Alex").sessionRole?.name).toBe("Seller");
  expect(participantByName(sessionParticipants, "Serg").type).toBe("OBSERVER");

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  const stateText = await stateResponse.text();
  expect(stateText).not.toContain("E2E_PRIVATE_IGOR_ONLY");
  expect(stateText).not.toContain("E2E_PRIVATE_ALEX_ONLY");
});

test("event lobby session setup uses role-slot rules and observer flow", async ({
  page,
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: "E2E Event Lobby Role Slot UI",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  for (let i = 0; i < 10; i += 1) {
    await query(
      `INSERT INTO "EventParticipant"
        ("id", "eventId", "displayName", "participantToken", "preference",
         "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate",
         "joinedAt", "lastSeenAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'UNDECIDED',
        false, false, false, false, NOW(), NOW(), NOW())`,
      [event.id, `Extra ${i + 1}`, `extra-${getE2eRunId()}-${i}`],
    );
  }

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        facilitatorEventParticipantId: null,
        roleAssignments: {},
        observerEventParticipantIds: [],
        preparationDurationMinutes: 5,
        negotiationDurationMinutes: 15,
      },
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  await page.goto(`/events/${event.id}/lobby?hostToken=${event.hostToken}`);
  await page.getByTestId("configure-session-button").click();
  await expect(page.getByTestId("session-setup-section")).toBeVisible();

  await page.getByTestId("assign-facilitator-control").selectOption(dmitry.id);

  const roleSelects = page.locator('[data-testid="assign-role-control"]');
  await expect(roleSelects).toHaveCount(2);
  await roleSelects.nth(0).selectOption(igor.id);

  const secondSelectIgorOption = roleSelects
    .nth(1)
    .locator(`option[value="${igor.id}"]`);
  await expect(secondSelectIgorOption).toHaveJSProperty("disabled", true);
  await roleSelects.nth(1).selectOption(alex.id);

  const observerControl = page.getByTestId("assign-observer-control");
  await expect(observerControl).toContainText("Extra 10");
  await observerControl.getByLabel("Serg").check();

  await page.getByTestId("create-session-button").click();
  await expect(page.getByTestId("event-session-card")).toHaveCount(1);

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  expect(stateResponse.ok()).toBeTruthy();
  const state = (await stateResponse.json()) as {
    sessions: Array<{
      participants: Array<{
        displayName: string;
        participantType: string;
        roleName: string | null;
      }>;
    }>;
  };

  expect(state.sessions).toHaveLength(1);
  const createdParticipants = state.sessions[0]?.participants ?? [];
  const dmitryRow = createdParticipants.find(
    (participant) => participant.displayName === dmitry.displayName,
  );
  const igorRow = createdParticipants.find(
    (participant) => participant.displayName === igor.displayName,
  );
  const alexRow = createdParticipants.find(
    (participant) => participant.displayName === alex.displayName,
  );
  const sergRow = createdParticipants.find(
    (participant) => participant.displayName === serg.displayName,
  );

  expect(dmitryRow?.participantType).toBe("FACILITATOR");
  expect(igorRow?.participantType).toBe("PARTICIPANT");
  expect(alexRow?.participantType).toBe("PARTICIPANT");
  expect(igorRow?.roleName).toBe(buyerRole.name);
  expect(alexRow?.roleName).toBe(sellerRole.name);
  expect(sergRow?.participantType).toBe("OBSERVER");
});

test("event lobby host can finish active session from sessions board @browser-smoke", async ({
  page,
  request,
}) => {
  const host = await createActiveUser();
  const player1 = await createActiveUser();
  const player2 = await createActiveUser();
  const hostCookie = await createUserSessionCookie(host.id);
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    title: "E2E Lobby Finish Active Session",
  });
  const [buyerRole, sellerRole] = negotiationCase.roles;
  expect(buyerRole && sellerRole).toBeTruthy();

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, host.id],
  );
  await query(`DELETE FROM "EventParticipant" WHERE "eventId"=$1`, [event.id]);

  const hostParticipant = (
    await query<{ id: string }>(
      `INSERT INTO "EventParticipant"
        ("id","eventId","userId","displayName","participantToken","isHost","preference","joinedAt","lastSeenAt","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,'Host',gen_random_uuid()::text,true,'FACILITATE',NOW(),NOW(),NOW(),NOW())
       RETURNING "id"`,
      [event.id, host.id],
    )
  )[0]!;
  const player1Participant = (
    await query<{ id: string }>(
      `INSERT INTO "EventParticipant"
        ("id","eventId","userId","displayName","participantToken","isHost","preference","joinedAt","lastSeenAt","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,'Player One',gen_random_uuid()::text,false,'PLAY',NOW(),NOW(),NOW(),NOW())
       RETURNING "id"`,
      [event.id, player1.id],
    )
  )[0]!;
  const player2Participant = (
    await query<{ id: string }>(
      `INSERT INTO "EventParticipant"
        ("id","eventId","userId","displayName","participantToken","isHost","preference","joinedAt","lastSeenAt","createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,'Player Two',gen_random_uuid()::text,false,'PLAY',NOW(),NOW(),NOW(),NOW())
       RETURNING "id"`,
      [event.id, player2.id],
    )
  )[0]!;

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    headers: { Cookie: hostCookie },
    data: {
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        facilitatorEventParticipantId: hostParticipant.id,
        roleAssignments: {
          [buyerRole!.id]: player1Participant.id,
          [sellerRole!.id]: player2Participant.id,
        },
        observerEventParticipantIds: [],
        roomLabel: "Room Finish",
        preparationDurationMinutes: 1,
        negotiationDurationMinutes: 2,
      },
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    headers: { Cookie: hostCookie },
    data: {},
  });
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as {
    session: { id: string };
  };

  await loginToPageWithSessionCookie(
    page,
    hostCookie,
    test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
  );
  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("host-controls-panel")).toBeVisible();
  await expect(page.getByTestId("finish-session-button")).toHaveCount(1);
  await page.getByTestId("finish-session-button").click();
  await page.getByTestId("confirm-complete-session-button").click();

  await expect
    .poll(async () => {
      const rows = await query<{ negotiationState: string }>(
        `SELECT "negotiationState" FROM "Session" WHERE "id"=$1`,
        [createPayload.session.id],
      );
      return rows[0]?.negotiationState ?? null;
    })
    .toBe("FINISHED");

  await expect(page.getByTestId("finish-session-button")).toHaveCount(0);
});

test("event lobby session setup can be cancelled", async ({ page, request }) => {
  const host = await createActiveUser();
  const hostCookie = await createUserSessionCookie(host.id);
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    title: "E2E Lobby Cancel Session Setup",
  });

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, host.id],
  );
  await query(`DELETE FROM "EventParticipant" WHERE "eventId"=$1`, [event.id]);
  await query(
    `INSERT INTO "EventParticipant"
      ("id","eventId","userId","displayName","participantToken","isHost","preference","joinedAt","lastSeenAt","createdAt","updatedAt")
     VALUES (gen_random_uuid(),$1,$2,'Host',gen_random_uuid()::text,true,'FACILITATE',NOW(),NOW(),NOW(),NOW())`,
    [event.id, host.id],
  );

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    headers: { Cookie: hostCookie },
    data: {
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        facilitatorEventParticipantId: null,
        roleAssignments: {},
        observerEventParticipantIds: [],
        roomLabel: "",
        preparationDurationMinutes: 1,
        negotiationDurationMinutes: 2,
      },
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  await loginToPageWithSessionCookie(page, hostCookie);
  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("host-controls-panel")).toBeVisible();

  await page.getByTestId("configure-session-button").click();
  await expect(page.getByTestId("session-setup-section")).toBeVisible();
  await page.getByTestId("room-label-input").fill("Will cancel");
  await page.getByTestId("cancel-session-setup-button").click();
  await expect(page.getByTestId("session-setup-section")).toHaveCount(0);
});

test("event-created session keeps explicitly assigned admin participant role", async ({
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true, title: "E2E Event Admin Assigned Role" });
  const adminUser = await createActiveUser("event_admin_assigned", "Event Admin", "ADMIN");
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  await query(
    `UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`,
    [serg.id, adminUser.id],
  );

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        facilitatorEventParticipantId: dmitry.id,
        roleAssignments: {
          [buyerRole.id]: igor.id,
          [sellerRole.id]: alex.id,
        },
        observerEventParticipantIds: [serg.id],
        preparationDurationMinutes: 5,
        negotiationDurationMinutes: 15,
      },
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createResponse.ok()).toBeTruthy();
  const body = (await createResponse.json()) as { session: { id: string } };

  const rows = await query<{ type: string }>(
    `SELECT "type" FROM "SessionParticipant" WHERE "sessionId"=$1 AND "userId"=$2`,
    [body.session.id, adminUser.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.type).toBe("OBSERVER");
});


