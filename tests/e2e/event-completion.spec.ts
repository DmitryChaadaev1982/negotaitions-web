import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  countTranscripts,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  forceSessionRunningForE2e,
  getEventParticipants,
  getExternalServiceEvent,
  getRecordingBySession,
  getRecordingStopOperations,
  getSessionNegotiationState,
  getTrainingEvent,
  participantByName,
  query,
  upsertRecordingForSession,
} from "./helpers/db";
import { seedCookieConsent } from "./helpers/cookie-consent";

// Stage 3.10 traceability:
// ST310-EVENT-001..010, ST310-NAV-005, ST310-RACE-007, ST310-RACE-010

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test.afterEach(async ({ request }) => {
  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });
});

async function dismissCookieBannerIfVisible(page: import("@playwright/test").Page) {
  const banner = page.getByTestId("cookie-banner");
  const accept = page.getByTestId("cookie-accept-all");
  if ((await accept.count()) > 0) {
    await accept.click();
  }
  await expect(banner).toHaveCount(0);
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
  return `auth_session=${rawToken}`;
}

async function loginToPageWithSessionCookie(
  page: import("@playwright/test").Page,
  cookieHeader: string,
  baseUrl = test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
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

async function createEventSession(request: import("@playwright/test").APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const seededParticipants = await getEventParticipants(event.id);
  const dmitry = participantByName(seededParticipants, "Dmitry");
  const igor = participantByName(seededParticipants, "Igor");
  const alex = participantByName(seededParticipants, "Alex");
  const serg = participantByName(seededParticipants, "Serg");
  const [dmitryUser, igorUser, alexUser, sergUser] = await Promise.all([
    createActiveUser(),
    createActiveUser(),
    createActiveUser(),
    createActiveUser(),
  ]);
  await Promise.all([
    query(`UPDATE "EventParticipant" SET "userId" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
      dmitry.id,
      dmitryUser.id,
    ]),
    query(`UPDATE "EventParticipant" SET "userId" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
      igor.id,
      igorUser.id,
    ]),
    query(`UPDATE "EventParticipant" SET "userId" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
      alex.id,
      alexUser.id,
    ]),
    query(`UPDATE "EventParticipant" SET "userId" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
      serg.id,
      sergUser.id,
    ]),
  ]);
  const participants = await getEventParticipants(event.id);
  const dmitryWithUser = participantByName(participants, "Dmitry");
  const igorWithUser = participantByName(participants, "Igor");
  const alexWithUser = participantByName(participants, "Alex");
  const sergWithUser = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  const assignmentDraft = {
    facilitatorEventParticipantId: dmitryWithUser.id,
    roleAssignments: {
      [buyerRole.id]: igorWithUser.id,
      [sellerRole.id]: alexWithUser.id,
    },
    observerEventParticipantIds: [sergWithUser.id],
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };

  const configureResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
    },
  });
  const configureBodyText = await configureResponse.text();
  if (!configureResponse.ok()) {
    throw new Error(
      [
        "Failed to configure Event before session creation",
        "HTTP method: PATCH",
        `Path: /api/events/${event.id}/host`,
        `HTTP status: ${configureResponse.status()}`,
        `Response body: ${(configureBodyText || "<empty>").slice(0, 3000)}`,
      ].join("\n"),
    );
  }

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  const createResponseText = await createResponse.text();
  if (!createResponse.ok()) {
    throw new Error(
      [
        "Failed to create Event Session",
        "HTTP method: POST",
        `Path: /api/events/${event.id}/host`,
        `HTTP status: ${createResponse.status()}`,
        `Response body: ${(createResponseText || "<empty>").slice(0, 3000)}`,
      ].join("\n"),
    );
  }
  expect(createResponse.ok()).toBeTruthy();

  let body: { session: { id: string } };
  try {
    body = JSON.parse(createResponseText) as { session: { id: string } };
  } catch {
    throw new Error(
      `Create Event Session returned invalid JSON: ${(createResponseText || "<empty>").slice(0, 3000)}`,
    );
  }
  if (!body?.session?.id) {
    throw new Error(
      `Create Event Session returned invalid payload: ${(createResponseText || "<empty>").slice(0, 3000)}`,
    );
  }

  return { event, sessionId: body.session.id, participants, negotiationCase };
}

