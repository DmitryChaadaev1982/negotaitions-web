import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createDiarizedTranscript,
  createE2eCase,
  createRoomConnectionForParticipant,
  createTestEvent,
  createUserSessionCookie,
  e2eId,
  e2eName,
  getTranscriptSegments,
  query,
} from "./helpers/db";
import { seedCookieConsent } from "./helpers/cookie-consent";
import { postSessionControlAction } from "./helpers/session-control";

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

type StandaloneFixture = {
  sessionId: string;
  roleAId: string;
  roleBId: string;
  unassignedParticipantId: string;
  facilitator: { id: string; userId: string; joinToken: string };
};

async function authenticatePage(page: Page, userId: string) {
  const cookie = await createUserSessionCookie(userId);
  const url = test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookie.replace("auth_session=", ""),
      url,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "negotaitions_locale",
      value: "en",
      url,
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem("negotaitions_locale", "en");
  });
}

async function saveManualSpeakerTurns(page: Page) {
  const saveButton = page.getByTestId("save-manual-speaker-attribution-button");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/manual-speaker-attribution") &&
      response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await saveButton.click();
  const dialog = page.getByTestId("material-change-confirm-dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button").nth(1).click();
  }
  let response = await responsePromise.catch(() => null);
  if (await dialog.isVisible().catch(() => false)) {
    const confirmed = page.waitForResponse(
      (next) =>
        next.url().includes("/manual-speaker-attribution") &&
        next.request().method() === "POST",
      { timeout: 15_000 },
    );
    await dialog.getByRole("button").nth(1).click();
    response = await confirmed;
  }
  if (!response) {
    const clientError = await page.locator("p.text-amber-400").textContent();
    throw new Error(
      `manual-speaker-attribution was not requested. UI error: ${clientError ?? "(none)"}`,
    );
  }
  if (!response.ok()) {
    throw new Error(
      `manual-speaker-attribution failed: ${response.status()} ${await response.text()}`,
    );
  }
}

async function postStartPreparation(
  request: APIRequestContext,
  fixture: {
    sessionId: string;
    facilitator: { id: string; userId: string };
  },
) {
  const connectionId = await createRoomConnectionForParticipant({
    sessionId: fixture.sessionId,
    userId: fixture.facilitator.userId,
    role: "FACILITATOR",
  });
  const cookie = await createUserSessionCookie(fixture.facilitator.userId);
  return postSessionControlAction(request, {
    sessionId: fixture.sessionId,
    auth: { participantId: fixture.facilitator.id },
    connectionId,
    headers: { Cookie: cookie },
    action: "START_PREPARATION",
  });
}

async function insertSessionRoles(
  sessionId: string,
  negotiationCase: Awaited<ReturnType<typeof createE2eCase>>,
) {
  const [roleA, roleB] = negotiationCase.roles;
  if (!roleA || !roleB) {
    throw new Error("E2E case roles were not created.");
  }
  const roleAId = e2eId("session-role-a");
  const roleBId = e2eId("session-role-b");
  await query(
    `INSERT INTO "SessionRole"
       ("id", "sessionId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "createdAt", "updatedAt")
     VALUES
       ($1, $3, $4, $6, $8, $10, $12, $14, 0, NOW(), NOW()),
       ($2, $3, $5, $7, $9, $11, $13, $15, 1, NOW(), NOW())`,
    [
      roleAId,
      roleBId,
      sessionId,
      roleA.name,
      roleB.name,
      roleA.privateInstructions,
      roleB.privateInstructions,
      roleA.objectives,
      roleB.objectives,
      roleA.constraints,
      roleB.constraints,
      roleA.hiddenInfo,
      roleB.hiddenInfo,
      roleA.fallbackPosition,
      roleB.fallbackPosition,
    ],
  );
  return { roleAId, roleBId };
}

