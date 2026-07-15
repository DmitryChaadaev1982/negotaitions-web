import { createHash, randomBytes } from "crypto";

import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createTestCase,
  createTestEvent,
  getEventParticipants,
  getSession,
  joinEventAsParticipant,
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

async function createSessionFromEvent(
  request: APIRequestContext,
  input: {
    eventId: string;
    hostToken: string;
    caseId: string;
    roomLabel: string;
    facilitatorEventParticipantId: string;
    roleAssignments: Array<{ caseRoleId: string; eventParticipantId: string }>;
    observerEventParticipantIds?: string[];
  },
) {
  const response = await request.post(`/api/events/${input.eventId}/host`, {
    data: {
      hostToken: input.hostToken,
      caseId: input.caseId,
      roomLabel: input.roomLabel,
      preparationDurationSeconds: 60,
      negotiationDurationSeconds: 120,
      facilitatorEventParticipantId: input.facilitatorEventParticipantId,
      roleAssignments: input.roleAssignments,
      observerEventParticipantIds: input.observerEventParticipantIds ?? [],
    },
  });

  return response;
}

async function finishSession(
  request: APIRequestContext,
  sessionId: string,
  facilitatorName = "Dmitry",
) {
  const session = await getSession(sessionId);
  const facilitator = participantByName(session.participants, facilitatorName);
  const response = await request.post(`/api/sessions/${sessionId}/control`, {
    data: { joinToken: facilitator.joinToken, action: "FINISH" },
  });
  if (response.ok()) {
    return;
  }

  const eventHost = (
    await query<{ hostToken: string | null }>(
      `SELECT e."hostToken"
       FROM "Session" s
       JOIN "TrainingEvent" e ON e."id" = s."eventId"
       WHERE s."id" = $1`,
      [sessionId],
    )
  )[0];
  expect(eventHost?.hostToken).toBeTruthy();
  const fallback = await request.post(`/api/sessions/${sessionId}/complete`, {
    data: { hostToken: eventHost!.hostToken! },
  });
  expect(fallback.ok()).toBeTruthy();
}

async function createUserSessionCookie(userId: string) {
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

async function loginWithUserSession(
  page: import("@playwright/test").Page,
  userId: string,
) {
  const rawToken = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: rawToken,
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function seedCookieConsent(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "negotaitions.cookieConsent.v1",
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: Date.now(),
      }),
    );
  });
}

async function dismissCookieBanner(page: import("@playwright/test").Page) {
  const banner = page.getByTestId("cookie-banner");
  const isVisible = await banner
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (!isVisible) {
    return;
  }

  const rejectOptional = page.getByRole("button", {
    name: /Reject optional|Отклонить необязательные/i,
  });
  if ((await rejectOptional.count()) > 0) {
    await rejectOptional.first().click();
    return;
  }

  const acceptAll = page.getByRole("button", {
    name: /Accept all|Принять все/i,
  });
  if ((await acceptAll.count()) > 0) {
    await acceptAll.first().click();
  }
}

test("Events page compact UI shows multi-session stats without horizontal overflow", async ({
  page,
  request,
}) => {
  const hostUser = await createActiveUser({
    email: `e2e-workflow-stats-host-${Date.now()}@test.negotaitions.local`,
  });
  const caseA = await createTestCase();
  const caseB = await createTestCase({
    title: "E2E Case B — Resource Conflict",
    difficulty: "MEDIUM",
    preparationSeconds: 3 * 60,
    negotiationSeconds: 8 * 60,
    roles: ["ERP Delivery Director", "Analytics Delivery Director"],
  });
  const event = await createTestEvent({
    withParticipants: true,
    title: "E2E Multi-session Stats Event",
  });
  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId" = $2,
         "facilitatorUserId" = $2,
         "visibility" = 'PUBLIC',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, hostUser.id],
  );
  await query(
    `UPDATE "TrainingEvent" SET "createdAt" = NOW() + INTERVAL '1 hour', "updatedAt" = NOW() + INTERVAL '1 hour' WHERE "id" = $1`,
    [event.id],
  );
  await joinEventAsParticipant(event.id, "Olga");
  await joinEventAsParticipant(event.id, "Ivan");

  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const olga = participantByName(participants, "Olga");
  const ivan = participantByName(participants, "Ivan");

  const session1Response = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: caseA.id,
    roomLabel: "Room A",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: caseA.roles[0]!.id, eventParticipantId: igor.id },
      { caseRoleId: caseA.roles[1]!.id, eventParticipantId: alex.id },
    ],
  });
  expect(session1Response.ok()).toBeTruthy();
  const session1 = (await session1Response.json()) as { session: { id: string } };
  await finishSession(request, session1.session.id);

  const session2Response = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: caseB.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: serg.id,
    roleAssignments: [
      { caseRoleId: caseB.roles[0]!.id, eventParticipantId: olga.id },
      { caseRoleId: caseB.roles[1]!.id, eventParticipantId: ivan.id },
    ],
  });
  expect(session2Response.ok()).toBeTruthy();

  await loginWithUserSession(page, hostUser.id);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/events");
  await expect(page.getByTestId("events-page")).toBeVisible();

  const row = page.getByTestId("event-row").filter({ hasText: event.title });
  await expect(row.getByTestId("event-total-sessions").first()).toContainText("2");
  await expect(row.getByTestId("event-active-sessions").first()).toContainText("1");
  await expect(row.getByTestId("event-finished-sessions").first()).toContainText("1");
  await expect(row.getByTestId("open-event-lobby-button").first()).toBeVisible();
  await expect(row.getByTestId("view-event-sessions-button").first()).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
});

