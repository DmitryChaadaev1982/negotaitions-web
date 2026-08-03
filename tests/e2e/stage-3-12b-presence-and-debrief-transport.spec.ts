/**
 * Stage 3.12B-W1 — immediate away presence and long-debrief transport recovery.
 *
 * Two defects found in manual testing:
 *
 *  A. Leaving the Session through a navigation that bypasses the Event lobby
 *     left the `SessionRoomConnection` lease untouched, so other participants
 *     kept seeing `IN_SESSION` until the lease lapsed roughly two minutes later.
 *  B. A gateway WebSocket close on a long-lived `DEBRIEF_OPEN` Session was
 *     classified as an unknown terminal provider failure, reached
 *     `console.error` and raised the Next.js development overlay.
 *
 * The transport case uses the server-gated fault seam rather than waiting for a
 * real gateway to drop; everything else — routing, explicit leave, presence
 * resolution, polling, the room shell — is the real implementation.
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

/** `brand.alt` in the English dictionary; the room logo exits to the dashboard. */
const BRAND_LOGO_LABEL = "NegotAItions — AI-powered negotiation training";
/** Matches `PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS` in lib/presence.ts. */
const PRESENCE_GRACE_MS = 120_000;
/** Matches `EVENT_LOBBY_POLL_INTERVAL_MS` in lib/event-state-polling.ts. */
const LOBBY_POLL_INTERVAL_MS = 3_000;
/**
 * One polling cycle plus room for the request itself. Deliberately far below
 * the lease TTL: the point of the fix is that presence no longer waits for it.
 */
const ONE_POLL_CYCLE_TIMEOUT_MS = LOBBY_POLL_INTERVAL_MS * 3;

const ALLOWED_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  /Failed to load resource/i,
  /favicon/i,
  /Download the React DevTools/i,
  /net::ERR_/i,
  /\[Fast Refresh\]/i,
  /Warning: .*hydrat/i,
  // Chromium itself, not application code, when the WebSDK writes a final frame
  // on an already closing socket. Next.js does not collect it into the overlay.
  /WebSocket is already in CLOSING or CLOSED state/i,
];

function isAllowedConsoleError(text: string): boolean {
  return ALLOWED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

type ConsoleWatcher = {
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
    unexpected: () => errors.filter((text) => !isAllowedConsoleError(text)),
    stop: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

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

async function setProviderFault(page: Page, mode: string) {
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

async function loginContext(page: Page, userId: string) {
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

async function cleanupPresenceData() {
  const sessions = await query<{ id: string }>(
    `SELECT "id" FROM "Session"
     WHERE "title" LIKE 'Stage 3.12B Exit%'
        OR "snapshotCaseTitle" LIKE 'Stage 3.12B Exit%'`,
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
    `SELECT "id" FROM "TrainingEvent" WHERE "title" LIKE 'Stage 3.12B Exit%'`,
  );
  const eventIds = events.map((event) => event.id);
  if (eventIds.length > 0) {
    await query(`DELETE FROM "EventParticipant" WHERE "eventId" = ANY($1)`, [eventIds]);
    await query(`DELETE FROM "TrainingEvent" WHERE "id" = ANY($1)`, [eventIds]);
  }
}

type ExitFixture = {
  eventId: string;
  sessionId: string;
  participantUserId: string;
  facilitatorUserId: string;
  participantDisplayName: string;
  lobbyUrl: string;
  roomUrl: string;
};

async function createExitFixture(): Promise<ExitFixture> {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: "Stage 3.12B Exit Event",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participants.find((participant) => participant.displayName === "Dmitry")!;
  const igor = participants.find((participant) => participant.displayName === "Igor")!;
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const participantUser = await createActiveUser({ preferredLocale: "en" });
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

  const sessionId = e2eId("stage-312b-exit");
  const roleAId = e2eId("stage-312b-exit-role-a");
  const roleBId = e2eId("stage-312b-exit-role-b");
  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","eventId","title","roomLabel",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,'Stage 3.12B Exit Session','Exit Room',
        'Stage 3.12B Exit Case','Business context','Public instructions','EN',300,900,NOW())`,
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
       (gen_random_uuid(),$1,$5,$6,$7,'PARTICIPANT',$8,'Igor','',NOW())`,
    [
      sessionId,
      facilitatorUser.id,
      dmitry.id,
      `exit-host-${sessionId}`,
      participantUser.id,
      igor.id,
      roleAId,
      `exit-igor-${sessionId}`,
    ],
  );
  await forceSessionRunningForE2e(sessionId);

  return {
    eventId: event.id,
    sessionId,
    participantUserId: participantUser.id,
    facilitatorUserId: facilitatorUser.id,
    participantDisplayName: "Igor",
    lobbyUrl: `/events/${event.id}/lobby`,
    roomUrl: `/room/${sessionId}?media=off`,
  };
}

/** The observer's view of one participant card in the Event lobby. */
function participantCard(page: Page, displayName: string) {
  return page.getByTestId("participant-card").filter({ hasText: displayName });
}

function presenceIndicator(page: Page, displayName: string) {
  return participantCard(page, displayName).getByTestId("event-presence-indicator");
}

async function openRoom(page: Page, fixture: ExitFixture) {
  const response = await page.goto(fixture.roomUrl, { waitUntil: "domcontentloaded" });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 30_000 });
}