async function createIncompleteStandaloneSession(): Promise<StandaloneFixture> {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const assignedUser = await createActiveUser({ preferredLocale: "en" });
  const unassignedUser = await createActiveUser({ preferredLocale: "en" });
  const sessionId = e2eId("s319a-standalone");
  const facilitatorParticipantId = e2eId("s319a-facilitator");
  const assignedParticipantId = e2eId("s319a-assigned");
  const unassignedParticipantId = e2eId("s319a-unassigned");

  await query(
    `INSERT INTO "Session"
       ("id", "title", "negotiationCaseId", "facilitatorId", "eventId", "visibility",
        "status", "snapshotCaseTitle", "snapshotBusinessContext",
        "snapshotPublicInstructions", "snapshotCaseLanguage", "negotiationState",
        "durationSeconds", "preparationDurationSeconds", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NULL, 'PRIVATE', 'DRAFT', $5, 'Context',
        'Instructions', 'EN', 'PREPARATION', 900, 300, NOW(), NOW())`,
    [
      sessionId,
      e2eName("Stage 3.19A standalone preparation"),
      negotiationCase.id,
      facilitatorUser.id,
      negotiationCase.title,
    ],
  );
  const { roleAId, roleBId } = await insertSessionRoles(sessionId, negotiationCase);
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "displayName", "type", "joinToken", "sessionRoleId", "createdAt", "updatedAt")
     VALUES
       ($1, $4, $5, 'Facilitator', 'FACILITATOR', $8, NULL, NOW(), NOW()),
       ($2, $4, $6, 'Assigned player', 'PARTICIPANT', $9, $11, NOW(), NOW()),
       ($3, $4, $7, 'Unassigned player', 'PARTICIPANT', $10, NULL, NOW(), NOW())`,
    [
      facilitatorParticipantId,
      assignedParticipantId,
      unassignedParticipantId,
      sessionId,
      facilitatorUser.id,
      assignedUser.id,
      unassignedUser.id,
      e2eId("s319a-fac-token"),
      e2eId("s319a-assigned-token"),
      e2eId("s319a-unassigned-token"),
      roleAId,
    ],
  );

  return {
    sessionId,
    roleAId,
    roleBId,
    unassignedParticipantId,
    facilitator: {
      id: facilitatorParticipantId,
      userId: facilitatorUser.id,
      joinToken: e2eId("unused"),
    },
  };
}

async function createCompleteStandaloneSession() {
  const fixture = await createIncompleteStandaloneSession();
  await query(
    `UPDATE "SessionParticipant" SET "sessionRoleId" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
    [fixture.unassignedParticipantId, fixture.roleBId],
  );
  return fixture;
}

async function createEventLinkedIncompleteSession() {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const sessionId = e2eId("s319a-event-session");
  const eventId = e2eId("s319a-event");
  const facilitatorParticipantId = e2eId("s319a-event-facilitator");

  await query(
    `INSERT INTO "TrainingEvent"
       ("id", "title", "status", "hostUserId", "facilitatorUserId", "visibility",
        "publicJoinCode", "hostToken", "estimatedEventDurationSeconds", "createdAt", "updatedAt")
     VALUES ($1, $2, 'SESSION_CREATED', $3, $3, 'PRIVATE', $4, $5, 3600, NOW(), NOW())`,
    [
      eventId,
      e2eName("Stage 3.19A Event control"),
      facilitatorUser.id,
      e2eId("s319a-join-code"),
      e2eId("s319a-host-token"),
    ],
  );
  await query(
    `INSERT INTO "Session"
       ("id", "title", "negotiationCaseId", "facilitatorId", "eventId", "visibility",
        "status", "snapshotCaseTitle", "snapshotBusinessContext",
        "snapshotPublicInstructions", "snapshotCaseLanguage", "negotiationState",
        "durationSeconds", "preparationDurationSeconds", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'PRIVATE', 'DRAFT', $6, 'Context',
        'Instructions', 'EN', 'PREPARATION', 900, 300, NOW(), NOW())`,
    [
      sessionId,
      e2eName("Stage 3.19A Event session"),
      negotiationCase.id,
      facilitatorUser.id,
      eventId,
      negotiationCase.title,
    ],
  );
  await insertSessionRoles(sessionId, negotiationCase);
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "displayName", "type", "joinToken", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Event facilitator', 'FACILITATOR', $4, NOW(), NOW())`,
    [
      facilitatorParticipantId,
      sessionId,
      facilitatorUser.id,
      e2eId("s319a-event-fac-token"),
    ],
  );

  return {
    sessionId,
    facilitator: {
      id: facilitatorParticipantId,
      userId: facilitatorUser.id,
    },
  };
}

