/**
 * Stage 3.12B-W1 — Session room to Event lobby media handoff.
 *
 * These tests exercise the real route navigation, the real explicit-leave state
 * machine, the real React lifecycle and the real lobby shell. Only the provider
 * transport outcome is scripted, through the server-gated seam in
 * lib/voximplant/provider-fault-simulation.ts, so the suite never depends on
 * the live Voximplant gateway or on reverse-tunnel latency.
 */

import { createHash, randomBytes } from "node:crypto";

import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  e2eId,
  forceSessionRunningForE2e,
  getEventParticipants,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

type FaultMode =
  | "off"
  | "transport-408"
  | "gateway-unavailable"
  | "ice-restart-timeout"
  | "delayed-connect"
  | "delayed-disconnect"
  | "terminal-auth"
  | "recover-after-first-failure";

/**
 * Console noise the dev server and test runner emit regardless of this feature.
 * Anything outside this allowlist fails the test.
 */
const ALLOWED_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  /Failed to load resource/i,
  /favicon/i,
  /Download the React DevTools/i,
  /net::ERR_/i,
  /\[Fast Refresh\]/i,
  /Warning: .*hydrat/i,
  // Emitted by Chromium itself, not by application code, when the WebSDK's
  // transport writes a final frame while the shared socket is already closing
  // during the Session -> lobby handoff. It cannot be prevented without
  // modifying the vendored SDK, and Next.js does not collect it into the
  // development error overlay.
  /WebSocket is already in CLOSING or CLOSED state/i,
];