async function createSessionInEvent(
  request: import("@playwright/test").APIRequestContext,
  input: {
    eventId: string;
    hostToken: string;
    caseId: string;
    roomLabel: string;
    facilitatorEventParticipantId: string;
    roleAssignments: Record<string, string>;
    observerEventParticipantIds?: string[];
    preparationDurationMinutes?: number;
    negotiationDurationMinutes?: number;
  },
) {
  const assignmentDraft = {
    facilitatorEventParticipantId: input.facilitatorEventParticipantId,
    roleAssignments: input.roleAssignments,
    observerEventParticipantIds: input.observerEventParticipantIds ?? [],
    roomLabel: input.roomLabel,
    preparationDurationMinutes: input.preparationDurationMinutes ?? 5,
    negotiationDurationMinutes: input.negotiationDurationMinutes ?? 15,
  };

  const patchResponse = await request.patch(`/api/events/${input.eventId}/host`, {
    data: {
      hostToken: input.hostToken,
      selectedCaseId: input.caseId,
      assignmentDraft,
    },
  });
  const patchResponseText = await patchResponse.text();
  if (!patchResponse.ok()) {
    throw new Error(
      [
        "Failed to configure Event before session creation",
        "HTTP method: PATCH",
        `Path: /api/events/${input.eventId}/host`,
        `HTTP status: ${patchResponse.status()}`,
        `Response body: ${(patchResponseText || "<empty>").slice(0, 3000)}`,
      ].join("\n"),
    );
  }
  expect(patchResponse.ok()).toBeTruthy();

  const createResponse = await request.post(`/api/events/${input.eventId}/host`, {
    data: { hostToken: input.hostToken },
  });
  const createResponseText = await createResponse.text();
  if (!createResponse.ok()) {
    throw new Error(
      [
        "Failed to create Event Session",
        "HTTP method: POST",
        `Path: /api/events/${input.eventId}/host`,
        `HTTP status: ${createResponse.status()}`,
        `Response body: ${(createResponseText || "<empty>").slice(0, 3000)}`,
      ].join("\n"),
    );
  }
  expect(createResponse.ok()).toBeTruthy();

  let body: { session: { id: string } };
  try {
    body = JSON.parse(createResponseText) as { session: { id: string } };
  } catch {
    throw new Error(
      `Create Event Session returned invalid JSON: ${(createResponseText || "<empty>").slice(0, 3000)}`,
    );
  }
  if (!body?.session?.id) {
    throw new Error(
      `Create Event Session returned invalid payload: ${(createResponseText || "<empty>").slice(0, 3000)}`,
    );
  }
  return body.session.id;
}

