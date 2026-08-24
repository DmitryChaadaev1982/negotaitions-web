import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  createUserSessionCookie,
  e2eId,
  e2eName,
  getEventParticipants,
  getSession,
  getTrainingEvent,
  participantByName,
  query,
} from "./helpers/db";
import { seedCookieConsent } from "./helpers/cookie-consent";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async ({ request }) => {
  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });
  await cleanupE2eData();
});

async function login(page: Page, userId: string) {
  const cookieHeader = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookieHeader.slice("auth_session=".length),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function insertHistoricalCompletedChild(input: {
  sessionId: string;
  caseId: string;
  userId: string;
  eventId: string;
  title: string;
}) {
  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","eventId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$5,'context','instructions','EN','COMPLETED','FINISHED','CLOSED',300,900,NOW())`,
    [input.sessionId, input.caseId, input.userId, input.eventId, input.title],
  );
}

async function staleLobbyPresence(eventId: string) {
  await query(
    `UPDATE "EventParticipant"
        SET "lastSeenAt"=NOW() - INTERVAL '10 minutes',
            "updatedAt"=NOW()
      WHERE "eventId"=$1`,
    [eventId],
  );
}

test("G-REUSE past Archive Event creates a Session via host POST and returns to Archive", async ({
  page,
}) => {
  const host = await createActiveUser({ preferredLocale: "en" });
  const negotiationCase = await createE2eCase();
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const event = await createE2eEvent({
    withParticipants: true,
    title: e2eName("Archive reuse Event"),
  });
  const participants = await getEventParticipants(event.id);
  const facilitator = participantByName(participants, "Dmitry");
  const firstPlayer = participantByName(participants, "Igor");
  const secondPlayer = participantByName(participants, "Alex");
  expect(facilitator.userId).toBeTruthy();

  await query(
    `UPDATE "TrainingEvent"
        SET "hostUserId"=$2,
            "facilitatorUserId"=$2,
            "status"='SESSION_CREATED',
            "scheduledAt"=NOW() - INTERVAL '2 days',
            "completedAt"=NULL,
            "updatedAt"=NOW()
      WHERE "id"=$1`,
    [event.id, host.id],
  );
  await insertHistoricalCompletedChild({
    sessionId: e2eId("archive-reuse-hist"),
    caseId: negotiationCase.id,
    userId: host.id,
    eventId: event.id,
    title: e2eName("Archive reuse historical session"),
  });
  await staleLobbyPresence(event.id);

  const beforeReuse = await getTrainingEvent(event.id);
  expect(beforeReuse.status).toBe("SESSION_CREATED");
  expect(beforeReuse.completedAt).toBeNull();

  await seedCookieConsent(page);
  await login(page, host.id);
  await page.goto("/dashboard");

  const archive = page.getByTestId("dashboard-archive-disclosure");
  await expect(archive).toBeVisible();
  await archive.locator("summary").click();

  const archiveCard = page
    .getByTestId("dashboard-archive-disclosure")
    .getByTestId("dashboard-event-card")
    .filter({ hasText: event.title });
  await expect(archiveCard).toHaveCount(1);
  await expect(archiveCard).toHaveAttribute("data-dashboard-lane", "archive");
  await expect(archiveCard).toHaveAttribute("data-event-terminal", "false");
  await expect(
    page
      .getByTestId("dashboard-upcoming-active-section")
      .getByTestId("dashboard-event-card")
      .filter({ hasText: event.title }),
  ).toHaveCount(0);

  await archiveCard.getByTestId("dashboard-event-lobby-action").click();
  await expect(page).toHaveURL(new RegExp(`/events/${event.id}/lobby`));
  await expect(page.getByText(event.title)).toBeVisible();
  await expect(page.getByText("Event unavailable")).toHaveCount(0);

  const afterLobby = await getTrainingEvent(event.id);
  expect(afterLobby.status).toBe("SESSION_CREATED");
  expect(afterLobby.completedAt).toBeNull();

  const createResponse = await page.request.post(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      caseId: negotiationCase.id,
      roomLabel: "Archive reuse room",
      preparationDurationSeconds: 120,
      negotiationDurationSeconds: 300,
      facilitatorEventParticipantId: facilitator.id,
      roleAssignments: [
        { caseRoleId: buyerRole.id, eventParticipantId: firstPlayer.id },
        { caseRoleId: sellerRole.id, eventParticipantId: secondPlayer.id },
      ],
      observerEventParticipantIds: [],
    },
  });
  const createBodyText = await createResponse.text();
  expect(
    createResponse.ok(),
    `G-REUSE-01 host POST failed: ${createResponse.status()} ${createBodyText.slice(0, 2000)}`,
  ).toBeTruthy();
  expect(createResponse.status()).not.toBe(403);
  expect(createResponse.status()).not.toBe(404);
  expect(createResponse.status()).not.toBe(409);
  expect(createResponse.status()).not.toBe(410);

  const created = JSON.parse(createBodyText) as { session: { id: string } };
  expect(created.session.id).toBeTruthy();

  const createdSession = await getSession(created.session.id);
  expect(createdSession.eventId).toBe(event.id);

  const afterCreate = await getTrainingEvent(event.id);
  expect(afterCreate.status).toBe("SESSION_CREATED");
  expect(afterCreate.completedAt).toBeNull();
  expect(afterCreate.completionReason).toBeNull();

  await staleLobbyPresence(event.id);
  await page.goto("/dashboard");
  await expect(
    page
      .getByTestId("dashboard-upcoming-active-section")
      .getByTestId("dashboard-event-card")
      .filter({ hasText: event.title }),
  ).toHaveCount(1);
  const activeCard = page
    .getByTestId("dashboard-upcoming-active-section")
    .getByTestId("dashboard-event-card")
    .filter({ hasText: event.title });
  await expect(activeCard).toHaveAttribute("data-dashboard-lane", "active");

  const completeResponse = await page.request.post(
    `/api/sessions/${created.session.id}/complete`,
    { data: { hostToken: event.hostToken } },
  );
  expect(
    completeResponse.ok(),
    `G-REUSE-02 session complete failed: ${completeResponse.status()} ${(await completeResponse.text()).slice(0, 2000)}`,
  ).toBeTruthy();

  await staleLobbyPresence(event.id);
  const afterComplete = await getTrainingEvent(event.id);
  expect(afterComplete.status).toBe("SESSION_CREATED");
  expect(afterComplete.completedAt).toBeNull();

  await page.goto("/dashboard");
  const archiveAfter = page.getByTestId("dashboard-archive-disclosure");
  await archiveAfter.locator("summary").click();
  await expect(
    page
      .getByTestId("dashboard-archive-disclosure")
      .getByTestId("dashboard-event-card")
      .filter({ hasText: event.title }),
  ).toHaveCount(1);
  await expect(
    page
      .getByTestId("dashboard-upcoming-active-section")
      .getByTestId("dashboard-event-card")
      .filter({ hasText: event.title }),
  ).toHaveCount(0);
});