async function createMaterialsSession() {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const buyerUser = await createActiveUser({ preferredLocale: "en" });
  const sellerUser = await createActiveUser({ preferredLocale: "en" });
  const sessionId = e2eId("s319a-materials");
  const facilitatorParticipantId = e2eId("s319a-materials-fac");
  const buyerParticipantId = e2eId("s319a-materials-buyer");
  const sellerParticipantId = e2eId("s319a-materials-seller");

  await query(
    `INSERT INTO "Session"
       ("id", "title", "negotiationCaseId", "facilitatorId", "eventId", "visibility",
        "status", "snapshotCaseTitle", "snapshotBusinessContext",
        "snapshotPublicInstructions", "snapshotCaseLanguage", "negotiationState",
        "durationSeconds", "preparationDurationSeconds", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NULL, 'PRIVATE', 'DRAFT', $5, 'Context',
        'Instructions', 'EN', 'PREPARATION', 900, 300, NOW(), NOW())`,
    [
      sessionId,
      e2eName("Stage 3.19A transcript insert"),
      negotiationCase.id,
      facilitatorUser.id,
      negotiationCase.title,
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "displayName", "type", "joinToken", "createdAt", "updatedAt")
     VALUES
       ($1, $4, $5, 'Facilitator', 'FACILITATOR', $8, NOW(), NOW()),
       ($2, $4, $6, 'Buyer', 'PARTICIPANT', $9, NOW(), NOW()),
       ($3, $4, $7, 'Seller', 'PARTICIPANT', $10, NOW(), NOW())`,
    [
      facilitatorParticipantId,
      buyerParticipantId,
      sellerParticipantId,
      sessionId,
      facilitatorUser.id,
      buyerUser.id,
      sellerUser.id,
      e2eId("s319a-materials-token"),
      e2eId("s319a-buyer-token"),
      e2eId("s319a-seller-token"),
    ],
  );
  await createDiarizedTranscript(sessionId, [
    { speakerLabel: "spk_0", startSeconds: 0, endSeconds: 2, text: "first turn" },
    { speakerLabel: "spk_1", startSeconds: 3, endSeconds: 5, text: "last turn" },
  ]);

  return {
    sessionId,
    facilitatorUserId: facilitatorUser.id,
    buyerParticipantId,
    sellerParticipantId,
  };
}

test("E2E-A incomplete standalone START_PREPARATION is rejected by the control API", async ({
  request,
}) => {
  const fixture = await createIncompleteStandaloneSession();
  const response = await postStartPreparation(request, fixture);
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: "standaloneRolesNotReady",
    code: "STANDALONE_ROLES_NOT_READY",
  });
});

test("E2E-A complete standalone START_PREPARATION is allowed", async ({ request }) => {
  const fixture = await createCompleteStandaloneSession();
  const response = await postStartPreparation(request, fixture);
  expect(response.ok()).toBeTruthy();
});

test("E2E-A Event-created START_PREPARATION is not restricted by the standalone guard", async ({
  request,
}) => {
  const fixture = await createEventLinkedIncompleteSession();
  const response = await postStartPreparation(request, fixture);
  expect(response.ok()).toBeTruthy();
});

test("E2E-A Start Preparation stays visible, disables until roles are ready, then starts", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await createIncompleteStandaloneSession();
  await seedCookieConsent(page);
  await authenticatePage(page, fixture.facilitator.userId);
  await page.goto(`/room/${fixture.sessionId}?media=off`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("session-room-header")).toBeVisible({
    timeout: 30_000,
  });

  const startButton = page.getByTestId("start-preparation-button");
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeDisabled();
  await expect(page.getByTestId("start-preparation-roles-hint")).toBeVisible();

  const rolePanel = page
    .getByTestId("room-desktop-sidebar")
    .getByTestId("session-role-management-panel");
  await expect(rolePanel).toBeVisible();
  await rolePanel
    .getByTestId(`role-select-${fixture.unassignedParticipantId}`)
    .selectOption(fixture.roleBId);
  await rolePanel.getByTestId("apply-roles-button").click();

  await expect(startButton).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByTestId("start-preparation-roles-hint")).toHaveCount(0);
  await startButton.click();
  await expect(page.getByTestId("stop-preparation-button")).toBeVisible({
    timeout: 15_000,
  });
});

test("E2E-B Insert after persists between turns and Insert after last appends", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await createMaterialsSession();
  await seedCookieConsent(page);
  await authenticatePage(page, fixture.facilitatorUserId);
  await page.goto(`/sessions/${fixture.sessionId}/materials`);
  await expect(page.getByTestId("session-post-processing-panel")).toBeVisible({
    timeout: 20_000,
  });

  const toggle = page.getByTestId("toggle-transcript-section");
  if ((await toggle.getAttribute("data-state")) === "collapsed") {
    await toggle.click();
  }
  await page.getByTestId("edit-diarized-transcript-button").click();
  const turnFields = page.getByTestId("manual-speaker-turn-text");
  const participantSelects = page.getByTestId("manual-speaker-turn-participant");
  await expect(turnFields).toHaveCount(2);
  await expect(participantSelects.nth(0).locator("option")).toHaveCount(4);
  await participantSelects.nth(0).selectOption(fixture.buyerParticipantId);
  await participantSelects.nth(1).selectOption(fixture.sellerParticipantId);

  await page.getByTestId("insert-manual-speaker-turn-after").first().click();
  await expect(turnFields).toHaveCount(3);
  await turnFields.nth(1).fill("inserted between");
  await participantSelects.nth(1).selectOption(fixture.buyerParticipantId);

  await page.getByTestId("insert-manual-speaker-turn-after").last().click();
  await expect(turnFields).toHaveCount(4);
  await turnFields.last().fill("appended last");
  await participantSelects.last().selectOption(fixture.sellerParticipantId);
  await saveManualSpeakerTurns(page);

  await page.reload();
  await expect(page.getByTestId("session-post-processing-panel")).toBeVisible({
    timeout: 20_000,
  });
  const saved = await getTranscriptSegments(fixture.sessionId);
  expect(saved.map((segment) => segment.text)).toEqual([
    "first turn",
    "inserted between",
    "last turn",
    "appended last",
  ]);
  expect(saved.map((segment) => segment.orderIndex)).toEqual([0, 1, 2, 3]);
});

test("E2E-C Events list complete uses the app dialog, cancel keeps the event, confirm completes it", async ({
  page,
}) => {
  const hostUser = await createActiveUser({
    preferredLocale: "en",
    email: `e2e-s319a-complete-${Date.now()}@test.negotaitions.local`,
  });
  const event = await createTestEvent({
    withParticipants: false,
    title: "Stage 3.19A Events List Complete",
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

  await page.addInitScript(() => {
    const state = { confirm: 0, prompt: 0 };
    (window as Window & { __nativeDialogCalls?: typeof state }).__nativeDialogCalls =
      state;
    const originalConfirm = window.confirm.bind(window);
    const originalPrompt = window.prompt.bind(window);
    window.confirm = (...args) => {
      state.confirm += 1;
      return originalConfirm(...args);
    };
    window.prompt = (...args) => {
      state.prompt += 1;
      return originalPrompt(...args);
    };
  });

  await seedCookieConsent(page);
  await authenticatePage(page, hostUser.id);
  await page.goto("/events");

  const row = page.getByTestId("event-row").filter({ hasText: event.title }).first();
  const completeAction = row
    .getByTestId("event-complete-list-action")
    .getByTestId("complete-event-button");
  await completeAction.click();

  const dialog = page.getByTestId("event-complete-list-confirm-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (
      await query<{ status: string }>(
        `SELECT "status" FROM "TrainingEvent" WHERE "id" = $1`,
        [event.id],
      )
    )[0]?.status,
  ).toBe("LOBBY_OPEN");

  await completeAction.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Complete event", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(completeAction).toHaveCount(0);
  expect(
    (
      await query<{ status: string }>(
        `SELECT "status" FROM "TrainingEvent" WHERE "id" = $1`,
        [event.id],
      )
    )[0]?.status,
  ).toBe("COMPLETED");

  const nativeCalls = await page.evaluate(
    () =>
      (window as Window & { __nativeDialogCalls?: { confirm: number; prompt: number } })
        .__nativeDialogCalls,
  );
  expect(nativeCalls).toEqual({ confirm: 0, prompt: 0 });
});