test("complete event from lobby closes event and disables session creation @browser-smoke", async ({
  page,
  request,
}) => {
  const { event } = await createEventSession(request);

  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby?hostToken=${encodeURIComponent(event.hostToken)}`);
  await dismissCookieBannerIfVisible(page);

  await expect(page.getByTestId("session-board-section")).toBeVisible();
  await expect(page.getByTestId("event-completion-danger-zone")).toBeVisible();
  await expect(page.getByTestId("assigned-session-card")).toBeVisible();
  const ownerSectionOrder = await page
    .locator(
      [
        '[data-testid="event-settings-section"]',
        '[data-testid="session-board-section"]',
        '[data-testid="assigned-session-card"]',
        '[data-testid="event-completion-danger-zone"]',
      ].join(", "),
    )
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid")));
  expect(ownerSectionOrder.at(-1)).toBe("event-completion-danger-zone");
  expect(ownerSectionOrder.indexOf("event-completion-danger-zone")).toBeGreaterThan(
    ownerSectionOrder.indexOf("assigned-session-card"),
  );
  await expect(page.getByTestId("complete-event-button")).toHaveText(
    /Complete entire event|Завершить всю встречу/i,
  );
  await expect(page.getByTestId("complete-event-button")).toBeVisible();
  await dismissCookieBannerIfVisible(page);
  await page.getByTestId("complete-event-button").click();
  await expect(page.getByRole("heading", { name: /Complete entire event\?|Завершить всю встречу\?/i })).toBeVisible();
  await page.getByTestId("confirm-complete-event-button").click();

  await expect(
    page.getByText(/completed by the organizer|завершена организатором/i),
  ).toBeVisible();

  const updatedEvent = await getTrainingEvent(event.id);
  expect(updatedEvent.status).toBe("COMPLETED");
  expect(updatedEvent.completedAt).not.toBeNull();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createResponse.status()).toBe(409);
});

test("completed owner overlay lists all sessions and removes duplicate materials action", async ({
  page,
  request,
}) => {
  const { event, participants, negotiationCase, sessionId } = await createEventSession(request);
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const host = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");

  const completeFirstSessionResponse = await request.post(`/api/sessions/${sessionId}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeFirstSessionResponse.ok()).toBeTruthy();

  await createSessionInEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: host.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: alex.id,
    },
  });

  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby?hostToken=${encodeURIComponent(event.hostToken)}`);
  await dismissCookieBannerIfVisible(page);

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-list")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(2);
  await expect(page.getByTestId("completed-event-session-materials-link")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /^materials$|^материалы$/i })).toHaveCount(0);
});

test("completed participant overlay lists authorized sessions only and preserves token links", async ({
  page,
  request,
}) => {
  const { event, participants, negotiationCase, sessionId } = await createEventSession(request);
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const host = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");

  const completeFirstSessionResponse = await request.post(`/api/sessions/${sessionId}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeFirstSessionResponse.ok()).toBeTruthy();

  const secondSessionId = await createSessionInEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: host.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: serg.id,
    },
  });

  const completeSecondSessionResponse = await request.post(`/api/sessions/${secondSessionId}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeSecondSessionResponse.ok()).toBeTruthy();

  await createSessionInEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room C",
    facilitatorEventParticipantId: host.id,
    roleAssignments: {
      [buyerRole.id]: alex.id,
      [sellerRole.id]: serg.id,
    },
  });

  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby?participantToken=${encodeURIComponent(igor.participantToken)}`);
  await dismissCookieBannerIfVisible(page);

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(2);
  await expect(page.getByText("Room C")).toHaveCount(0);
  const materialsLinks = page.getByTestId("completed-event-session-materials-link");
  await expect(materialsLinks).toHaveCount(2);
  const hrefs = await materialsLinks.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href).toContain("/join/");
    expect(href).not.toContain("/sessions/");
  }
});

test("completed participant overlay handles single authorized session list", async ({
  page,
  request,
}) => {
  const { event, participants } = await createEventSession(request);
  const igor = participantByName(participants, "Igor");

  const extraParticipantToken = `extra-participant-${Date.now()}`;
  await query(
    `INSERT INTO "EventParticipant"
      ("id","eventId","displayName","participantToken","preference","isHost","wantsToPlay","wantsToObserve","wantsToFacilitate","joinedAt","lastSeenAt","updatedAt")
     VALUES (gen_random_uuid(),$1,'Unassigned Participant',$2,'UNDECIDED',false,false,false,false,NOW(),NOW(),NOW())`,
    [event.id, extraParticipantToken],
  );

  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby?participantToken=${encodeURIComponent(igor.participantToken)}`);
  await dismissCookieBannerIfVisible(page);

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(1);
  await expect(page.getByTestId("completed-event-session-materials-link")).toHaveCount(1);
});

test("completed participant overlay shows empty state for no authorized sessions", async ({
  page,
  request,
}) => {
  const { event } = await createEventSession(request);
  const extraParticipantToken = `extra-participant-empty-${Date.now()}`;
  await query(
    `INSERT INTO "EventParticipant"
      ("id","eventId","displayName","participantToken","preference","isHost","wantsToPlay","wantsToObserve","wantsToFacilitate","joinedAt","lastSeenAt","updatedAt")
     VALUES (gen_random_uuid(),$1,'Unassigned Participant',$2,'UNDECIDED',false,false,false,false,NOW(),NOW(),NOW())`,
    [event.id, extraParticipantToken],
  );

  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby?participantToken=${encodeURIComponent(extraParticipantToken)}`);
  await dismissCookieBannerIfVisible(page);

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(0);
  await expect(page.getByTestId("completed-event-session-empty-state")).toHaveText(
    /do not have any accessible sessions|нет доступных сессий/i,
  );
});