test("participant can finish one session, return to lobby, and join another", async ({
  page,
  request,
}) => {
  const participantUser = await createActiveUser({
    email: `e2e-workflow-participant-${Date.now()}@test.negotaitions.local`,
  });
  const negotiationCase = await createTestCase();
  const event = await createTestEvent({
    withParticipants: true,
    title: "E2E Sequential Participant Event",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const maria = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  await query(`UPDATE "EventParticipant" SET "userId" = $2 WHERE "id" = $1`, [maria.id, participantUser.id]);
  const [roleA, roleB] = negotiationCase.roles;

  const session1Response = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room A",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: roleA!.id, eventParticipantId: maria.id },
      { caseRoleId: roleB!.id, eventParticipantId: alex.id },
    ],
  });
  expect(session1Response.ok()).toBeTruthy();
  const session1Body = (await session1Response.json()) as { session: { id: string } };
  const session1 = await getSession(session1Body.session.id);
  const mariaSession1 = participantByName(session1.participants, "Igor");

  await page.goto(`/events/${event.id}/lobby?participantToken=${maria.participantToken}`);
  await expect(page.getByTestId("assigned-session-card")).toContainText("Room A");
  await expect(
    page
      .getByTestId("assigned-session-card")
      .getByTestId("go-to-session-room-button"),
  ).toHaveAttribute("href", new RegExp(`/room/${session1.id}`));

  await finishSession(request, session1.id);
  const participantAuthToken = await createUserSessionCookie(participantUser.id);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: participantAuthToken,
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`/room/${session1.id}?joinToken=${mariaSession1.joinToken}`);
  await expect(page.getByText(/This session has finished|Сессия завершена/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open lobby|Открыть лобби/i }).first()).toBeVisible();
  await page.getByRole("link", { name: /Open lobby|Открыть лобби/i }).first().click();
  await expect(page.getByTestId("my-sessions-in-event-section")).toContainText("Room A");

  const session2Response = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: roleA!.id, eventParticipantId: maria.id },
      { caseRoleId: roleB!.id, eventParticipantId: alex.id },
    ],
  });
  expect(session2Response.ok()).toBeTruthy();
  const session2Body = (await session2Response.json()) as { session: { id: string } };

  await page.goto(`/events/${event.id}/lobby?participantToken=${maria.participantToken}`);
  await expect(page.getByTestId("assigned-session-card")).toContainText("Room B");
  await expect(page.getByTestId("my-sessions-in-event-section")).toContainText("Room A");
  await expect(page.getByTestId("go-to-session-room-button").first()).toHaveAttribute(
    "href",
    new RegExp(`/room/${session2Body.session.id}`),
  );

  const rejoinResponse = await request.post("/api/rejoin/validate", {
    headers: {
      Cookie: `auth_session=${participantAuthToken}`,
    },
    data: {
      type: "EVENT_LOBBY",
      eventId: event.id,
      participantToken: maria.participantToken,
    },
  });
  const rejoin = await rejoinResponse.json();
  expect(rejoin.valid).toBe(true);
  expect(rejoin.primaryAction).toBe("room");
  expect(rejoin.targetUrl).toContain(`/room/${session2Body.session.id}`);
});

