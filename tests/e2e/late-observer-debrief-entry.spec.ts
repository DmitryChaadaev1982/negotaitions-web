import { createHash, randomBytes } from "node:crypto";

import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createTestCase,
  createTestEvent,
  e2eId,
  getEventParticipants,
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

async function createUserSessionRaw(userId: string) {
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

async function authHeaders(userId: string) {
  return { Cookie: `auth_session=${await createUserSessionRaw(userId)}` };
}

async function login(page: Page, userId: string) {
  const rawToken = await createUserSessionRaw(userId);
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

async function seedCookieConsent(page: Page) {
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

async function createSessionFromEvent(
  request: APIRequestContext,
  input: {
    eventId: string;
    hostToken: string;
    caseId: string;
    roomLabel: string;
    facilitatorEventParticipantId: string;
    roleAssignments: Array<{ caseRoleId: string; eventParticipantId: string }>;
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
      observerEventParticipantIds: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { session: { id: string } };
}

async function openDebriefSession(sessionId: string) {
  await query(
    `UPDATE "Session"
     SET "negotiationState" = 'FINISHED',
         "status" = 'READY',
         "roomLifecycle" = 'DEBRIEF_OPEN',
         "closedByEventAt" = NULL,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [sessionId],
  );
}

async function countActiveViewerGrants(sessionId: string, userId: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM "AiAnalysisPublicationGrant" g
     JOIN "AiAnalysisPublication" p ON p.id = g."publicationId"
     JOIN "AiAnalysis" a ON a.id = p."aiAnalysisId"
     WHERE a."sessionId" = $1
       AND p."revokedAt" IS NULL
       AND g."revokedAt" IS NULL
       AND g."userId" = $2`,
    [sessionId, userId],
  );
  return rows[0]?.count ?? 0;
}

async function seedPublication(sessionId: string, revoked: boolean) {
  const analysisId = e2eId("late-obs-analysis");
  const publicationId = e2eId("late-obs-pub");
  await query(
    `INSERT INTO "AiAnalysis"
       ("id","sessionId","status","analysisVersion","publicationEpoch","visibility",
        "executiveSummary","analysisJson","updatedAt","completedAt")
     VALUES ($1,$2,'COMPLETED',1,1,'SHARED_WITH_SESSION',
             'Late observer debrief summary','{"executiveSummary":"Late observer debrief summary"}',
             NOW(),NOW())`,
    [analysisId, sessionId],
  );
  await query(
    `INSERT INTO "AiAnalysisPublication"
       ("id","aiAnalysisId","analysisVersion","publicationEpoch",
        "sharedExecutiveSummary","sharedAnalysisJson","publishedAt","revokedAt","updatedAt")
     VALUES ($1,$2,1,1,'Late observer debrief summary',
             '{"executiveSummary":"Late observer debrief summary"}',NOW(),$3,NOW())`,
    [publicationId, analysisId, revoked ? new Date() : null],
  );
}

async function createUnassignedObserverFixture(request: APIRequestContext) {
  const negotiationCase = await createTestCase({
    title: "Late Observer Debrief Entry",
  });
  const [roleA, roleB] = negotiationCase.roles;
  const event = await createTestEvent({
    withParticipants: true,
    title: "Late Observer Debrief Event",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  if (!roleA || !roleB || !dmitry.userId || !serg.userId) {
    throw new Error("Late observer fixture is missing bound users.");
  }

  await query(
    `UPDATE "TrainingEvent"
     SET "status" = 'SESSION_CREATED',
         "visibility" = 'PRIVATE',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id],
  );

  const created = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Debrief Observe Room",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: roleA.id, eventParticipantId: igor.id },
      { caseRoleId: roleB.id, eventParticipantId: alex.id },
    ],
  });
  await openDebriefSession(created.session.id);

  return {
    event,
    sessionId: created.session.id,
    observerUserId: serg.userId,
  };
}

async function loadCreatedObserver(sessionId: string, userId: string) {
  const rows = await query<{ id: string; joinToken: string }>(
    `SELECT "id", "joinToken"
     FROM "SessionParticipant"
     WHERE "sessionId" = $1 AND "userId" = $2 AND "type" = 'OBSERVER'`,
    [sessionId, userId],
  );
  return rows[0] ?? null;
}

test("late Observer first DEBRIEF_OPEN entry is offered in Lobby and allowed on the direct room path", async ({
  page,
  request,
}) => {
  const fixture = await createUnassignedObserverFixture(request);
  const outsider = await createActiveUser();
  const observerCookie = await createUserSessionRaw(fixture.observerUserId);

  const stateResponse = await request.get(`/api/events/${fixture.event.id}/state`, {
    headers: { Cookie: `auth_session=${observerCookie}` },
  });
  expect(stateResponse.ok()).toBeTruthy();
  const state = (await stateResponse.json()) as {
    sessions: Array<{
      id: string;
      canJoinAsObserver: boolean;
      observerJoinUrl: string | null;
      sessionDisplayState: "joinable" | "materials-only" | "unavailable";
      roomLifecycle: string | null;
    }>;
  };
  const sessionState = state.sessions.find((session) => session.id === fixture.sessionId);
  expect(sessionState).toMatchObject({
    canJoinAsObserver: true,
    sessionDisplayState: "joinable",
    roomLifecycle: "DEBRIEF_OPEN",
  });
  expect(sessionState?.observerJoinUrl).toContain(`/room/${fixture.sessionId}`);

  await login(page, fixture.observerUserId);
  await seedCookieConsent(page);
  await page.goto(`/events/${fixture.event.id}/lobby`);
  const observeCard = page.getByTestId("available-observer-session-card");
  await expect(page.getByTestId("available-observer-session-section")).toBeVisible();
  await expect(observeCard).toContainText("Debrief Observe Room");
  await expect(observeCard.getByTestId("available-observer-session-status")).toHaveText(
    /Дебриф|Debrief/,
  );
  await expect(observeCard.getByTestId("join-session-as-observer")).toBeVisible();
  await expect(observeCard.getByTestId("join-session-as-observer")).toContainText(
    /Присоединиться к разбору|Join debrief/,
  );

  await page.goto(`/room/${fixture.sessionId}`);
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("debrief-panel").first()).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => (await loadCreatedObserver(fixture.sessionId, fixture.observerUserId))?.id ?? null)
    .not.toBeNull();

  const outsiderState = await request.get(`/api/events/${fixture.event.id}/state`, {
    headers: await authHeaders(outsider.id),
  });
  expect(outsiderState.status()).toBe(403);
  await login(page, outsider.id);
  await seedCookieConsent(page);
  await page.goto(`/room/${fixture.sessionId}`);
  await expect(
    page.getByRole("heading", {
      name: /You do not have access to this session|У вас нет доступа к этой сессии/i,
    }),
  ).toBeVisible();
});

test("first DEBRIEF_OPEN Observer entry materializes an active Observer grant", async ({
  page,
  request,
}) => {
  const published = await createUnassignedObserverFixture(request);
  await seedPublication(published.sessionId, false);

  await login(page, published.observerUserId);
  await seedCookieConsent(page);
  await page.goto(`/room/${published.sessionId}`);
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => loadCreatedObserver(published.sessionId, published.observerUserId))
    .not.toBeNull();
  const publishedParticipant = await loadCreatedObserver(
    published.sessionId,
    published.observerUserId,
  );
  expect(publishedParticipant).toBeTruthy();
  const claim = await request.get(
    `/api/sessions/${published.sessionId}/control-state?participantId=${publishedParticipant!.id}&connectionId=late-obs-pub-${publishedParticipant!.id}&claimLease=1`,
    { headers: await authHeaders(published.observerUserId) },
  );
  expect(claim.ok()).toBeTruthy();
  expect(await countActiveViewerGrants(published.sessionId, published.observerUserId)).toBe(1);
  const publishedStatus = await request.get(
    `/api/sessions/${published.sessionId}/materials/status?joinToken=${publishedParticipant!.joinToken}`,
    { headers: await authHeaders(published.observerUserId) },
  );
  expect(
    (await publishedStatus.json()) as { aiAnalysis: { canView: boolean } },
  ).toMatchObject({
    aiAnalysis: { canView: true },
  });
});

test("first DEBRIEF_OPEN Observer entry after Unshare does not create a revoked grant", async ({
  page,
  request,
}) => {
  const unshared = await createUnassignedObserverFixture(request);
  await seedPublication(unshared.sessionId, true);

  await login(page, unshared.observerUserId);
  await seedCookieConsent(page);
  await page.goto(`/room/${unshared.sessionId}`);
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => loadCreatedObserver(unshared.sessionId, unshared.observerUserId))
    .not.toBeNull();
  const unsharedRow = await loadCreatedObserver(unshared.sessionId, unshared.observerUserId);
  expect(unsharedRow).toBeTruthy();
  const unsharedClaim = await request.get(
    `/api/sessions/${unshared.sessionId}/control-state?participantId=${unsharedRow!.id}&connectionId=late-obs-unshare-${unsharedRow!.id}&claimLease=1`,
    { headers: await authHeaders(unshared.observerUserId) },
  );
  expect(unsharedClaim.ok()).toBeTruthy();
  expect(await countActiveViewerGrants(unshared.sessionId, unshared.observerUserId)).toBe(0);
  const unsharedStatus = await request.get(
    `/api/sessions/${unshared.sessionId}/materials/status?joinToken=${unsharedRow!.joinToken}`,
    { headers: await authHeaders(unshared.observerUserId) },
  );
  expect(
    (await unsharedStatus.json()) as { aiAnalysis: { canView: boolean } },
  ).toMatchObject({
    aiAnalysis: { canView: false },
  });
});