function isAllowedConsoleError(text: string): boolean {
  return ALLOWED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

type ConsoleWatcher = {
  errors: string[];
  unexpected: () => string[];
  stop: () => void;
};

function watchConsole(page: Page): ConsoleWatcher {
  const errors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  };
  const onPageError = (error: Error) => errors.push(`pageerror: ${error.message}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    unexpected: () => errors.filter((text) => !isAllowedConsoleError(text)),
    stop: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

/**
 * `nextjs-portal` itself is always present in dev because it hosts the Dev Tools
 * button. The error overlay is `[data-nextjs-dialog-overlay]`, and `[data-issues]`
 * is the indicator badge Next renders once it has collected any console error or
 * runtime error. Both must stay absent for a recoverable provider failure.
 */
async function expectNoDevErrorOverlay(page: Page) {
  await expect(
    page.locator("nextjs-portal [data-nextjs-dialog-overlay]"),
    "Next.js development error overlay must not open",
  ).toHaveCount(0);
  await expect(
    page.locator("nextjs-portal [data-issues]"),
    "Next.js must not collect any development issue",
  ).toHaveCount(0);
}

async function setProviderFault(page: Page, mode: FaultMode) {
  const response = await page.request.post("/api/test/vox-provider-fault", {
    data: { mode },
  });
  expect(
    response.status(),
    "provider fault seam requires EXTERNAL_SERVICES_MODE=mock",
  ).toBe(200);
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

async function login(page: Page, userId: string) {
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

async function cleanupHandoffData() {
  const sessions = await query<{ id: string }>(
    `SELECT "id" FROM "Session"
     WHERE "title" LIKE 'Stage 3.12B Handoff%'
        OR "snapshotCaseTitle" LIKE 'Stage 3.12B Handoff%'`,
  );
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length > 0) {
    await query(`DELETE FROM "SessionRoomConnection" WHERE "sessionId" = ANY($1)`, [
      sessionIds,
    ]);
    await query(`DELETE FROM "SessionParticipant" WHERE "sessionId" = ANY($1)`, [sessionIds]);
    await query(`DELETE FROM "SessionRole" WHERE "sessionId" = ANY($1)`, [sessionIds]);
    await query(`DELETE FROM "Session" WHERE "id" = ANY($1)`, [sessionIds]);
  }
  const events = await query<{ id: string }>(
    `SELECT "id" FROM "TrainingEvent" WHERE "title" LIKE 'Stage 3.12B Handoff%'`,
  );
  const eventIds = events.map((event) => event.id);
  if (eventIds.length > 0) {
    await query(`DELETE FROM "EventParticipant" WHERE "eventId" = ANY($1)`, [eventIds]);
    await query(`DELETE FROM "TrainingEvent" WHERE "id" = ANY($1)`, [eventIds]);
  }
}

type HandoffFixture = {
  eventId: string;
  sessionId: string;
  participantUserId: string;
  facilitatorUserId: string;
  lobbyUrl: string;
  roomUrl: string;
};

async function createHandoffFixture(): Promise<HandoffFixture> {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: "Stage 3.12B Handoff Event",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participants.find((participant) => participant.displayName === "Dmitry")!;
  const igor = participants.find((participant) => participant.displayName === "Igor")!;
  const alex = participants.find((participant) => participant.displayName === "Alex")!;
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const participantUser = await createActiveUser({ preferredLocale: "en" });
  const otherUser = await createActiveUser({ preferredLocale: "en" });
  const [buyerRole, sellerRole] = negotiationCase.roles;

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, facilitatorUser.id],
  );
  await query(`UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`, [
    dmitry.id,
    facilitatorUser.id,
  ]);
  await query(`UPDATE "EventParticipant" SET "userId"=$2,"preference"='PLAY' WHERE "id"=$1`, [
    igor.id,
    participantUser.id,
  ]);
  await query(`UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`, [
    alex.id,
    otherUser.id,
  ]);

  const sessionId = e2eId("stage-312b-handoff");
  const roleAId = e2eId("stage-312b-handoff-role-a");
  const roleBId = e2eId("stage-312b-handoff-role-b");
  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","eventId","title","roomLabel",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,'Stage 3.12B Handoff Session','Handoff Room',
        'Stage 3.12B Handoff Case','Business context','Public instructions','EN',300,900,NOW())`,
    [sessionId, negotiationCase.id, facilitatorUser.id, event.id],
  );
  await query(
    `INSERT INTO "SessionRole"
       ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
       ($1,$3,$4,'Buyer private','Buyer objective','Buyer constraints','Buyer hidden','Buyer fallback',0,NOW()),
       ($2,$3,$5,'Seller private','Seller objective','Seller constraints','Seller hidden','Seller fallback',1,NOW())`,
    [roleAId, roleBId, sessionId, buyerRole?.name ?? "Buyer", sellerRole?.name ?? "Seller"],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","eventParticipantId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
     VALUES
       (gen_random_uuid(),$1,$2,$3,NULL,'FACILITATOR',$4,'Dmitry','',NOW()),
       (gen_random_uuid(),$1,$5,$6,$7,'PARTICIPANT',$8,'Igor','',NOW()),
       (gen_random_uuid(),$1,$9,$10,$11,'PARTICIPANT',$12,'Alex','',NOW())`,
    [
      sessionId,
      facilitatorUser.id,
      dmitry.id,
      `handoff-host-${sessionId}`,
      participantUser.id,
      igor.id,
      roleAId,
      `handoff-igor-${sessionId}`,
      otherUser.id,
      alex.id,
      roleBId,
      `handoff-alex-${sessionId}`,
    ],
  );
  await forceSessionRunningForE2e(sessionId);

  return {
    eventId: event.id,
    sessionId,
    participantUserId: participantUser.id,
    facilitatorUserId: facilitatorUser.id,
    lobbyUrl: `/events/${event.id}/lobby`,
    roomUrl: `/room/${sessionId}?media=off`,
  };
}

async function openRoom(page: Page, fixture: HandoffFixture) {
  const response = await page.goto(fixture.roomUrl, { waitUntil: "domcontentloaded" });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("back-to-event-lobby-button")).toBeEnabled({
    timeout: 30_000,
  });
}

/**
 * Clicks "Back to lobby" and measures how long the lobby shell takes to appear.
 * The lobby shell must not wait for any provider operation.
 */
async function leaveToLobby(page: Page, fixture: HandoffFixture) {
  const startedAt = Date.now();
  await page.getByTestId("back-to-event-lobby-button").click();
  await page.waitForURL(`**${fixture.lobbyUrl}`, { timeout: 20_000 });
  await expect(page.getByTestId("event-lobby-page")).toBeVisible({ timeout: 20_000 });
  return Date.now() - startedAt;
}

/** Lobby controls that must stay usable while media is still connecting. */
async function expectLobbyShellUsable(page: Page) {
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  await expect(page.getByTestId("desired-role-summary")).toBeVisible({ timeout: 20_000 });
}

test.beforeEach(async () => {
  await cleanupHandoffData();
  await cleanupE2eData();
});

test.afterEach(async ({ page }) => {
  await setProviderFault(page, "off").catch(() => {});
  await cleanupHandoffData();
  await cleanupE2eData();
});

test("participant returns from an active session to the lobby on the first click", async ({
  page,
}) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.participantUserId);
  await setProviderFault(page, "off");
  const consoleWatcher = watchConsole(page);

  await openRoom(page, fixture);
  const elapsedMs = await leaveToLobby(page, fixture);

  await expectLobbyShellUsable(page);
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected(), "unclassified console errors").toEqual([]);
  consoleWatcher.stop();

  test.info().annotations.push({
    type: "timing",
    description: `lobby shell visible ${elapsedMs}ms after leave click`,
  });
  expect(elapsedMs).toBeLessThan(20_000);
});

test("facilitator returns from an active session to the lobby on the first click", async ({
  page,
}) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.facilitatorUserId);
  await setProviderFault(page, "off");
  const consoleWatcher = watchConsole(page);

  await openRoom(page, fixture);
  await leaveToLobby(page, fixture);

  await expectLobbyShellUsable(page);
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected()).toEqual([]);
  consoleWatcher.stop();
});

test("a rapid double click produces one leave and one navigation", async ({ page }) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.participantUserId);
  await setProviderFault(page, "off");

  let leaveRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/presence/leave")) {
      leaveRequests += 1;
    }
  });

  await openRoom(page, fixture);
  const button = page.getByTestId("back-to-event-lobby-button");
  await button.click();
  await button.click({ force: true, timeout: 2_000 }).catch(() => {
    // The button unmounts as soon as navigation commits; that is the intent.
  });

  await page.waitForURL(`**${fixture.lobbyUrl}`, { timeout: 20_000 });
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  await expectNoDevErrorOverlay(page);
  expect(leaveRequests, "explicit leave must be dispatched once").toBeLessThanOrEqual(1);
});

test("the lobby renders and stays usable while the provider connect is delayed", async ({
  page,
}) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.participantUserId);
  await setProviderFault(page, "delayed-connect");
  const consoleWatcher = watchConsole(page);

  await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
  await expectLobbyShellUsable(page);

  // The video pane reports a non-blocking connecting state, never a page gate.
  await expect(page.getByTestId("event-lobby-video-connecting")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("event-lobby-voximplant-error")).toHaveCount(0);

  await expect(page.getByTestId("event-lobby-video-connecting")).toHaveCount(0, {
    timeout: 20_000,
  });
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected()).toEqual([]);
  consoleWatcher.stop();
});

test("a delayed previous teardown does not block the lobby shell", async ({ page }) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.participantUserId);
  await setProviderFault(page, "delayed-disconnect");
  const consoleWatcher = watchConsole(page);

  await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
  await expectLobbyShellUsable(page);
  await expect(page.getByTestId("event-lobby-video-connecting")).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.getByTestId("event-lobby-video-connecting")).toHaveCount(0, {
    timeout: 25_000,
  });
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected()).toEqual([]);
  consoleWatcher.stop();
});

for (const scenario of [
  { mode: "transport-408" as const, title: "transport 408" },
  { mode: "gateway-unavailable" as const, title: "gateway ConnectionNetworkError" },
  { mode: "ice-restart-timeout" as const, title: "ICE restart timeout" },
]) {
  test(`${scenario.title} degrades lobby media without a development error overlay`, async ({
    page,
  }) => {
    const fixture = await createHandoffFixture();
    await login(page, fixture.participantUserId);
    await setProviderFault(page, scenario.mode);
    const consoleWatcher = watchConsole(page);

    await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
    await expectLobbyShellUsable(page);

    // Bounded retry ends in a controlled terminal state with a retry control.
    await expect(page.getByTestId("event-lobby-voximplant-error")).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByTestId("event-lobby-voximplant-retry")).toBeVisible();

    // The route never rolls back and the shell never becomes unusable.
    expect(page.url()).toContain(fixture.lobbyUrl);
    await expectLobbyShellUsable(page);
    await expectNoDevErrorOverlay(page);
    expect(
      consoleWatcher.unexpected(),
      `recoverable ${scenario.mode} must not reach console.error`,
    ).toEqual([]);
    consoleWatcher.stop();
  });
}

test("a transient failure recovers on a bounded retry", async ({ page }) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.participantUserId);
  await setProviderFault(page, "recover-after-first-failure");
  const consoleWatcher = watchConsole(page);

  await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
  await expectLobbyShellUsable(page);

  await expect(page.getByTestId("event-lobby-video-connecting")).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(page.getByTestId("event-lobby-voximplant-error")).toHaveCount(0);
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected()).toEqual([]);
  consoleWatcher.stop();
});

test("an authorization failure is terminal and offers a controlled retry", async ({
  page,
}) => {
  const fixture = await createHandoffFixture();
  await login(page, fixture.participantUserId);
  await setProviderFault(page, "terminal-auth");

  await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
  await expectLobbyShellUsable(page);

  await expect(page.getByTestId("event-lobby-voximplant-error")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("event-lobby-voximplant-retry")).toBeVisible();
  await expect(page.getByTestId("event-lobby-voximplant-error")).toContainText(
    "provider_authorization_rejected",
  );
  await expectNoDevErrorOverlay(page);
});

test("returning to the lobby from a finished session keeps the shell usable", async ({
  page,
}) => {
  const fixture = await createHandoffFixture();
  await query(
    `UPDATE "Session"
     SET "negotiationState"='FINISHED', "roomLifecycle"='DEBRIEF_OPEN'
     WHERE "id"=$1`,
    [fixture.sessionId],
  );
  await login(page, fixture.facilitatorUserId);
  await setProviderFault(page, "off");
  const consoleWatcher = watchConsole(page);

  await openRoom(page, fixture);
  await leaveToLobby(page, fixture);

  await expectLobbyShellUsable(page);
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected()).toEqual([]);
  consoleWatcher.stop();
});

test("duplicate-tab protection still activates in a real conflicting tab", async ({
  browser,
}) => {
  const fixture = await createHandoffFixture();
  const context = await browser.newContext();
  const rawToken = await createUserSessionCookie(fixture.participantUserId);
  await context.addCookies([
    {
      name: "auth_session",
      value: rawToken,
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const firstTab = await context.newPage();
  await setProviderFault(firstTab, "off");
  await firstTab.goto(fixture.roomUrl, { waitUntil: "domcontentloaded" });
  await expect(firstTab.getByTestId("session-room-header")).toBeVisible({ timeout: 30_000 });

  const secondTab = await context.newPage();
  await secondTab.goto(fixture.roomUrl, { waitUntil: "domcontentloaded" });
  await expect(secondTab.getByTestId("session-room-header")).toBeVisible({ timeout: 30_000 });

  // The newest connection wins; the superseded tab must be told it is stale.
  const staleConnections = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SessionRoomConnection"
     WHERE "sessionId" = $1 AND "supersededAt" IS NOT NULL`,
    [fixture.sessionId],
  );
  expect(Number(staleConnections[0]?.count ?? "0")).toBeGreaterThanOrEqual(1);

  await expectNoDevErrorOverlay(secondTab);
  await context.close();
});