test("event participant can join active event sessions as observer from lobby", async ({
  page,
  request,
}) => {
  const hostUser = await createActiveUser({
    email: `e2e-lobby-observer-host-${Date.now()}@test.negotaitions.local`,
  });
  const participantCUser = await createActiveUser({
    email: `e2e-lobby-observer-c-${Date.now()}@test.negotaitions.local`,
  });
  const outsiderUser = await createActiveUser({
    email: `e2e-lobby-observer-outsider-${Date.now()}@test.negotaitions.local`,
  });
  const negotiationCase = await createTestCase({
    title: "E2E Lobby Observer Join",
    roles: ["Procurement Lead", "Sales Director"],
  });
  const [roleA, roleB] = negotiationCase.roles;
  const event = await createTestEvent({
    withParticipants: true,
    title: "E2E Lobby Observer Event",
  });
  const chris = await joinEventAsParticipant(event.id, "Chris", "PLAY");

  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId" = $2,
         "facilitatorUserId" = $2,
         "visibility" = 'PRIVATE',
         "status" = 'SESSION_CREATED',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, hostUser.id],
  );

  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");

  await query(`UPDATE "EventParticipant" SET "userId" = NULL WHERE "eventId" = $1`, [event.id]);
  await query(`UPDATE "EventParticipant" SET "userId" = $2 WHERE "id" = $1`, [dmitry.id, hostUser.id]);
  await query(`UPDATE "EventParticipant" SET "userId" = $2 WHERE "id" = $1`, [chris.id, participantCUser.id]);

  const sessionAResponse = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room A",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: roleA!.id, eventParticipantId: igor.id },
      { caseRoleId: roleB!.id, eventParticipantId: alex.id },
    ],
  });
  expect(sessionAResponse.ok()).toBeTruthy();
  const sessionABody = (await sessionAResponse.json()) as { session: { id: string } };

  const finishedSessionBody = (
    await query<{ id: string }>(
      `INSERT INTO "Session"
        ("id","negotiationCaseId","facilitatorId","eventId","title","roomLabel",
         "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions","snapshotCaseLanguage",
         "status","negotiationState","roomLifecycle","preparationDurationSeconds","durationSeconds",
         "closedByEventAt","updatedAt")
       VALUES
        (gen_random_uuid(),$1,$2,$3,'Room Finished','Room Finished',$4,$5,$6,'EN',
         'COMPLETED','FINISHED','CLOSED',60,120,NOW(),NOW())
       RETURNING "id"`,
      [
        negotiationCase.id,
        hostUser.id,
        event.id,
        negotiationCase.title,
        negotiationCase.businessContext,
        negotiationCase.publicInstructions,
      ],
    )
  )[0]!;

  await query(
    `UPDATE "Session"
     SET "negotiationState" = 'RUNNING',
         "status" = 'READY',
         "roomLifecycle" = 'OPEN',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [sessionABody.session.id],
  );
  await query(
    `UPDATE "Session"
     SET "negotiationState" = 'FINISHED',
         "status" = 'COMPLETED',
         "roomLifecycle" = 'CLOSED',
         "closedByEventAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [finishedSessionBody.id],
  );

  const participantCookie = await createUserSessionCookie(participantCUser.id);
  const participantStateResponse = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: `auth_session=${participantCookie}` },
  });
  expect(participantStateResponse.ok()).toBeTruthy();
  const participantState = (await participantStateResponse.json()) as {
    currentParticipant: {
      id: string;
      displayName: string;
    } | null;
    participants: Array<{
      id: string;
      displayName: string;
      assignedSessionId: string | null;
    }>;
    sessions: Array<{
      id: string;
      roomLabel: string | null;
      canJoinAsObserver: boolean;
      observerJoinUrl: string | null;
    }>;
  };
  const roomAState = participantState.sessions.find(
    (session) => session.id === sessionABody.session.id,
  );
  expect(roomAState?.canJoinAsObserver).toBe(true);
  expect(roomAState?.observerJoinUrl).toContain(`/room/${sessionABody.session.id}`);

  await loginWithUserSession(page, participantCUser.id);
  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBanner(page);

  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  await expect(page.getByTestId("joinable-event-session-list")).toBeVisible();
  await expect(page.getByTestId("joinable-event-session-list")).toContainText("Room A");
  await expect(page.getByTestId("joinable-event-session-list")).not.toContainText("Room Finished");

  await dismissCookieBanner(page);
  await page
    .getByTestId("joinable-event-session-card")
    .filter({ hasText: "Room A" })
    .getByTestId("join-session-as-observer")
    .click();
  await expect(page).toHaveURL(new RegExp(`/room/${sessionABody.session.id}`));

  await expect
    .poll(async () => {
      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM "SessionParticipant"
         WHERE "sessionId" = $1
           AND "userId" = $2
           AND "type" = 'OBSERVER'`,
        [sessionABody.session.id, participantCUser.id],
      );
      return Number(rows[0]?.count ?? 0);
    })
    .toBe(1);

  await expect(page.getByTestId("start-preparation-button")).toHaveCount(0);
  await expect(page.getByTestId("start-negotiation-button")).toHaveCount(0);
  await expect(page.getByTestId("finish-negotiation-button")).toHaveCount(0);
  await expect(page.getByTestId("complete-event-button")).toHaveCount(0);
  await expect(page.getByText("E2E_PRIVATE_PROCUREMENT_LEAD_ONLY")).toHaveCount(0);
  await expect(page.getByText("E2E_PRIVATE_SALES_DIRECTOR_ONLY")).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/room/${sessionABody.session.id}`));
  await expect
    .poll(async () => {
      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM "SessionParticipant"
         WHERE "sessionId" = $1
           AND "userId" = $2
           AND "type" = 'OBSERVER'`,
        [sessionABody.session.id, participantCUser.id],
      );
      return Number(rows[0]?.count ?? 0);
    })
    .toBe(1);

  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBanner(page);
  await expect(page.getByTestId("assigned-session-card")).toContainText("Room A");
  await expect(
    page
      .getByTestId("assigned-session-card")
      .getByTestId("go-to-session-room-button"),
  ).toHaveCount(1);

  await finishSession(request, sessionABody.session.id);
  const sessionBResponse = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: roleA!.id, eventParticipantId: igor.id },
      { caseRoleId: roleB!.id, eventParticipantId: alex.id },
    ],
  });
  expect(sessionBResponse.ok()).toBeTruthy();
  const sessionBBody = (await sessionBResponse.json()) as { session: { id: string } };
  await query(
    `UPDATE "Session"
     SET "negotiationState" = 'FINISHED',
         "status" = 'COMPLETED',
         "roomLifecycle" = 'DEBRIEF_OPEN',
         "closedByEventAt" = NULL,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [sessionBBody.session.id],
  );

  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBanner(page);
  await expect(page.getByTestId("assigned-session-card")).toHaveCount(0);
  await expect(page.getByTestId("my-sessions-in-event-section")).toContainText("Room A");
  await expect(page.getByTestId("joinable-event-session-list")).toContainText("Room B");
  await expect(page.getByTestId("joinable-event-session-list")).not.toContainText("Room A");
  await dismissCookieBanner(page);
  await page
    .getByTestId("joinable-event-session-card")
    .filter({ hasText: "Room B" })
    .getByTestId("join-session-as-observer")
    .click();
  await expect(page).toHaveURL(new RegExp(`/room/${sessionBBody.session.id}`));

  await expect
    .poll(async () => {
      const rows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM "SessionParticipant"
         WHERE "sessionId" = $1
           AND "userId" = $2
           AND "type" = 'OBSERVER'`,
        [sessionBBody.session.id, participantCUser.id],
      );
      return Number(rows[0]?.count ?? 0);
    })
    .toBe(1);

  await query(
    `UPDATE "Session"
     SET "negotiationState" = 'FINISHED',
         "status" = 'COMPLETED',
         "roomLifecycle" = 'CLOSED',
         "closedByEventAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [sessionBBody.session.id],
  );
  const stateAfterSessionClosedResponse = await request.get(
    `/api/events/${event.id}/state`,
    {
      headers: { Cookie: `auth_session=${participantCookie}` },
    },
  );
  expect(stateAfterSessionClosedResponse.ok()).toBeTruthy();
  const stateAfterSessionClosed = (await stateAfterSessionClosedResponse.json()) as {
    sessions: Array<{
      id: string;
      canJoinAsObserver: boolean;
    }>;
  };
  const closedSessionState = stateAfterSessionClosed.sessions.find(
    (session) => session.id === sessionBBody.session.id,
  );
  expect(closedSessionState?.canJoinAsObserver).toBe(false);

  const ownerPage = await page.context().newPage();
  await loginWithUserSession(ownerPage, hostUser.id);
  await seedCookieConsent(ownerPage);
  await ownerPage.goto(`/events/${event.id}/lobby`);
  await dismissCookieBanner(ownerPage);
  await expect(ownerPage.getByTestId("session-board-section")).toBeVisible();
  await expect(ownerPage.getByTestId("joinable-event-session-list")).toHaveCount(0);
  await ownerPage.close();

  await query(
    `UPDATE "TrainingEvent"
     SET "status" = 'COMPLETED',
         "completedAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id],
  );
  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBanner(page);
  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("joinable-event-session-list")).toHaveCount(0);

  const outsiderCookie = await createUserSessionCookie(outsiderUser.id);
  const outsiderState = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: `auth_session=${outsiderCookie}` },
  });
  expect(outsiderState.status()).toBe(403);
  const outsiderRoom = await request.get(`/room/${sessionABody.session.id}`, {
    headers: { Cookie: `auth_session=${outsiderCookie}` },
    maxRedirects: 0,
  });
  expect([200, 302, 404]).toContain(outsiderRoom.status());
});

test("events list complete action uses danger-outline and keeps cancel stronger destructive", async ({
  page,
}) => {
  const hostUser = await createActiveUser({
    email: `e2e-events-complete-style-${Date.now()}@test.negotaitions.local`,
  });
  const event = await createTestEvent({
    withParticipants: false,
    title: "E2E Events Complete Action Style",
  });
  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId" = $2,
         "facilitatorUserId" = $2,
         "status" = 'LOBBY_OPEN',
         "visibility" = 'PUBLIC',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, hostUser.id],
  );

  await loginWithUserSession(page, hostUser.id);
  await page.goto("/events");

  const row = page.getByTestId("event-row").filter({ hasText: event.title }).first();
  const completeAction = row
    .getByTestId("event-complete-list-action")
    .getByTestId("complete-event-button");
  const cancelAction = row.getByTestId("cancel-event-button");

  await expect(completeAction).toBeVisible();
  await expect(cancelAction).toBeVisible();
  await expect(completeAction).toHaveAttribute("data-action-variant", "dangerOutline");
  await expect(cancelAction).toHaveAttribute("data-action-variant", "danger");
});

test("duplicate active assignment is blocked and completed event preserves materials [ST310-UI-003]", async ({
  page,
  request,
}) => {
  const hostUser = await createActiveUser({
    email: `e2e-workflow-host-${Date.now()}@test.negotaitions.local`,
  });
  const negotiationCase = await createTestCase();
  const event = await createTestEvent({
    withParticipants: true,
    title: "E2E Duplicate Assignment Event",
  });
  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId" = $2,
         "facilitatorUserId" = $2,
         "visibility" = 'PUBLIC',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, hostUser.id],
  );
  await joinEventAsParticipant(event.id, "Olga", "FACILITATE");
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const olga = participantByName(participants, "Olga");
  const [roleA, roleB] = negotiationCase.roles;

  const session1Response = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room A",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: roleA!.id, eventParticipantId: igor.id },
      { caseRoleId: roleB!.id, eventParticipantId: alex.id },
    ],
  });
  expect(session1Response.ok()).toBeTruthy();
  const session1Body = (await session1Response.json()) as { session: { id: string } };

  const duplicate = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: olga.id,
    roleAssignments: [
      { caseRoleId: roleA!.id, eventParticipantId: igor.id },
      { caseRoleId: roleB!.id, eventParticipantId: serg.id },
    ],
  });
  expect(duplicate.status()).toBe(400);
  await expect(duplicate.json()).resolves.toMatchObject({
    error: "participantAlreadyAssigned",
  });

  await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });

  await loginWithUserSession(page, hostUser.id);
  await page.goto("/events");
  const row = page
    .locator('[data-testid="event-row"]:visible')
    .filter({ hasText: event.title })
    .first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("event-status-badge")).toContainText(/Completed|Завершена/);
  await expect(row.getByTestId("open-event-lobby-button")).toHaveCount(0);
  await expect(row.getByTestId("view-event-sessions-button")).toBeVisible();

  const session1 = await getSession(session1Body.session.id);
  expect(session1.eventId).toBe(event.id);
  const igorSession = participantByName(session1.participants, "Igor");
  expect(igorSession.sessionId).toBe(session1.id);
  await page.goto(`/join/${igorSession.joinToken}`);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(
    page.locator('[data-testid="session-materials-page"], [data-testid="account-materials-page"]'),
  ).toBeVisible();
  await expect(page.getByText(/Private instructions|Личные инструкции/)).toBeVisible();
  await expect(page.getByText("E2E_PRIVATE_VENDOR_PROJECT_DIRECTOR_ONLY")).toHaveCount(0);
  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(
    page.locator('[data-testid="session-materials-page"], [data-testid="account-materials-page"]'),
  ).toBeVisible();
});
