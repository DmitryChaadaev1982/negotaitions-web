import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createTestCase,
  createTestEvent,
  createUserSessionCookie,
  forceSessionRunningForE2e,
  getEventParticipants,
  query,
} from "./helpers/db";

type DashboardFixture = {
  userId: string;
  caseId: string;
  eventId: string;
  eventTitle: string;
  sessionId: string;
  sessionTitle: string;
  otherOwnerName: string;
};

async function authenticate(page: Page, userId: string) {
  const cookie = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookie.slice("auth_session=".length),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function setVoxProviderFault(
  page: Page,
  mode: "off" | "healthy-media" | "media-acquisition",
) {
  const response = await page.request.post("/api/test/vox-provider-fault", {
    data: { mode },
  });
  expect(response.ok()).toBeTruthy();
}

async function createSessionFromEvent(
  request: APIRequestContext,
  input: {
    eventId: string;
    hostToken: string;
    caseId: string;
    facilitatorEventParticipantId: string;
    roleAssignments: Array<{ caseRoleId: string; eventParticipantId: string }>;
  },
) {
  const response = await request.post(`/api/events/${input.eventId}/host`, {
    data: {
      hostToken: input.hostToken,
      caseId: input.caseId,
      roomLabel: "Stage 3.13E active nested session",
      preparationDurationSeconds: 60,
      negotiationDurationSeconds: 120,
      facilitatorEventParticipantId: input.facilitatorEventParticipantId,
      roleAssignments: input.roleAssignments,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { session: { id: string; title: string } };
}

async function createDashboardFixture(
  request: APIRequestContext,
  locale: "ru" | "en",
): Promise<DashboardFixture> {
  const user = await createActiveUser({ preferredLocale: locale });
  const otherOwner = await createActiveUser({ preferredLocale: locale });
  const negotiationCase = await createTestCase({
    title: `Stage 3.13E Case ${locale}`,
  });
  const event = await createTestEvent({
    withParticipants: true,
    title: `Stage 3.13E future Event ${locale}`,
  });
  const participants = await getEventParticipants(event.id);
  const facilitator = participants.find((participant) => participant.displayName === "Dmitry");
  const firstParticipant = participants.find((participant) => participant.displayName === "Igor");
  const secondParticipant = participants.find((participant) => participant.displayName === "Alex");
  expect(facilitator && firstParticipant && secondParticipant).toBeTruthy();

  await query(
    `UPDATE "TrainingEvent"
       SET "hostUserId" = $2,
           "facilitatorUserId" = $2,
           "visibility" = 'PUBLIC',
           "scheduledAt" = NOW() + INTERVAL '7 days',
           "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, user.id],
  );

  const created = await createSessionFromEvent(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    facilitatorEventParticipantId: facilitator!.id,
    roleAssignments: [
      { caseRoleId: negotiationCase.roles[0]!.id, eventParticipantId: firstParticipant!.id },
      { caseRoleId: negotiationCase.roles[1]!.id, eventParticipantId: secondParticipant!.id },
    ],
  });
  await forceSessionRunningForE2e(created.session.id);

  await query(
    `UPDATE "NegotiationCase"
        SET "createdByUserId" = $2,
            "updatedAt" = NOW()
      WHERE "id" = $1`,
    [negotiationCase.id, user.id],
  );

  await query(
    `INSERT INTO "TrainingEvent"
       ("id", "title", "description", "status", "publicJoinCode", "hostToken",
        "hostUserId", "facilitatorUserId", "lobbyRoomName", "visibility", "scheduledAt", "updatedAt")
     VALUES ($1, $2, 'Owner presentation fixture', 'LOBBY_OPEN', $3, $4,
        $5, $5, $6, 'PUBLIC', NOW() + INTERVAL '3 days', NOW())`,
    [
      `stage313e_other_event_${Date.now()}`,
      `Stage 3.13E other owner Event ${locale}`,
      `stage313e_other_join_${Date.now()}`,
      `stage313e_other_host_${Date.now()}`,
      otherOwner.id,
      `stage313e-other-lobby-${Date.now()}`,
    ],
  );

  return {
    userId: user.id,
    caseId: negotiationCase.id,
    eventId: event.id,
    eventTitle: event.title,
    sessionId: created.session.id,
    sessionTitle: created.session.title,
    otherOwnerName: "E2E Locale User",
  };
}

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test("S313E-DASH-008: Cases header renders a canonical large Case pictogram", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/cases");
  const pictogram = page.getByTestId("page-header-pictogram").filter({
    has: page.locator('[data-object-type="case"]'),
  });
  await expect(pictogram).toBeVisible();
  await expect(pictogram.locator("img")).toHaveCount(2);
});

test("S313E-DASH-009: Events header renders a canonical large Event pictogram", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/events");
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="event"]'),
    }),
  ).toBeVisible();
});

test("S313E-DASH-010: Sessions header renders a canonical large Room pictogram", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/sessions");
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="room"]'),
    }),
  ).toBeVisible();
});

test("S313E-DASH-011: the current card uses the dashboard object-card structure", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-current-card")).toHaveAttribute(
    "data-card-system",
    "dashboard-object",
  );
});

test("S313E-DASH-012: the current card has its explicit accent treatment", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-current-card")).toHaveAttribute(
    "data-current-accent",
    "true",
  );
});

test("S313E-DASH-013: Open lobby is a primary dashboard action", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(
    page.locator(
      `[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"] [data-testid="dashboard-event-lobby-action"]`,
    ),
  ).toHaveAttribute("data-action-kind", "PRIMARY_PROGRESS");
});

test("S313E-DASH-015: English active section label is exact", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(
    page.getByTestId("dashboard-active-section").getByRole("heading", { name: "Active" }),
  ).toBeVisible();
});

test("S313E-DASH-021–023: an active nested Session promotes its future Event only into Active", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");

  const activeLane = page.getByTestId("dashboard-active-section");
  const eventCard = page.locator(
    `[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"]`,
  );
  await expect(activeLane.locator(`[data-event-id="${fixture.eventId}"]`)).toHaveCount(1);
  await expect(
    eventCard.locator(`[data-testid="dashboard-session-card"][data-session-id="${fixture.sessionId}"]`),
  ).toHaveCount(1);
  await expect(eventCard).toHaveCount(1);
});

test("S313E-DASH-016–017: lifecycle lanes do not render a managed grouping or duplicate objects", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");

  await expect(page.getByText("Managed Events", { exact: true })).toHaveCount(0);
  await expect(
    page.locator(`[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"]`),
  ).toHaveCount(1);
});