async function openLobbyObserver(page: Page, fixture: ExitFixture) {
  await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("event-lobby-page")).toBeVisible({ timeout: 20_000 });
}

async function activeConnectionCount(sessionId: string) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SessionRoomConnection"
     WHERE "sessionId" = $1
       AND "disconnectedAt" IS NULL
       AND "supersededAt" IS NULL
       AND "revokedAt" IS NULL
       AND "expiresAt" > NOW()`,
    [sessionId],
  );
  return Number(rows[0]?.count ?? "0");
}

/**
 * Moves the participant's terminal presence evidence past the grace window so
 * the `OFFLINE` transition can be asserted without waiting two real minutes.
 *
 * Presence takes the latest of every terminal signal, so the Event-side
 * `lastSeenAt` has to move with the connection's terminal timestamps; ageing
 * only the connection would leave the participant legitimately away.
 */
async function agePresenceEvidenceBeyondGrace(fixture: ExitFixture) {
  const ageMs = String(PRESENCE_GRACE_MS + 30_000);
  await query(
    `UPDATE "SessionRoomConnection"
     SET "disconnectedAt" = NOW() - ($2 || ' milliseconds')::interval,
         "expiresAt" = NOW() - ($2 || ' milliseconds')::interval
     WHERE "sessionId" = $1 AND "disconnectedAt" IS NOT NULL`,
    [fixture.sessionId, ageMs],
  );
  await query(
    `UPDATE "EventParticipant"
     SET "lastSeenAt" = NOW() - ($3 || ' milliseconds')::interval
     WHERE "eventId" = $1 AND "userId" = $2 AND "lastSeenAt" IS NOT NULL`,
    [fixture.eventId, fixture.participantUserId, ageMs],
  );
}

test.beforeEach(async () => {
  await cleanupPresenceData();
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupPresenceData();
  await cleanupE2eData();
});

// ── A. Intentional exit that bypasses the Event lobby ────────────────────────

for (const exit of [
  { testId: "back-to-sessions-button", label: "Sessions overview" },
  { testId: "session-materials-link", label: "session materials" },
]) {
  test(`leaving to ${exit.label} marks the participant away on the next lobby poll`, async ({
    browser,
  }) => {
    const fixture = await createExitFixture();

    const observerContext = await browser.newContext();
    const observer = await observerContext.newPage();
    await loginContext(observer, fixture.facilitatorUserId);

    const participantContext = await browser.newContext();
    const participant = await participantContext.newPage();
    await loginContext(participant, fixture.participantUserId);
    await setProviderFault(participant, "off");

    let leaveRequests = 0;
    participant.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/presence/leave")) {
        leaveRequests += 1;
      }
    });

    try {
      await openRoom(participant, fixture);
      await openLobbyObserver(observer, fixture);

      await expect(
        presenceIndicator(observer, fixture.participantDisplayName),
        "the observer must first see the participant inside the Session",
      ).toHaveAttribute("data-presence-status", "IN_SESSION", { timeout: 20_000 });

      // The defect path: a product navigation that never passes through the lobby.
      await participant.getByTestId(exit.testId).click();
      await expect(participant.getByTestId("session-room-header")).toHaveCount(0, {
        timeout: 30_000,
      });

      expect(leaveRequests, "explicit leave is dispatched exactly once").toBe(1);
      expect(
        await activeConnectionCount(fixture.sessionId),
        "the room connection must be terminal the moment the user left",
      ).toBe(0);

      await expect(
        presenceIndicator(observer, fixture.participantDisplayName),
        "away presence must appear within one polling cycle, not after the lease",
      ).toHaveAttribute("data-presence-status", "TEMPORARILY_AWAY", {
        timeout: ONE_POLL_CYCLE_TIMEOUT_MS,
      });

      const card = participantCard(observer, fixture.participantDisplayName);
      await expect(card.getByTestId("compact-person-camera-status-icon")).toHaveAttribute(
        "data-status",
        "unknown",
      );
      await expect(card.getByTestId("compact-person-mic-status-icon")).toHaveAttribute(
        "data-status",
        "unknown",
      );
      await expect(
        card.getByTestId("compact-person-mic-status-icon"),
        "media controls for an absent participant must not be actionable",
      ).toHaveRole("img");

      await agePresenceEvidenceBeyondGrace(fixture);
      await expect(
        presenceIndicator(observer, fixture.participantDisplayName),
        "the grace window is measured from the departure, so it then expires",
      ).toHaveAttribute("data-presence-status", "OFFLINE", {
        timeout: ONE_POLL_CYCLE_TIMEOUT_MS,
      });
    } finally {
      await participantContext.close();
      await observerContext.close();
    }
  });
}

test("leaving through the room logo to the dashboard terminates the connection immediately", async ({
  page,
}) => {
  const fixture = await createExitFixture();
  await loginContext(page, fixture.participantUserId);
  await setProviderFault(page, "off");

  let leaveRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/presence/leave")) {
      leaveRequests += 1;
    }
  });

  await openRoom(page, fixture);
  expect(await activeConnectionCount(fixture.sessionId)).toBe(1);

  // Only one of the responsive logo variants is rendered at this viewport.
  await page
    .getByTestId("session-room-header")
    .getByRole("button", { name: BRAND_LOGO_LABEL })
    .filter({ visible: true })
    .click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  expect(leaveRequests).toBe(1);
  expect(await activeConnectionCount(fixture.sessionId)).toBe(0);
});

test("returning to the Event lobby still uses the same single leave call", async ({ page }) => {
  const fixture = await createExitFixture();
  await loginContext(page, fixture.participantUserId);
  await setProviderFault(page, "off");

  let leaveRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/presence/leave")) {
      leaveRequests += 1;
    }
  });

  await openRoom(page, fixture);
  await page.getByTestId("back-to-event-lobby-button").click();
  await page.waitForURL(`**${fixture.lobbyUrl}`, { timeout: 20_000 });
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();

  expect(leaveRequests, "the lobby exit shares the canonical implementation").toBe(1);
  expect(await activeConnectionCount(fixture.sessionId)).toBe(0);
});

// ── A2. Non-explicit disappearance keeps lease semantics ─────────────────────

test("a refresh does not persist an explicit leave and stays lease-based", async ({ page }) => {
  const fixture = await createExitFixture();
  await loginContext(page, fixture.participantUserId);
  await setProviderFault(page, "off");

  await openRoom(page, fixture);

  let leaveRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/presence/leave")) {
      leaveRequests += 1;
    }
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 30_000 });

  expect(leaveRequests, "a refresh is not a departure").toBe(0);
  const disconnected = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SessionRoomConnection"
     WHERE "sessionId" = $1 AND "disconnectedReason" = 'EXPLICIT_LEAVE'`,
    [fixture.sessionId],
  );
  expect(Number(disconnected[0]?.count ?? "0")).toBe(0);
  expect(
    await activeConnectionCount(fixture.sessionId),
    "the refreshed tab keeps exactly one active lease",
  ).toBe(1);
});

