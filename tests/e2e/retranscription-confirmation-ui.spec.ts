import { expect, type APIRequestContext, type Locator, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  createCompletedTranscript,
  createE2eCase,
  createE2eEvent,
  createUserSessionCookie,
  getEventParticipants,
  query,
  getSession,
  participantByName,
  updateRecordingCompleted,
  upsertRecordingForSession,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

async function createAssignedSession(request: APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  if (!buyerRole || !sellerRole) throw new Error("E2E case roles were not created.");
  if (!dmitry.userId) {
    throw new Error("Assigned E2E session requires Dmitry to be account-bound as event host.");
  }

  const hostAuthCookie = await createUserSessionCookie(dmitry.userId);
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
    headers: { Cookie: hostAuthCookie },
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
    },
  });
  if (!patchResponse.ok()) {
    throw new Error(
      `Failed to configure assigned E2E session (${patchResponse.status()}): ${await patchResponse.text()}`,
    );
  }

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    headers: { Cookie: hostAuthCookie },
    data: { hostToken: event.hostToken },
  });
  if (!createResponse.ok()) {
    throw new Error(
      `Failed to create assigned E2E session (${createResponse.status()}): ${await createResponse.text()}`,
    );
  }
  const body = (await createResponse.json()) as { session: { id: string } };
  const session = await getSession(body.session.id);
  await upsertRecordingForSession({
    sessionId: session.id,
    status: "NOT_STARTED",
    provider: "LIVEKIT_CLOUD",
  });

  return {
    session,
    facilitator: participantByName(session.participants, "Dmitry"),
  };
}

async function control(
  request: APIRequestContext,
  sessionId: string,
  participant: { id: string; userId: string | null },
  action: string,
) {
  if (action === "SKIP_PREPARATION") {
    await control(request, sessionId, participant, "START_PREPARATION");
    return control(request, sessionId, participant, "STOP_PREPARATION");
  }
  if (!participant.userId) {
    throw new Error(`Session control ${action} requires an account-bound participant.`);
  }
  const authCookie = await createUserSessionCookie(participant.userId);
  const connectionId = `rerun-ui-${participant.id}`;
  const controlState = await request.get(
    `/api/sessions/${sessionId}/control-state?participantId=${participant.id}&connectionId=${connectionId}&claimLease=1`,
    {
      headers: { Cookie: authCookie },
    },
  );
  if (!controlState.ok()) {
    throw new Error(
      `Session control-state for ${action} failed (${controlState.status()}): ${await controlState.text()}`,
    );
  }
  const expected = (await controlState.json()) as {
    negotiationState: string;
    controlToken: string;
  };
  const response = await request.post(`/api/sessions/${sessionId}/control`, {
    headers: { Cookie: authCookie },
    data: {
      participantId: participant.id,
      connectionId,
      action,
      expectedNegotiationState: expected.negotiationState,
      expectedControlToken: expected.controlToken,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `Session control ${action} failed (${response.status()}): ${await response.text()}`,
    );
  }
  return response.json();
}

async function authenticatePageAs(page: Page, participant: { userId: string | null }) {
  if (!participant.userId) {
    throw new Error("Browser join flow requires an account-bound participant.");
  }
  const authCookie = await createUserSessionCookie(participant.userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: authCookie.replace("auth_session=", ""),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function interceptRetranscribe(page: Page) {
  const posts: string[] = [];
  await page.route("**/materials/retranscribe", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts.push(route.request().url());
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: "QUEUED" }),
    });
  });
  return posts;
}

function rerunButton(root: Locator | Page) {
  return root.getByTestId("post-processing-rerun-transcription-button");
}

function confirmDialog(page: Page) {
  return page.getByTestId("retranscribe-confirm-dialog");
}

type HeaderBox = { x: number; y: number; width: number; height: number };

function boxesOverlap(a: HeaderBox, b: HeaderBox) {
  return (
    a.x < b.x + b.width - 1 &&
    a.x + a.width > b.x + 1 &&
    a.y < b.y + b.height - 1 &&
    a.y + a.height > b.y + 1
  );
}

