import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  captureUiAuditEvidence,
  ensureUiAuditArtifactDirs,
  getUiAuditArtifactRoot,
  writeUiAuditManifestAndIndex,
  type UiAuditEvidenceRecord,
} from "./helpers/ui-audit-collector";
import {
  createUiAuditEvent,
  createUiAuditSession,
  createUiAuditUser,
} from "./helpers/ui-audit-fixtures";
import {
  cleanupE2eData,
  createCompletedTranscript,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

const evidenceRecords: UiAuditEvidenceRecord[] = [];

test.beforeAll(async () => {
  await cleanupE2eData();
  await ensureUiAuditArtifactDirs();
});

test.afterAll(async () => {
  await writeUiAuditManifestAndIndex(evidenceRecords);
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
  return rawToken;
}

async function loginWithUserSession(page: Page, userId: string) {
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

async function seedCookieConsent(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "negotaitions.cookieConsent.v1",
      JSON.stringify({
        necessary: true,
        analytics: false,
        marketing: false,
        timestamp: Date.now(),
      }),
    );
  });
}

async function capture(page: Page, testInfo: Parameters<typeof captureUiAuditEvidence>[1], meta: Parameters<typeof captureUiAuditEvidence>[2]) {
  evidenceRecords.push(await captureUiAuditEvidence(page, testInfo, meta));
}

test("UIAUD-DASH/LIST evidence: dense dashboard and filter pages @ui-audit", async ({
  page,
}, testInfo) => {
  const user = await createUiAuditUser({
    preferredLocale: "ru",
    name: "Аудитор интерфейса Stage 3.12",
  });

  for (let index = 0; index < 6; index += 1) {
    await createUiAuditEvent({
      hostUserId: user.id,
      peopleCount: index % 2 === 0 ? 8 : 20,
      sessionCount: index % 3,
      language: index % 2 === 0 ? "RU" : "EN",
      completed: index > 3,
      longNames: index % 2 === 1,
      title: `UIAUD dashboard event ${index + 1} with intentionally long mixed status title`,
    });
  }

  for (const count of [2, 4, 8]) {
    await createUiAuditSession({
      facilitatorUserId: user.id,
      negotiatorCount: count,
      observerCount: count * 2,
      lifecycle: count === 2 ? "OPEN" : count === 4 ? "RUNNING" : "DEBRIEF_OPEN",
      cameraPattern: count === 2 ? "all-off" : "mixed",
      micPattern: "mixed",
      longNames: true,
    });
  }

  await seedCookieConsent(page);
  await loginWithUserSession(page, user.id);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Dashboard|Панель/i })).toBeVisible();
  await capture(page, testInfo, {
    scenarioId: "UIAUD-DASH-020",
    surface: "dashboard",
    journey: "participant-owner-entry",
    role: "event-owner",
    viewport: "1440x900",
    state: "mixed-density",
    findingIds: ["UI-F001", "UI-F002", "UI-F010"],
  });

  await page.goto("/events");
  await expect(page.getByTestId("events-page")).toBeVisible();
  await capture(page, testInfo, {
    scenarioId: "UIAUD-FILTER-001",
    surface: "events-list",
    journey: "list-filtering",
    role: "event-owner",
    viewport: "1440x900",
    state: "filters-visible",
    findingIds: ["UI-F003"],
  });

  await page.goto("/sessions");
  await expect(page.getByRole("heading", { name: /Сессии|Sessions/i })).toBeVisible();
  await capture(page, testInfo, {
    scenarioId: "UIAUD-FILTER-002",
    surface: "sessions-list",
    journey: "list-filtering",
    role: "facilitator",
    viewport: "1440x900",
    state: "filters-visible",
    findingIds: ["UI-F003", "UI-F006"],
  });

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: /Кейсы|Cases/i })).toBeVisible();
  await capture(page, testInfo, {
    scenarioId: "UIAUD-FILTER-003",
    surface: "cases-list",
    journey: "list-filtering",
    role: "facilitator",
    viewport: "1440x900",
    state: "filters-visible",
    findingIds: ["UI-F003"],
  });
});