test("closing the tab leaves the connection to lease expiry", async ({ browser }) => {
  const fixture = await createExitFixture();
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginContext(page, fixture.participantUserId);
  await setProviderFault(page, "off");

  await openRoom(page, fixture);
  expect(await activeConnectionCount(fixture.sessionId)).toBe(1);

  await context.close();

  // No terminal timestamp exists, so presence must still rely on the lease.
  const rows = await query<{ disconnectedAt: string | null; disconnectedReason: string | null }>(
    `SELECT "disconnectedAt", "disconnectedReason"
     FROM "SessionRoomConnection"
     WHERE "sessionId" = $1`,
    [fixture.sessionId],
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.disconnectedAt).toBeNull();
    expect(row.disconnectedReason).toBeNull();
  }
  expect(await activeConnectionCount(fixture.sessionId)).toBe(1);
});

// ── B. Gateway WebSocket close on a long-lived DEBRIEF_OPEN Session ──────────

test("a gateway socket close during DEBRIEF_OPEN recovers without a development overlay", async ({
  page,
}) => {
  const fixture = await createExitFixture();
  await query(
    `UPDATE "Session"
     SET "negotiationState"='FINISHED', "roomLifecycle"='DEBRIEF_OPEN'
     WHERE "id"=$1`,
    [fixture.sessionId],
  );
  await loginContext(page, fixture.facilitatorUserId);
  await setProviderFault(page, "gateway-ws-close-connected");
  const consoleWatcher = watchConsole(page);

  await openRoom(page, fixture);
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible({ timeout: 20_000 });

  // The classified closure drives a non-blocking indicator, never a page gate.
  await expect(page.getByTestId("room-transport-reconnecting")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("session-room-header")).toBeVisible();
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible();

  // Either the link comes back or the budget ends in a controlled degraded
  // state; both keep the Session usable and neither raises the overlay.
  await expect
    .poll(
      async () => {
        const reconnecting = await page.getByTestId("room-transport-reconnecting").count();
        const degraded = await page.getByTestId("room-transport-degraded").count();
        return reconnecting === 0 || degraded > 0;
      },
      { timeout: 45_000, message: "recovery must settle instead of spinning" },
    )
    .toBe(true);

  await expect(page.getByTestId("session-room-header")).toBeVisible();
  await expectNoDevErrorOverlay(page);
  expect(
    consoleWatcher.unexpected(),
    "a recoverable gateway close must not reach console.error",
  ).toEqual([]);
  consoleWatcher.stop();

  const lifecycle = await query<{ roomLifecycle: string; negotiationState: string }>(
    `SELECT "roomLifecycle", "negotiationState" FROM "Session" WHERE "id"=$1`,
    [fixture.sessionId],
  );
  expect(lifecycle[0]?.roomLifecycle, "transport loss must not close the Session").toBe(
    "DEBRIEF_OPEN",
  );
  expect(lifecycle[0]?.negotiationState).toBe("FINISHED");

  const recordings = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "Recording" WHERE "sessionId"=$1`,
    [fixture.sessionId],
  );
  expect(
    Number(recordings[0]?.count ?? "0"),
    "client transport recovery must not touch recording",
  ).toBe(0);

  expect(
    await activeConnectionCount(fixture.sessionId),
    "recovery must not create a second room connection",
  ).toBe(1);
});

test("a terminal provider authorization failure stays terminal and is not retried away", async ({
  page,
}) => {
  const fixture = await createExitFixture();
  await loginContext(page, fixture.participantUserId);
  await setProviderFault(page, "terminal-auth");
  const consoleWatcher = watchConsole(page);

  await page.goto(fixture.lobbyUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("event-lobby-page")).toBeVisible({ timeout: 20_000 });

  const errorPanel = page.getByTestId("event-lobby-voximplant-error");
  await expect(errorPanel).toBeVisible({ timeout: 30_000 });
  await expect(errorPanel).toContainText("provider_authorization_rejected");
  await expect(page.getByTestId("event-lobby-voximplant-retry")).toBeVisible();

  // A terminal verdict must not be reported as a recovering or connected link.
  await expect(page.getByTestId("event-lobby-video-connecting")).toHaveCount(0);
  await expectNoDevErrorOverlay(page);
  expect(consoleWatcher.unexpected()).toEqual([]);
  consoleWatcher.stop();
});