async function expectLabelFullyVisible(locator: Locator) {
  await expect(locator).toBeVisible();
  const overflow = await locator.evaluate((el) => ({
    text: (el.textContent ?? "").trim(),
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(overflow.text.length).toBeGreaterThan(0);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function seedHeaderRecoveryHint(page: Page, sessionId: string) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [
      "negotaitions.recovery.v1",
      JSON.stringify({
        type: "SESSION_ROOM",
        sessionId,
        updatedAt: new Date().toISOString(),
      }),
    ],
  );
}

async function expectAuthenticatedHeaderLayout(page: Page) {
  const siteLink = page.getByTestId("nav-public-site");
  const dashboard = page.getByTestId("nav-dashboard");
  const admin = page.getByTestId("nav-admin");
  const utilities = page.getByTestId("app-header-utilities");
  const rejoin = page.getByTestId("rejoin-link");
  const localeRu = page.getByTestId("language-switch-ru");
  const localeEn = page.getByTestId("language-switch-en");
  const profile = page.getByTestId("account-menu-trigger");
  const brand = page.locator("header").getByRole("link", { name: /NegotAItions|ПереговорИИ/ }).first();

  await expect(siteLink).toBeVisible();
  await expect(dashboard).toBeVisible();
  await expect(admin).toBeVisible();
  await expect(utilities).toBeVisible();
  await expect(rejoin).toBeVisible();
  await expect(localeRu).toBeVisible();
  await expect(localeEn).toBeVisible();
  await expect(profile).toBeVisible();

  await expectLabelFullyVisible(siteLink);
  await expectLabelFullyVisible(dashboard);
  await expectLabelFullyVisible(page.getByTestId("nav-cases"));
  await expectLabelFullyVisible(page.getByTestId("nav-events"));
  await expectLabelFullyVisible(page.getByTestId("nav-sessions"));
  await expectLabelFullyVisible(admin);
  await expectLabelFullyVisible(rejoin);
  await expect(localeRu).toHaveText(/ru/i);
  await expect(localeEn).toHaveText(/en/i);
  await expect(profile).toBeVisible();

  const brandBox = await brand.boundingBox();
  const siteBox = await siteLink.boundingBox();
  const dashBox = await dashboard.boundingBox();
  const adminBox = await admin.boundingBox();
  const rejoinBox = await rejoin.boundingBox();
  const utilBox = await utilities.boundingBox();
  expect(brandBox).toBeTruthy();
  expect(siteBox).toBeTruthy();
  expect(dashBox).toBeTruthy();
  expect(adminBox).toBeTruthy();
  expect(rejoinBox).toBeTruthy();
  expect(utilBox).toBeTruthy();

  expect(boxesOverlap(brandBox!, siteBox!)).toBeFalsy();
  expect(siteBox!.x).toBeGreaterThanOrEqual(brandBox!.x + brandBox!.width - 1);
  expect(boxesOverlap(siteBox!, dashBox!)).toBeFalsy();
  expect(boxesOverlap(adminBox!, rejoinBox!)).toBeFalsy();
  expect(boxesOverlap(adminBox!, utilBox!)).toBeFalsy();
  expect(utilBox!.x).toBeGreaterThanOrEqual(adminBox!.x + adminBox!.width - 1);

  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  const profileBox = await profile.boundingBox();
  expect(profileBox).toBeTruthy();
  expect(profileBox!.width).toBeGreaterThan(8);
  expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(viewport!.width + 2);
  const rightSlack = viewport!.width - (utilBox!.x + utilBox!.width);
  expect(rightSlack).toBeGreaterThanOrEqual(-2);
  if (viewport!.width >= 1440) {
    expect(rightSlack).toBeGreaterThan(48);
  }
}

async function expectHeaderLayoutAtDesktopWidths(page: Page) {
  for (const width of [1366, 1440, 1920] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expectAuthenticatedHeaderLayout(page);
  }
}

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test("RERUN-UI-01..04 mounted retranscription ConfirmDialog and header brand spacing", async ({
  request,
  page,
}) => {
  const { session, facilitator } = await createAssignedSession(request);
  if (!facilitator.userId) {
    throw new Error("Header layout checks require an account-bound facilitator.");
  }
  await query(`UPDATE "User" SET "globalRole" = 'ADMIN', "updatedAt" = NOW() WHERE "id" = $1`, [
    facilitator.userId,
  ]);
  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");
  await updateRecordingCompleted(session.id);
  await createCompletedTranscript(session.id);

  const retranscribePosts = await interceptRetranscribe(page);
  await authenticatePageAs(page, facilitator);
  await seedHeaderRecoveryHint(page, session.id);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/join/${facilitator.joinToken}`);
  await expect(page.getByTestId("session-post-processing-panel")).toBeVisible({
    timeout: 15_000,
  });
  await expect(rerunButton(page)).toBeVisible();

  await page.getByTestId("language-switch-ru").click();
  await expect(page.getByTestId("nav-public-site")).toHaveText("Сайт");
  await expect(page.getByTestId("nav-admin")).toHaveText("Администрирование");
  await expect(page.getByTestId("rejoin-link")).toHaveText("Вернуться");
  await expectHeaderLayoutAtDesktopWidths(page);

  await page.getByTestId("language-switch-en").click();
  await expect(page.getByTestId("nav-public-site")).toHaveText("Website");
  await expect(page.getByTestId("nav-admin")).toHaveText("Administration");
  await expect(page.getByTestId("rejoin-link")).toHaveText("Rejoin");
  await expectHeaderLayoutAtDesktopWidths(page);

  const toggle = page.getByTestId("toggle-transcript-section");
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const transcript = page.getByTestId("transcript-textarea");
  await expect(transcript).toBeVisible();
  await transcript.fill("Mock transcript for AI analysis test. Edited once.");
  await page.getByTestId("save-transcript-button").click();
  await expect(page.getByText(/Transcript saved|Транскрипт сохранён/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(rerunButton(page)).toBeVisible();

  await rerunButton(page).click();
  const dialog = confirmDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "alertdialog");
  await expect(page.locator(".bg-amber-950\\/20").filter({ hasText: /new transcript version|новая версия транскрипта/i })).toHaveCount(0);
  expect(retranscribePosts).toEqual([]);

  await dialog.getByRole("button", { name: /Cancel|Отмена/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(retranscribePosts).toEqual([]);

  await rerunButton(page).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Re-run transcription|Повторить транскрибацию/ }).click();
  await expect.poll(() => retranscribePosts.length).toBe(1);
  expect(retranscribePosts).toHaveLength(1);

  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto(`/room/${session.id}?media=off`);
  const roomPanel = page
    .getByTestId("room-desktop-sidebar")
    .getByTestId("debrief-panel");
  await expect(roomPanel).toBeVisible({ timeout: 20_000 });
  await expect(rerunButton(roomPanel)).toBeVisible();
  await rerunButton(roomPanel).click();
  await expect(confirmDialog(page)).toBeVisible();
  await expect(roomPanel.locator(".bg-amber-950\\/20").filter({ hasText: /new transcript version|новая версия транскрипта/i })).toHaveCount(0);
  expect(retranscribePosts).toHaveLength(1);
});