test("S313E-DASH-017: a managed object appears in only one dashboard lifecycle section", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(
    page.locator(`[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"]`),
  ).toHaveCount(1);
});

test("S313E-DASH-018: cards display owner identity", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-owner-self")).toBeVisible();
  await expect(page.getByTestId("dashboard-owner-neutral").first()).toContainText(fixture.otherOwnerName);
});

test("S313E-DASH-019: a self-owned card uses localized self-owner text and accent", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");

  await expect(page.getByTestId("dashboard-owner-self")).toHaveText("Owner: You");
  await expect(page.getByTestId("dashboard-owner-self")).toHaveAttribute(
    "data-owner-accent",
    "self",
  );
  await expect(page.getByTestId("dashboard-owner-neutral").first()).toContainText(fixture.otherOwnerName);
});

test("S313E-DASH-024: parent Event action opens its Event lobby as a primary action", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");

  const eventCard = page.locator(
    `[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"]`,
  );
  const lobbyAction = eventCard.getByTestId("dashboard-event-lobby-action");
  await expect(lobbyAction).toHaveText("Open lobby");
  await expect(lobbyAction).toHaveAttribute("href", `/events/${fixture.eventId}/lobby`);
  await expect(lobbyAction).toHaveAttribute("data-action-kind", "PRIMARY_PROGRESS");
});

test("S313E-DASH-025: nested Session exposes its own room action", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(
    page.locator(
      `[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"] [data-testid="dashboard-session-card"][data-session-id="${fixture.sessionId}"] [href="/room/${fixture.sessionId}"]`,
    ),
  ).toHaveCount(1);
});

test("S313E-DASH-026: Event card does not duplicate its nested Session room action", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");
  await expect(
    page.locator(
      `[data-testid="dashboard-event-card"][data-event-id="${fixture.eventId}"] [href="/room/${fixture.sessionId}"]`,
    ),
  ).toHaveCount(1);
});

test("S313E-DASH-014–019: Russian active heading and self-owner presentation", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "ru");
  await page.addInitScript(() => {
    localStorage.setItem("negotaitions_locale", "ru");
  });
  await authenticate(page, fixture.userId);
  await page.goto("/dashboard");

  const activeSection = page.getByTestId("dashboard-active-section");
  await expect(activeSection.getByRole("heading", { name: "Активные" })).toBeVisible();
  await expect(page.getByText("Предстоящие и активные", { exact: true })).toHaveCount(0);
  await expect(
    activeSection.getByTestId("dashboard-owner-self"),
  ).toContainText("Владелец: Вы");
  await expect(activeSection.getByTestId("dashboard-owner-self")).toHaveAttribute(
    "data-owner-accent",
    "self",
  );
});

function precautionaryLobbyDeviceHint(page: Page) {
  return page.getByText(
    /камера или микрофон могут быть недоступны|your camera or microphone may be unavailable/i,
  );
}

