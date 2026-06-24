import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
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
  expect(response.ok()).toBeTruthy();
}

test("Events page compact UI shows multi-session stats without horizontal overflow", async ({
  page,
  request,
}) => {
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

  await page.goto("/dashboard");
  const dashboardEvent = page.getByTestId("event-card").filter({ hasText: event.title });
  await expect(dashboardEvent.getByTestId("event-total-sessions")).toContainText("2");
  await expect(dashboardEvent.getByTestId("event-active-sessions")).toContainText("1");
  await expect(dashboardEvent.getByTestId("event-finished-sessions")).toContainText("1");
});

test("participant can finish one session, return to lobby, and join another", async ({
  page,
  request,
}) => {
  const negotiationCase = await createTestCase();
  const event = await createTestEvent({
    withParticipants: true,
    title: "E2E Sequential Participant Event",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const maria = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
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
  await page.goto(`/room/${session1.id}?joinToken=${mariaSession1.joinToken}`);
  await expect(page.getByTestId("session-finished-message")).toBeVisible();
  await expect(page.getByTestId("return-to-event-lobby-button")).toBeVisible();
  await expect(page.getByTestId("open-session-materials-button")).toBeVisible();

  await page.getByTestId("return-to-event-lobby-button").click();
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

test("duplicate active assignment is blocked and completed event preserves materials", async ({
  page,
  request,
}) => {
  const negotiationCase = await createTestCase();
  const event = await createTestEvent({
    withParticipants: true,
    title: "E2E Duplicate Assignment Event",
  });
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

  await page.goto("/events");
  const row = page.getByTestId("event-row").filter({ hasText: event.title });
  await expect(row.getByTestId("event-status-badge").first()).toContainText(/Completed|Завершена/);
  await expect(row.getByTestId("open-event-lobby-button")).toHaveCount(0);
  await expect(row.getByTestId("open-event-results-button").first()).toBeVisible();

  const session1 = await getSession(session1Body.session.id);
  const igorSession = participantByName(session1.participants, "Igor");
  await page.goto(`/join/${igorSession.joinToken}`);
  await expect(page.getByTestId("session-materials-page")).toBeVisible();
  await expect(page.getByTestId("private-role-section")).toBeVisible();
  await expect(page.getByText("Vendor Project Director")).not.toBeVisible();
});