test("completed owner lobby route is durable across direct entry, reload, and new tab", async ({
  page,
  request,
}) => {
  const ownerUser = await createActiveUser();
  const ownerCookie = await createUserSessionCookie(ownerUser.id);
  const { event, participants, negotiationCase, sessionId } = await createEventSession(request);
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const host = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, ownerUser.id],
  );
  await query(`UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`, [host.id, ownerUser.id]);

  const completeFirstSessionResponse = await request.post(`/api/sessions/${sessionId}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeFirstSessionResponse.ok()).toBeTruthy();

  await createSessionInEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: host.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: alex.id,
    },
  });

  await loginToPageWithSessionCookie(page, ownerCookie);
  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBannerIfVisible(page);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    headers: { Cookie: ownerCookie },
    data: {},
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-list")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(2);
  await expect(page.getByTestId("completed-event-session-materials-link")).toHaveCount(2);

  await page.reload();
  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(2);

  const newTab = await page.context().newPage();
  await seedCookieConsent(newTab);
  await newTab.goto(`/events/${event.id}/lobby`);
  await dismissCookieBannerIfVisible(newTab);
  await expect(newTab.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(newTab.getByTestId("completed-event-session-card")).toHaveCount(2);

  const liveKitAfterCompletion = await request.post(`/api/events/${event.id}/livekit-token`, {
    headers: { Cookie: ownerCookie },
    data: { connectionId: `owner-completed-${Date.now()}`, claimLease: true },
  });
  expect(liveKitAfterCompletion.status()).not.toBe(200);
  const voximplantAfterCompletion = await request.post(`/api/events/${event.id}/voximplant-access`, {
    headers: { Cookie: ownerCookie },
    data: { connectionId: `owner-completed-vox-${Date.now()}`, claimLease: true },
  });
  expect(voximplantAfterCompletion.status()).not.toBe(200);
});

test("completed account participant can directly reopen lobby without token and sees authorized sessions only", async ({
  page,
  request,
}) => {
  const participantUser = await createActiveUser();
  const participantCookie = await createUserSessionCookie(participantUser.id);
  const { event, participants, negotiationCase, sessionId } = await createEventSession(request);
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const host = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");

  await query(`UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`, [igor.id, participantUser.id]);

  const completeFirstSessionResponse = await request.post(`/api/sessions/${sessionId}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeFirstSessionResponse.ok()).toBeTruthy();

  const secondSessionId = await createSessionInEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: host.id,
    roleAssignments: {
      [buyerRole.id]: alex.id,
      [sellerRole.id]: serg.id,
    },
  });
  const completeSecondSessionResponse = await request.post(`/api/sessions/${secondSessionId}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeSecondSessionResponse.ok()).toBeTruthy();

  await loginToPageWithSessionCookie(page, participantCookie);
  await seedCookieConsent(page);
  await page.goto("/events");
  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBannerIfVisible(page);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(1);
  await expect(page.getByText("Room B")).toHaveCount(0);
  const materialsLinks = page.getByTestId("completed-event-session-materials-link");
  await expect(materialsLinks).toHaveCount(1);
  const hrefs = await materialsLinks.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href).toContain("/sessions/");
    expect(href).not.toContain("/join/");
  }

  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(1);
});

test("completed event denies unauthorized authenticated account access", async ({
  page,
  request,
}) => {
  const unrelatedUser = await createActiveUser();
  const unrelatedCookie = await createUserSessionCookie(unrelatedUser.id);
  const { event } = await createEventSession(request);

  const completeEventResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeEventResponse.ok()).toBeTruthy();

  await loginToPageWithSessionCookie(page, unrelatedCookie);
  await seedCookieConsent(page);
  await page.goto(`/events/${event.id}/lobby`);
  await dismissCookieBannerIfVisible(page);

  await expect(page.getByTestId("event-completed-overlay")).toHaveCount(0);
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(0);
  const stateResponse = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: unrelatedCookie },
  });
  expect([401, 403]).toContain(stateResponse.status());
});

test("complete event closes preparation session without recording", async ({
  request,
}) => {
  const { event, sessionId } = await createEventSession(request);

  const completeResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeResponse.ok()).toBeTruthy();

  const session = await getSessionNegotiationState(sessionId);
  expect(session.negotiationState).toBe("FINISHED");
  expect(session.roomLifecycle).toBe("CLOSED");
  expect(session.closeReason).toBe("EVENT_COMPLETED");
  expect(session.negotiationStartedAt).toBeNull();

  const recording = await getRecordingBySession(sessionId);
  expect(recording).toBeNull();
});

test("complete event closes running session and stops active recording [ST310-EVENT-004]", async ({
  request,
}) => {
  const { event, sessionId } = await createEventSession(request);
  await forceSessionRunningForE2e(sessionId);

  await upsertRecordingForSession({
    sessionId,
    status: "RECORDING",
    provider: "LIVEKIT_CLOUD",
    egressId: `mock-egress-${sessionId}`,
  });

  const recordingBefore = await getRecordingBySession(sessionId);
  expect(recordingBefore?.status).toBe("RECORDING");

  const completeResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeResponse.ok()).toBeTruthy();

  const session = await getSessionNegotiationState(sessionId);
  expect(session.negotiationState).toBe("FINISHED");
  expect(session.roomLifecycle).toBe("CLOSED");
  expect(session.closeReason).toBe("EVENT_COMPLETED");

  const recording = await getRecordingBySession(sessionId);
  expect(recording).not.toBeNull();
  expect(["PROCESSING", "STOPPED", "COMPLETED"]).toContain(recording?.status);
  const stopOperations = await getRecordingStopOperations(sessionId);
  expect(stopOperations.length).toBe(1);
  expect(["DELIVERED", "FAILED"]).toContain(stopOperations[0]!.state);

  const transcriptCount = await countTranscripts(sessionId);
  expect(transcriptCount).toBe(0);
});

test("recording stop failure still completes event", async ({ request }) => {
  const { event, sessionId } = await createEventSession(request);
  await forceSessionRunningForE2e(sessionId);
  await upsertRecordingForSession({
    sessionId,
    status: "RECORDING",
    provider: "LIVEKIT_CLOUD",
    egressId: `mock-egress-${sessionId}`,
  });

  await request.post("/api/test/mock-external-service", {
    data: { service: "LIVEKIT", error: "NETWORK_ERROR" },
  });

  const completeResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeResponse.ok()).toBeTruthy();

  const body = await completeResponse.json();
  expect(body.eventStatus).toBe("COMPLETED");

  const updatedEvent = await getTrainingEvent(event.id);
  expect(updatedEvent.status).toBe("COMPLETED");

  const externalEvent = await getExternalServiceEvent(sessionId, "LIVEKIT");
  expect(externalEvent).not.toBeNull();
  const stopOperations = await getRecordingStopOperations(sessionId);
  expect(stopOperations.length).toBe(1);
});

test("rejoin completed event with participant token preserves token-safe overlay access [ST310-NAV-005]", async ({
  page,
  request,
}) => {
  const { event, participants } = await createEventSession(request);
  const igor = participantByName(participants, "Igor");

  await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });

  await seedCookieConsent(page);
  await page.goto(
    `/events/${event.id}/lobby?participantToken=${encodeURIComponent(igor.participantToken)}`,
  );
  await dismissCookieBannerIfVisible(page);

  await expect(page.getByTestId("event-completed-overlay")).toBeVisible();
  await expect(page.getByTestId("completed-event-session-card")).toHaveCount(1);
  const materialsLinks = page.getByTestId("completed-event-session-materials-link");
  await expect(materialsLinks).toHaveCount(1);
  const hrefs = await materialsLinks.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href).toContain("/join/");
    expect(href).not.toContain("/sessions/");
  }
});