test("S313E-LOBBY-001: bootstrap/provider state alone does not render a device warning", async ({
  page,
  request,
}) => {
  const event = await createTestEvent({ withParticipants: true, title: "Stage 3.13E healthy lobby" });
  const participants = await getEventParticipants(event.id);
  const owner = participants.find((participant) => participant.displayName === "Dmitry");
  expect(owner?.userId).toBeTruthy();
  await authenticate(page, owner!.userId!);

  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  await expect(page.getByTestId("event-lobby-device-warning")).toHaveCount(0);
  await expect(precautionaryLobbyDeviceHint(page)).toHaveCount(0);
});

test("S313E-LOBBY-003: healthy runtime-equivalent media reconciles away a stale device warning", async ({
  page,
  request,
}) => {
  // Playwright cannot attach live Voximplant hardware. This path still calls
  // navigator.mediaDevices.getUserMedia, then injects the same stale
  // recoverable-device warning the real StreamManager path can leave behind.
  // Production join completion must reconcile from actual local streams.
  const event = await createTestEvent({ withParticipants: true, title: "Stage 3.13E healthy lobby" });
  const participants = await getEventParticipants(event.id);
  const owner = participants.find((participant) => participant.displayName === "Dmitry");
  expect(owner?.userId).toBeTruthy();
  await authenticate(page, owner!.userId!);
  await setVoxProviderFault(page, "healthy-media");

  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  const mediaHealth = page.getByTestId("event-lobby-media-health");
  await expect(mediaHealth).toHaveAttribute("data-microphone", "healthy");
  await expect(mediaHealth).toHaveAttribute("data-camera", "healthy");
  await expect(page.getByTestId("event-lobby-device-warning")).toHaveCount(0);
  await expect(precautionaryLobbyDeviceHint(page)).toHaveCount(0);
});

test("S313E-LOBBY-002: a recognized media acquisition failure renders a device warning", async ({
  page,
  request,
}) => {
  const event = await createTestEvent({ withParticipants: true, title: "Stage 3.13E media warning" });
  const participants = await getEventParticipants(event.id);
  const owner = participants.find((participant) => participant.displayName === "Dmitry");
  expect(owner?.userId).toBeTruthy();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Camera unavailable", "NotFoundError");
    };
  });
  await authenticate(page, owner!.userId!);
  await setVoxProviderFault(page, "media-acquisition");

  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  await expect(page.getByTestId("event-lobby-device-warning")).toBeVisible();
});

test("S313E-DASH-027: Cases header pictogram remains and dense rows stay compact", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/cases");

  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="case"]'),
    }),
  ).toBeVisible();

  const table = page.locator("table").first();
  await expect(table).toBeVisible();
  await expect(table.locator('[data-object-type="case"]')).toHaveCount(0);
  await expect(
    table.locator(
      'img[src*="case-32"], img[src*="objects%2F"], img[src*="/icons/objects/"], img[src*="case-"]',
    ),
  ).toHaveCount(0);
  await expect(table.locator("tbody img")).toHaveCount(0);

  const editAction = page.locator(`a[href="/cases/${fixture.caseId}/edit"]`).first();
  await expect(editAction).toBeVisible();
  const actionBox = await editAction.boundingBox();
  expect(actionBox).toBeTruthy();
  expect((actionBox?.x ?? 0) + (actionBox?.width ?? 0)).toBeLessThanOrEqual(1280);

  const overflow = await table.evaluate((node) => {
    const scroller = node.closest("div");
    if (!scroller) return { scrollWidth: 0, clientWidth: 0 };
    return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("S313E-DASH-028: Case create and edit headers show the large Case pictogram", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);

  await page.goto("/cases/new");
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="case"]'),
    }),
  ).toBeVisible();

  await page.goto(`/cases/${fixture.caseId}/edit`);
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="case"]'),
    }),
  ).toBeVisible();
});

test("S313E-DASH-029: Event create and edit headers show the large Event pictogram", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);

  await page.goto("/events/new");
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="event"]'),
    }),
  ).toBeVisible();

  await page.goto(`/events/${fixture.eventId}/edit`);
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="event"]'),
    }),
  ).toBeVisible();
});

test("S313E-DASH-030: Session create and detail headers show the large Room pictogram", async ({
  page,
  request,
}) => {
  const fixture = await createDashboardFixture(request, "en");
  await authenticate(page, fixture.userId);

  await page.goto("/sessions/new");
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="room"]'),
    }),
  ).toBeVisible();

  await page.goto(`/sessions/${fixture.sessionId}`);
  await expect(
    page.getByTestId("page-header-pictogram").filter({
      has: page.locator('[data-object-type="room"]'),
    }),
  ).toBeVisible();
});