test("UIAUD-LOBBY evidence: owner lobby with many people and sessions @ui-audit", async ({
  page,
}, testInfo) => {
  const owner = await createUiAuditUser({
    preferredLocale: "ru",
    name: "Owner With Long Audit Name",
  });
  const event = await createUiAuditEvent({
    hostUserId: owner.id,
    peopleCount: 50,
    sessionCount: 4,
    language: "RU",
    longNames: true,
  });

  await seedCookieConsent(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/events/${event.id}/lobby?hostToken=${encodeURIComponent(event.hostToken)}`);
  await expect(page.getByTestId("host-controls-panel")).toBeVisible({ timeout: 20_000 });
  await capture(page, testInfo, {
    scenarioId: "UIAUD-LOBBY-050",
    surface: "event-lobby",
    journey: "event-owner-management",
    role: "event-owner",
    viewport: "1440x900",
    state: "50-users-4-sessions",
    findingIds: ["UI-F004", "UI-F005", "UI-F006", "UI-F007", "UI-F008"],
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, testInfo, {
    scenarioId: "UIAUD-LOBBY-MOB-001",
    surface: "event-lobby",
    journey: "event-owner-management",
    role: "event-owner",
    viewport: "390x844",
    state: "50-users-mobile",
    findingIds: ["UI-F004", "UI-F005", "UI-F009"],
  });
});

test("UIAUD-ROOM evidence: eight negotiators and observer-heavy room @ui-audit", async ({
  page,
}, testInfo) => {
  const facilitator = await createUiAuditUser({
    preferredLocale: "en",
    name: "Facilitator Eight Negotiator Audit",
  });
  const session = await createUiAuditSession({
    facilitatorUserId: facilitator.id,
    negotiatorCount: 8,
    observerCount: 20,
    lifecycle: "RUNNING",
    language: "EN",
    cameraPattern: "mixed",
    micPattern: "mixed",
    longNames: true,
  });
  const facilitatorParticipant = session.participants.find((participant) => participant.type === "FACILITATOR");
  expect(facilitatorParticipant).toBeTruthy();

  await seedCookieConsent(page);
  await loginWithUserSession(page, facilitator.id);
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/room/${session.id}?joinToken=${encodeURIComponent(facilitatorParticipant!.joinToken)}&media=off`,
  );
  await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 25_000 });
  await capture(page, testInfo, {
    scenarioId: "UIAUD-SCALE-008",
    surface: "negotiation-room",
    journey: "facilitator-active-room",
    role: "facilitator",
    viewport: "1440x900",
    state: "8-negotiators-20-observers",
    findingIds: ["UI-F011", "UI-F012", "UI-F013"],
  });
  await page.context().tracing.stop({
    path: path.join(getUiAuditArtifactRoot(), "traces", "UIAUD-SCALE-008__facilitator__1440x900.zip"),
  });
});

test("UIAUD-DEBRIEF evidence: debrief and materials transition @ui-audit", async ({
  page,
}, testInfo) => {
  const facilitator = await createUiAuditUser({ preferredLocale: "en" });
  const session = await createUiAuditSession({
    facilitatorUserId: facilitator.id,
    negotiatorCount: 2,
    observerCount: 4,
    lifecycle: "DEBRIEF_OPEN",
    language: "EN",
    cameraPattern: "all-off",
    micPattern: "all-off",
  });
  await createCompletedTranscript(session.id);
  const facilitatorParticipant = session.participants.find((participant) => participant.type === "FACILITATOR");
  expect(facilitatorParticipant).toBeTruthy();

  await seedCookieConsent(page);
  await loginWithUserSession(page, facilitator.id);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/room/${session.id}?joinToken=${encodeURIComponent(facilitatorParticipant!.joinToken)}`);
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible({ timeout: 25_000 });
  await capture(page, testInfo, {
    scenarioId: "UIAUD-DEBRIEF-001",
    surface: "debrief",
    journey: "facilitator-debrief",
    role: "facilitator",
    viewport: "1440x900",
    state: "debrief-open",
    findingIds: ["UI-F014", "UI-F015"],
  });

  await page.goto(`/join/${encodeURIComponent(facilitatorParticipant!.joinToken)}`);
  await expect(page.getByText(/Session materials|Материалы сессии/)).toBeVisible({ timeout: 15_000 });
  await capture(page, testInfo, {
    scenarioId: "UIAUD-MATERIALS-001",
    surface: "materials",
    journey: "materials-review",
    role: "facilitator",
    viewport: "1440x900",
    state: "completed-transcript",
    findingIds: ["UI-F015"],
  });
});
