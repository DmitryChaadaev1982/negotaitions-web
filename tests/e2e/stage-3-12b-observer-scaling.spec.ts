import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type ConsoleMessage,
  type Page,
  type Response,
} from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  e2eId,
  e2eName,
  expireRoomConnection,
  hashE2ePassword,
  query,
} from "./helpers/db";

const ARTIFACT_ROOT = path.join(
  process.cwd(),
  "artifacts",
  "stage-3-12b-observer-scaling",
);
const COOKIE_CONSENT_STORAGE_KEY = "negotaitions.cookieConsent.v1";

/**
 * Suite split (see `docs/testing/observer-test-execution-policy.md`):
 *
 * - `@observer-smoke` is the default observer regression suite. Small and
 *   moderate counts only, no full viewport matrix.
 * - `@observer-layout` is the full geometry regression matrix. Mandatory only
 *   when Session room structure, geometry or responsive breakpoints change.
 */
const OBSERVER_SMOKE_TAG = "@observer-smoke";
const OBSERVER_LAYOUT_TAG = "@observer-layout";

const desktopViewport = { width: 1440, height: 900 } as const;
/** Desktop counts whose participant-stage geometry must stay identical. */
const layoutObserverCounts = [0, 1, 4, 5, 8, 12, 30, 50, 100] as const;
/**
 * Measured at 1440x900: the rail fits up to 4 observers and starts to overflow
 * at 5. Both boundary counts are asserted explicitly so a tile/rail dimension
 * change cannot silently move the transition.
 */
const desktopLastFittingObserverCount = 4;

const controlledRoomErrorTestIds = [
  "room-entry-error-details",
  "room-explicit-leave-error",
  "vox-recording-relay-error",
  "room-leave-error",
] as const;

type ObserverPattern = "all-on" | "all-off" | "mixed";
type Lifecycle = "OPEN" | "RUNNING" | "DEBRIEF_OPEN";

type ObserverScalingSession = {
  sessionId: string;
  facilitatorUserId: string;
  facilitatorParticipantId: string;
  observerParticipantIds: string[];
  observerConnectionIds: string[];
  observerCookies: string[];
};

type BoxMetrics = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type LayoutMetrics = {
  scenarioId: string;
  viewport: string;
  observerCount: number;
  visibleObserverCount: number;
  pageScrollWidth: number;
  viewportWidth: number;
  railClientWidth: number;
  railScrollWidth: number;
  railScrollLeft: number;
  railBox: BoxMetrics | null;
  contentBox: BoxMetrics | null;
  observerZoneBox: BoxMetrics;
  observerZoneInnerTop: number;
  observerZoneInnerBottom: number;
  mainStageBox: BoxMetrics | null;
  rightSidebarBox: BoxMetrics | null;
  observerTileTops: number[];
  observerTileBoxes: BoxMetrics[];
  observerControlBoxes: BoxMetrics[];
  leftArrowVisible: boolean;
  rightArrowVisible: boolean;
};

const evidenceRecords: LayoutMetrics[] = [];
const scaleEvidenceRecords: LayoutMetrics[] = [];

/**
 * Fixture accounts here are always authenticated through a seeded
 * `UserSession` cookie, never through the password form, so one bcrypt hash is
 * reused across every seeded account. At 100 observers per room this removes
 * tens of seconds of pure hashing per test.
 */
let sharedFixturePasswordHash: string | null = null;

async function fixturePasswordHash() {
  sharedFixturePasswordHash ??= await hashE2ePassword();
  return sharedFixturePasswordHash;
}

function observerName(index: number, longNames: boolean, duplicateLookingNames: boolean) {
  if (duplicateLookingNames) {
    return index % 2 === 0
      ? "Observer Shared Legal Team"
      : "Observer Shared Legal Team.";
  }
  if (longNames) {
    return index % 3 === 0
      ? `Наблюдатель ${index + 1} с длинным названием организации`
      : `Observer ${index + 1} With Long Repeated Organization Name`;
  }
  return `Observer ${index + 1}`;
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
  await page.addInitScript((storageKey) => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        necessary: true,
        analytics: false,
        marketing: false,
        updatedAt: new Date().toISOString(),
      }),
    );
  }, COOKIE_CONSENT_STORAGE_KEY);
}

async function seedActiveRoomConnection(input: {
  sessionId: string;
  userId: string;
  role: "OBSERVER" | "PARTICIPANT" | "FACILITATOR";
  connectionId?: string;
}) {
  const connectionId = input.connectionId ?? e2eId("observer-scaling-connection");
  await query(
    `INSERT INTO "SessionRoomConnection"
       ("id", "sessionId", "userId", "connectionId", "leaseVersion", "role",
        "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 1, $5::"ParticipantType",
        NOW() + INTERVAL '30 minutes', NOW(), NOW())`,
    [
      e2eId("observer-scaling-src"),
      input.sessionId,
      input.userId,
      connectionId,
      input.role,
    ],
  );
  return connectionId;
}

async function createObserverScalingSession(input: {
  observerCount: number;
  lifecycle?: Lifecycle;
  cameraPattern?: ObserverPattern;
  micPattern?: ObserverPattern;
  preferredLocale?: "en" | "ru";
  longNames?: boolean;
  duplicateLookingNames?: boolean;
  includeUnassignedParticipantObserver?: boolean;
}): Promise<ObserverScalingSession> {
  const passwordHash = await fixturePasswordHash();
  const facilitator = await createActiveUser({
    preferredLocale: input.preferredLocale ?? "en",
    email: `${e2eId("observer-scaling-fac")}@test.invalid`,
    passwordHash,
  });
  await query(`UPDATE "User" SET "name" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
    facilitator.id,
    input.preferredLocale === "ru"
      ? "Фасилитатор проверки наблюдателей"
      : "Observer Scaling Facilitator",
  ]);

  const caseId = e2eId("observer-scaling-case");
  const sessionId = e2eId("observer-scaling-session");
  const roleAId = e2eId("observer-scaling-role-a");
  const roleBId = e2eId("observer-scaling-role-b");
  const lifecycle = input.lifecycle ?? "RUNNING";
  const negotiationState =
    lifecycle === "RUNNING"
      ? "RUNNING"
      : lifecycle === "DEBRIEF_OPEN"
        ? "FINISHED"
        : "PREPARATION";

  await query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, $2, 'Observer scaling case description',
        'Observer scaling business context', 'Observer scaling public instructions',
        'Observer scaling target skills', 'MEDIUM', $3,
        300, 900, $4, $4, 'PUBLIC', NOW())`,
    [
      caseId,
      e2eName(
        input.preferredLocale === "ru"
          ? "Кейс масштабирования наблюдателей"
          : "Observer Scaling Case",
      ),
      input.preferredLocale === "ru" ? "RU" : "EN",
      facilitator.id,
    ],
  );

  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "status", "negotiationState", "preparationDurationSeconds", "durationSeconds",
        "visibility", "roomLifecycle", "negotiationStartedAt", "negotiationEndedAt",
        "updatedAt")
     VALUES ($1, $2, $3, $4, $5,
        'Observer scaling snapshot business context',
        'Observer scaling snapshot public instructions', $6,
        'READY', $7::"NegotiationState", 300, 900, 'PUBLIC', $8::"RoomLifecycle",
        CASE WHEN $7 = 'RUNNING' THEN NOW() ELSE NULL END,
        CASE WHEN $7 = 'FINISHED' THEN NOW() ELSE NULL END,
        NOW())`,
    [
      sessionId,
      caseId,
      facilitator.id,
      e2eName(
        input.preferredLocale === "ru"
          ? "Сессия с масштабируемым списком наблюдателей"
          : "Session With Scalable Observer Roster",
      ),
      e2eName("Observer Scaling Snapshot Case"),
      input.preferredLocale === "ru" ? "RU" : "EN",
      negotiationState,
      lifecycle === "RUNNING" ? "OPEN" : lifecycle,
    ],
  );

  await query(
    `INSERT INTO "SessionRole"
       ("id", "sessionId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
     VALUES
       ($1, $3, 'Buyer', 'Buyer private', 'Buyer objective', 'Buyer constraints', 'Buyer hidden', 'Buyer fallback', 0, NOW()),
       ($2, $3, 'Seller', 'Seller private', 'Seller objective', 'Seller constraints', 'Seller hidden', 'Seller fallback', 1, NOW())`,
    [roleAId, roleBId, sessionId],
  );

  const facilitatorParticipantId = e2eId("observer-scaling-fac-sp");
  const participantAId = e2eId("observer-scaling-pa");
  const participantBId = e2eId("observer-scaling-pb");
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
        "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
     VALUES
       ($1, $4, $5, NULL, 'FACILITATOR', $6, 'Observer Scaling Facilitator', 'fac notes', NOW(), NOW(), NOW()),
       ($2, $4, NULL, $7, 'PARTICIPANT', $8, 'Participant A', 'a notes', NOW(), NOW(), NOW()),
       ($3, $4, NULL, $9, 'PARTICIPANT', $10, 'Participant B', 'b notes', NOW(), NOW(), NOW())`,
    [
      facilitatorParticipantId,
      participantAId,
      participantBId,
      sessionId,
      facilitator.id,
      `observer-scaling-fac-${e2eId("token")}`,
      roleAId,
      `observer-scaling-a-${e2eId("token")}`,
      roleBId,
      `observer-scaling-b-${e2eId("token")}`,
    ],
  );

  const observerParticipantIds: string[] = [];
  const observerConnectionIds: string[] = [];
  const observerCookies: string[] = [];
  for (let index = 0; index < input.observerCount; index += 1) {
    const participantId = e2eId("observer-scaling-observer");
    const observerUser = await createActiveUser({
      preferredLocale: input.preferredLocale ?? "en",
      email: `${e2eId("observer-scaling-observer-user")}@test.invalid`,
      passwordHash,
    });
    const displayName = observerName(
      index,
      input.longNames ?? false,
      input.duplicateLookingNames ?? false,
    );
    await query(`UPDATE "User" SET "name" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
      observerUser.id,
      displayName,
    ]);
    observerParticipantIds.push(participantId);
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, $3, NULL, 'OBSERVER', $4, $5, 'observer notes', NOW(), NOW(), NOW())`,
      [
        participantId,
        sessionId,
        observerUser.id,
        `observer-scaling-o-${e2eId("token")}`,
        displayName,
      ],
    );
    observerConnectionIds.push(
      await seedActiveRoomConnection({
        sessionId,
        userId: observerUser.id,
        role: "OBSERVER",
      }),
    );
    observerCookies.push(await createUserSessionCookie(observerUser.id));
  }

  if (input.includeUnassignedParticipantObserver) {
    const participantId = e2eId("observer-scaling-unassigned");
    const unassignedUser = await createActiveUser({
      preferredLocale: input.preferredLocale ?? "en",
      email: `${e2eId("observer-scaling-unassigned-user")}@test.invalid`,
      passwordHash,
    });
    await query(`UPDATE "User" SET "name" = 'Unassigned Participant Observer', "updatedAt" = NOW() WHERE "id" = $1`, [
      unassignedUser.id,
    ]);
    observerParticipantIds.push(participantId);
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, $3, NULL, 'PARTICIPANT', $4, 'Unassigned Participant Observer', 'unassigned notes', NOW(), NOW(), NOW())`,
      [
        participantId,
        sessionId,
        unassignedUser.id,
        `observer-scaling-u-${e2eId("token")}`,
      ],
    );
    observerConnectionIds.push(
      await seedActiveRoomConnection({
        sessionId,
        userId: unassignedUser.id,
        role: "PARTICIPANT",
      }),
    );
    observerCookies.push(await createUserSessionCookie(unassignedUser.id));
  }

  const mediaParticipants = [
    facilitatorParticipantId,
    participantAId,
    participantBId,
    ...observerParticipantIds,
  ];
  const mediaStatus = Object.fromEntries(
    mediaParticipants.map((participantId, index) => [
      participantId,
      {
        connectionId: `observer-scaling-${participantId}`,
        micEnabled:
          input.micPattern === "all-on"
            ? true
            : input.micPattern === "all-off"
              ? false
              : index % 2 === 0,
        cameraEnabled:
          input.cameraPattern === "all-on"
            ? true
            : input.cameraPattern === "all-off"
              ? false
              : index % 3 !== 0,
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
  await query(
    `INSERT INTO "AppSetting" ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()`,
    [
      `voximplant:session-media-status:${sessionId}`,
      JSON.stringify({ version: 1, participants: mediaStatus }),
    ],
  );

  if (lifecycle === "DEBRIEF_OPEN") {
    const recordingId = e2eId("observer-scaling-recording");
    await query(
      `INSERT INTO "Recording"
         ("id", "sessionId", "provider", "status", "recordingType", "fileName",
          "mimeType", "updatedAt", "endedAt")
       VALUES ($1, $2, 'E2E', 'PROCESSING', 'AUDIO_ONLY',
          'observer-scaling.mp4', 'audio/mp4', NOW(), NOW())`,
      [recordingId, sessionId],
    );
  }

  return {
    sessionId,
    facilitatorUserId: facilitator.id,
    facilitatorParticipantId,
    observerParticipantIds,
    observerConnectionIds,
    observerCookies,
  };
}

async function attachRoomOpenDiagnostics(input: {
  page: Page;
  scenarioId: string;
  response: Response | null;
  gotoMs: number;
  pageErrors: string[];
  consoleErrors: string[];
}) {
  const controlledErrors: Record<string, string[]> = {};
  for (const testId of controlledRoomErrorTestIds) {
    controlledErrors[testId] = await input.page
      .getByTestId(testId)
      .allTextContents()
      .catch(() => []);
  }
  await test.info().attach(`room-open-diagnostics-${input.scenarioId}`, {
    contentType: "application/json",
    body: JSON.stringify(
      {
        scenarioId: input.scenarioId,
        finalUrl: input.page.url(),
        responseStatus: input.response?.status() ?? null,
        responseOk: input.response?.ok() ?? null,
        gotoMs: input.gotoMs,
        controlledErrors,
        pageErrors: input.pageErrors,
        consoleErrors: input.consoleErrors,
      },
      null,
      2,
    ),
  });
}

async function openRoom(
  page: Page,
  session: ObserverScalingSession,
  scenarioId = session.sessionId,
) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const handlePageError = (error: Error) => pageErrors.push(error.message);
  const handleConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  };

  page.on("pageerror", handlePageError);
  page.on("console", handleConsole);
  let response: Response | null = null;
  const gotoStartedAt = Date.now();
  await page.context().clearCookies();
  await seedCookieConsent(page);
  await loginWithUserSession(page, session.facilitatorUserId);
  try {
    response = await page.goto(`/room/${session.sessionId}?media=off`, {
      waitUntil: "domcontentloaded",
    });
    const gotoMs = Date.now() - gotoStartedAt;
    expect(response, `room navigation returned no response for ${scenarioId}`).not.toBeNull();
    expect(
      response!.status(),
      `room navigation status for ${scenarioId} at ${page.url()}`,
    ).toBeLessThan(400);
    expect(page.url()).toContain(`/room/${session.sessionId}`);
    await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
    for (const testId of controlledRoomErrorTestIds) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
    await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("vox-zone-observers")).toBeVisible({ timeout: 25_000 });
    return { gotoMs };
  } catch (error) {
    await attachRoomOpenDiagnostics({
      page,
      scenarioId,
      response,
      gotoMs: Date.now() - gotoStartedAt,
      pageErrors,
      consoleErrors,
    });
    throw error;
  } finally {
    page.off("pageerror", handlePageError);
    page.off("console", handleConsole);
  }
}

async function appendObserverToSession(
  session: ObserverScalingSession,
  index: number,
) {
  const participantId = e2eId("observer-scaling-appended-observer");
  const observerUser = await createActiveUser({
    preferredLocale: "en",
    email: `${e2eId("observer-scaling-appended-user")}@test.invalid`,
    passwordHash: await fixturePasswordHash(),
  });
  const displayName = observerName(index, false, false);
  await query(`UPDATE "User" SET "name" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
    observerUser.id,
    displayName,
  ]);
  session.observerParticipantIds.push(participantId);
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
        "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
     VALUES ($1, $2, $3, NULL, 'OBSERVER', $4, $5, 'observer notes', NOW(), NOW(), NOW())`,
    [
      participantId,
      session.sessionId,
      observerUser.id,
      `observer-scaling-appended-${e2eId("token")}`,
      displayName,
    ],
  );
  session.observerConnectionIds.push(
    await seedActiveRoomConnection({
      sessionId: session.sessionId,
      userId: observerUser.id,
      role: "OBSERVER",
    }),
  );
  session.observerCookies.push(await createUserSessionCookie(observerUser.id));
  return participantId;
}

async function postObserverExplicitLeave(
  request: APIRequestContext,
  session: ObserverScalingSession,
  observerIndex: number,
) {
  const leave = await request.post(
    `/api/sessions/${session.sessionId}/presence/leave`,
    {
      headers: { Cookie: `auth_session=${session.observerCookies[observerIndex]}` },
      data: {
        participantId: session.observerParticipantIds[observerIndex],
        connectionId: session.observerConnectionIds[observerIndex],
      },
    },
  );
  expect(leave.ok()).toBeTruthy();
  const body = (await leave.json()) as {
    disconnected?: boolean;
    finalState?: string;
  };
  expect(body.disconnected).toBe(true);
  expect(body.finalState).toBe("DISCONNECTED");
}

async function roomConnectionState(connectionId: string) {
  return (
    await query<{
      userId: string;
      connectionId: string;
      expiresAt: string;
      disconnectedAt: string | null;
      disconnectedReason: string | null;
      supersededAt: string | null;
      revokedAt: string | null;
    }>(
      `SELECT "userId", "connectionId", "expiresAt", "disconnectedAt", "disconnectedReason",
              "supersededAt", "revokedAt"
       FROM "SessionRoomConnection"
       WHERE "connectionId" = $1`,
      [connectionId],
    )
  )[0]!;
}

async function collectLayoutMetrics(
  page: Page,
  scenarioId: string,
  observerCount: number,
): Promise<LayoutMetrics> {
  return page.evaluate(
    ({ scenarioId, observerCount }) => {
      const toBox = (element: Element | null) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      };
      const isVisible = (element: Element | null) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      };
      const observerZone = document.querySelector('[data-testid="vox-zone-observers"]');
      const rail = document.querySelector('[data-testid="vox-observer-row"]') as HTMLElement | null;
      const content = document.querySelector('[data-testid="vox-observer-content"]');
      const tiles = Array.from(document.querySelectorAll('[data-testid="vox-observer-tile"]'));
      const controls = Array.from(
        observerZone?.querySelectorAll(
          '[data-testid="participant-tile-mic-status-icon"], [data-testid="participant-tile-camera-status-icon"]',
        ) ?? [],
      );
      const mainStage = document.querySelector('[data-testid="vox-zone-main-desktop"]');
      const rightSidebar = document.querySelector(".hidden.h-full.min-h-0.w-\\[28rem\\]");
      const leftArrow = document.querySelector('[data-testid="vox-observer-scroll-left"]');
      const rightArrow = document.querySelector('[data-testid="vox-observer-scroll-right"]');
      const observerZoneBox = toBox(observerZone);
      if (!observerZoneBox) {
        throw new Error("Missing observer zone box");
      }
      const zoneStyle = window.getComputedStyle(observerZone);
      const observerZoneInnerTop =
        observerZoneBox.top +
        Number.parseFloat(zoneStyle.borderTopWidth || "0") +
        Number.parseFloat(zoneStyle.paddingTop || "0");
      const observerZoneInnerBottom =
        observerZoneBox.bottom -
        Number.parseFloat(zoneStyle.borderBottomWidth || "0") -
        Number.parseFloat(zoneStyle.paddingBottom || "0");
      return {
        scenarioId,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        observerCount,
        visibleObserverCount: tiles.filter((tile) => {
          const rect = tile.getBoundingClientRect();
          return rect.right > 0 && rect.left < window.innerWidth;
        }).length,
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        railClientWidth: rail?.clientWidth ?? 0,
        railScrollWidth: rail?.scrollWidth ?? 0,
        railScrollLeft: rail?.scrollLeft ?? 0,
        railBox: toBox(rail),
        contentBox: toBox(content),
        observerZoneBox,
        observerZoneInnerTop,
        observerZoneInnerBottom,
        mainStageBox: toBox(mainStage),
        rightSidebarBox: toBox(rightSidebar),
        observerTileTops: tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)),
        observerTileBoxes: tiles.map((tile) => toBox(tile)!),
        observerControlBoxes: controls.map((control) => toBox(control)!),
        leftArrowVisible: isVisible(leftArrow),
        rightArrowVisible: isVisible(rightArrow),
      };
    },
    { scenarioId, observerCount },
  );
}

async function captureEvidence(
  page: Page,
  scenarioId: string,
  observerCount: number,
): Promise<LayoutMetrics> {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const screenshotDir = path.join(ARTIFACT_ROOT, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, `${scenarioId}__viewport.png`),
    fullPage: false,
  });
  const observerZone = page.getByTestId("vox-zone-observers");
  await observerZone.screenshot({
    path: path.join(screenshotDir, `${scenarioId}__observer-rail.png`),
  });
  const metrics = await collectLayoutMetrics(page, scenarioId, observerCount);
  evidenceRecords.push(metrics);
  return metrics;
}

function assertObserverRailMetrics(metrics: LayoutMetrics, expectedObserverCount: number) {
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
  expect(metrics.observerZoneBox.height).toBeLessThanOrEqual(190);
  expect(metrics.observerCount).toBe(expectedObserverCount);
  if (expectedObserverCount > 0) {
    expect(metrics.railScrollWidth).toBeGreaterThan(0);
    const uniqueTopCount = new Set(metrics.observerTileTops).size;
    expect(uniqueTopCount).toBeLessThanOrEqual(1);
    assertObserverTilesInsideRail(metrics);
  }
}

function assertObserverTilesInsideRail(metrics: LayoutMetrics) {
  for (const tileBox of metrics.observerTileBoxes) {
    expect(tileBox.top).toBeGreaterThanOrEqual(metrics.observerZoneInnerTop - 1);
    expect(tileBox.bottom).toBeLessThanOrEqual(metrics.observerZoneInnerBottom - 4);
  }
  for (const controlBox of metrics.observerControlBoxes) {
    expect(controlBox.bottom).toBeLessThanOrEqual(metrics.observerZoneInnerBottom - 4);
  }
  if (metrics.mainStageBox && metrics.mainStageBox.height > 0) {
    expect(metrics.observerZoneBox.bottom).toBeLessThanOrEqual(metrics.mainStageBox.top + 1);
  }
}

function assertStableObserverOrder(
  actualIds: string[],
  expectedIds: string[],
) {
  expect(actualIds).toEqual(expectedIds.slice(0, actualIds.length));
}

async function observerTileIds(page: Page) {
  return page
    .getByTestId("vox-observer-tile")
    .evaluateAll((tiles) =>
      tiles.map((tile) => (tile as HTMLElement).dataset.observerId ?? ""),
    );
}

async function waitForRailOverflow(page: Page, expected: boolean) {
  await expect
    .poll(async () => {
      const metrics = await collectLayoutMetrics(page, "poll", 0);
      return metrics.contentBox !== null &&
        metrics.railBox !== null &&
        metrics.contentBox.width > metrics.railBox.width + 2;
    })
    .toBe(expected);
}

function assertCenteredWhileFitting(metrics: LayoutMetrics) {
  expect(metrics.railBox).not.toBeNull();
  expect(metrics.contentBox).not.toBeNull();
  expect(metrics.observerTileBoxes.length).toBeGreaterThan(0);
  const firstTile = metrics.observerTileBoxes[0];
  const lastTile = metrics.observerTileBoxes[metrics.observerTileBoxes.length - 1];
  const groupCenter = (firstTile.left + lastTile.right) / 2;
  const viewportCenter = (metrics.railBox!.left + metrics.railBox!.right) / 2;
  expect(Math.abs(groupCenter - viewportCenter)).toBeLessThanOrEqual(2);
  expect(metrics.contentBox!.width).toBeLessThanOrEqual(metrics.railBox!.width + 2);
  expect(metrics.railScrollWidth).toBeLessThanOrEqual(metrics.railClientWidth + 2);
  expect(metrics.leftArrowVisible).toBe(false);
  expect(metrics.rightArrowVisible).toBe(false);
}

function assertStartAlignedOverflow(metrics: LayoutMetrics) {
  expect(metrics.railBox).not.toBeNull();
  expect(metrics.contentBox).not.toBeNull();
  expect(metrics.observerTileBoxes.length).toBeGreaterThan(0);
  expect(metrics.contentBox!.width).toBeGreaterThan(metrics.railBox!.width + 2);
  expect(metrics.railScrollLeft).toBeLessThanOrEqual(2);
  expect(Math.abs(metrics.observerTileBoxes[0].left - metrics.railBox!.left)).toBeLessThanOrEqual(2);
  expect(metrics.observerTileBoxes[0].right).toBeGreaterThan(metrics.railBox!.left);
  expect(metrics.leftArrowVisible).toBe(false);
  expect(metrics.rightArrowVisible).toBe(true);
  for (let index = 1; index < metrics.observerTileBoxes.length; index += 1) {
    expect(metrics.observerTileBoxes[index].left).toBeGreaterThan(
      metrics.observerTileBoxes[index - 1].left,
    );
  }
}

/**
 * Append-right ordering plus first-observer visibility. Both hold at every
 * viewport and observer count, with or without rail overflow.
 */
function assertAppendRightOrderAndFirstObserverVisible(metrics: LayoutMetrics) {
  if (metrics.observerTileBoxes.length === 0) {
    return;
  }
  expect(metrics.railBox).not.toBeNull();
  const firstTile = metrics.observerTileBoxes[0];
  expect(firstTile.right).toBeGreaterThan(metrics.railBox!.left);
  expect(firstTile.left).toBeLessThan(metrics.railBox!.right);
  for (let index = 1; index < metrics.observerTileBoxes.length; index += 1) {
    expect(metrics.observerTileBoxes[index].left).toBeGreaterThan(
      metrics.observerTileBoxes[index - 1].left,
    );
  }
}

/**
 * Applies the fit/overflow contract that actually matches the measured rail,
 * instead of hard-coding which observer count is expected to overflow.
 */
function assertMeasuredFitOrOverflowContract(metrics: LayoutMetrics) {
  if (metrics.observerTileBoxes.length === 0) {
    expect(metrics.leftArrowVisible).toBe(false);
    expect(metrics.rightArrowVisible).toBe(false);
    return "empty" as const;
  }
  expect(metrics.railBox).not.toBeNull();
  expect(metrics.contentBox).not.toBeNull();
  if (metrics.contentBox!.width > metrics.railBox!.width + 2) {
    assertStartAlignedOverflow(metrics);
    return "overflow" as const;
  }
  assertCenteredWhileFitting(metrics);
  return "fit" as const;
}

/**
 * Start / middle / end scroll behaviour with conditional arrows. Shared so the
 * smoke suite can check one representative overflow size and the layout suite
 * can check the high-count case without duplicating the sequence.
 */
async function assertConditionalArrowScrollSequence(
  page: Page,
  input: {
    observerCount: number;
    scenarioPrefix: string;
    withEvidence: boolean;
    withKeyboardAccessibility: boolean;
  },
) {
  const { observerCount, scenarioPrefix } = input;
  const record = (scenarioId: string) =>
    input.withEvidence
      ? captureEvidence(page, scenarioId, observerCount)
      : collectLayoutMetrics(page, scenarioId, observerCount);
  const rail = page.getByTestId("vox-observer-row");

  await waitForRailOverflow(page, true);

  // Arrow visibility is React state driven by scroll events, so every metrics
  // snapshot below is taken only after the retrying locator assertions for that
  // scroll position have settled.
  await expect(page.getByTestId("vox-observer-scroll-left")).toHaveCount(0);
  await expect(page.getByTestId("vox-observer-scroll-right")).toBeVisible();
  const startMetrics = await record(`${scenarioPrefix}-start`);
  assertStartAlignedOverflow(startMetrics);

  const pageScrollBefore = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));
  await page.getByTestId("vox-observer-scroll-right").click();
  await expect
    .poll(() => rail.evaluate((node) => (node as HTMLElement).scrollLeft))
    .toBeGreaterThan(0);
  const pageScrollAfter = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));
  expect(pageScrollAfter).toEqual(pageScrollBefore);
  await expect(page.getByTestId("vox-observer-scroll-left")).toBeVisible();
  await expect(page.getByTestId("vox-observer-scroll-right")).toBeVisible();

  const middleMetrics = await record(`${scenarioPrefix}-middle`);
  expect(middleMetrics.leftArrowVisible).toBe(true);
  expect(middleMetrics.rightArrowVisible).toBe(true);

  await rail.evaluate((node) => {
    const element = node as HTMLElement;
    element.scrollTo({ left: element.scrollWidth, behavior: "auto" });
  });
  await expect
    .poll(() =>
      rail.evaluate((node) => {
        const element = node as HTMLElement;
        return element.scrollWidth - element.clientWidth - element.scrollLeft;
      }),
    )
    .toBeLessThanOrEqual(2);
  await expect(page.getByTestId("vox-observer-scroll-left")).toBeVisible();
  await expect(page.getByTestId("vox-observer-scroll-right")).toHaveCount(0);
  const endMetrics = await record(`${scenarioPrefix}-end`);
  expect(endMetrics.leftArrowVisible).toBe(true);
  expect(endMetrics.rightArrowVisible).toBe(false);
  expect(endMetrics.observerTileBoxes[observerCount - 1].right).toBeLessThanOrEqual(
    endMetrics.railBox!.right + 2,
  );

  await rail.evaluate((node) => {
    (node as HTMLElement).scrollTo({ left: 0, behavior: "auto" });
  });
  await expect
    .poll(() => rail.evaluate((node) => (node as HTMLElement).scrollLeft))
    .toBeLessThanOrEqual(2);
  await expect(page.getByTestId("vox-observer-scroll-left")).toHaveCount(0);
  await expect(page.getByTestId("vox-observer-scroll-right")).toBeVisible();
  assertStartAlignedOverflow(
    await collectLayoutMetrics(page, `${scenarioPrefix}-returned`, observerCount),
  );

  if (!input.withKeyboardAccessibility) {
    return;
  }
  await rail.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => rail.evaluate((node) => (node as HTMLElement).scrollLeft))
    .toBeGreaterThan(0);
  await page.getByTestId("vox-observer-tile").last().focus();
  await expect(page.getByTestId("vox-observer-tile").last()).toBeFocused();
}

/** Camera-off observers must keep their tile and must not read as camera-on. */
async function assertObserversRenderedWithCameraOff(page: Page, expectedCount: number) {
  const cameraBadges = page
    .getByTestId("vox-zone-observers")
    .getByTestId("participant-tile-camera-status-icon");
  await expect(cameraBadges).toHaveCount(expectedCount);
  const statuses = await cameraBadges.evaluateAll((badges) =>
    badges.map((badge) => (badge as HTMLElement).dataset.status ?? ""),
  );
  expect(statuses).toHaveLength(expectedCount);
  expect(statuses.filter((status) => status === "on")).toEqual([]);
}

function assertStableStageAcrossScale(records: LayoutMetrics[]) {
  const recordsByCount = new Map(records.map((record) => [record.observerCount, record]));
  if (!layoutObserverCounts.every((count) => recordsByCount.has(count))) {
    return;
  }

  const stageBoxes = layoutObserverCounts
    .map((count) => recordsByCount.get(count)!.mainStageBox)
    .filter((box): box is BoxMetrics => box !== null);
  expect(stageBoxes.length).toBe(layoutObserverCounts.length);
  const widths = stageBoxes.map((box) => box.width);
  const heights = stageBoxes.map((box) => box.height);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);

  const zeroObserverHeight = recordsByCount.get(0)!.observerZoneBox.height;
  const oneObserverHeight = recordsByCount.get(1)!.observerZoneBox.height;
  expect(Math.abs(oneObserverHeight - zeroObserverHeight)).toBeLessThanOrEqual(2);
}

test.beforeAll(async () => {
  await cleanupE2eData();
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
});

test.afterEach(async ({ page }) => {
  await page.close();
  await cleanupE2eData();
});

test.afterAll(async () => {
  try {
    writeFileSync(
      path.join(ARTIFACT_ROOT, "manifest.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: "Screenshots are local artifacts and are not intended for git.",
          records: evidenceRecords,
        },
        null,
        2,
      ),
    );
    assertStableStageAcrossScale(scaleEvidenceRecords);
  } finally {
    await cleanupE2eData();
  }
});

test("observer rail removes inactive observers while facilitator roster keeps them", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page, request }) => {
  const session = await createObserverScalingSession({
    observerCount: 3,
    lifecycle: "OPEN",
    cameraPattern: "all-off",
    micPattern: "mixed",
  });

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session);
  await expect(page.getByTestId("session-role-management-panel")).toBeVisible();
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(3);
  await assertObserversRenderedWithCameraOff(page, 3);
  expect(await observerTileIds(page)).toEqual(session.observerParticipantIds);
  for (const participantId of session.observerParticipantIds) {
    await expect(page.getByTestId(`role-row-${participantId}`)).toBeVisible();
  }

  const initialMetrics = await captureEvidence(page, "presence-open-initial", 3);
  expect(initialMetrics.observerCount).toBe(3);

  await postObserverExplicitLeave(request, session, 1);
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(2, {
    timeout: 5_000,
  });
  expect(await observerTileIds(page)).toEqual([
    session.observerParticipantIds[0],
    session.observerParticipantIds[2],
  ]);
  await expect(page.getByTestId(`role-row-${session.observerParticipantIds[1]}`)).toBeVisible();
  const leftState = await roomConnectionState(session.observerConnectionIds[1]);
  expect(leftState.disconnectedReason).toBe("EXPLICIT_LEAVE");
  expect(leftState.disconnectedAt).not.toBeNull();

  const afterLeaveMetrics = await captureEvidence(page, "presence-open-after-explicit-leave", 2);
  expect(afterLeaveMetrics.observerCount).toBe(2);

  await expireRoomConnection(session.observerConnectionIds[0]);
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(1, {
    timeout: 5_000,
  });
  expect(await observerTileIds(page)).toEqual([session.observerParticipantIds[2]]);
  await expect(page.getByTestId(`role-row-${session.observerParticipantIds[0]}`)).toBeVisible();
  const expiredState = await roomConnectionState(session.observerConnectionIds[0]);
  expect(new Date(expiredState.expiresAt).getTime()).toBeLessThan(Date.now());

  const afterExpiryMetrics = await captureEvidence(page, "presence-open-after-lease-expiry", 1);
  expect(afterExpiryMetrics.observerCount).toBe(1);
});

test("observer reconnect before expiry keeps one stable rail tile", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 3,
    lifecycle: "OPEN",
    cameraPattern: "mixed",
    micPattern: "mixed",
  });

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session);
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(3);
  const initialIds = await observerTileIds(page);
  expect(initialIds).toEqual(session.observerParticipantIds);

  const oldConnectionId = session.observerConnectionIds[1];
  const oldConnection = await roomConnectionState(oldConnectionId);
  const replacementConnectionId = e2eId("observer-scaling-reconnect");
  await query(
    `UPDATE "SessionRoomConnection"
     SET "supersededAt" = NOW(),
         "supersededByConnectionId" = $2,
         "updatedAt" = NOW()
     WHERE "connectionId" = $1`,
    [oldConnectionId, replacementConnectionId],
  );
  await seedActiveRoomConnection({
    sessionId: session.sessionId,
    userId: oldConnection.userId,
    role: "OBSERVER",
    connectionId: replacementConnectionId,
  });
  session.observerConnectionIds[1] = replacementConnectionId;

  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(3, {
    timeout: 5_000,
  });
  expect(await observerTileIds(page)).toEqual(initialIds);
  expect(new Set(await observerTileIds(page)).size).toBe(3);
});

test("observer rail applies active membership during debrief", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 3,
    lifecycle: "DEBRIEF_OPEN",
    cameraPattern: "all-off",
    micPattern: "all-off",
  });
  await expireRoomConnection(session.observerConnectionIds[1]);

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session);
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible();
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(2);
  await assertObserversRenderedWithCameraOff(page, 2);
  expect(await observerTileIds(page)).toEqual([
    session.observerParticipantIds[0],
    session.observerParticipantIds[2],
  ]);

  const metrics = await captureEvidence(page, "presence-debrief-after-lease-expiry", 2);
  assertObserverRailMetrics(metrics, 2);
});

type LayoutCase = {
  viewport: { width: number; height: number };
  observerCount: number;
  /**
   * Desktop reference samples whose participant-stage geometry is compared
   * across the whole count range in `afterAll`.
   */
  desktopScaleSample?: boolean;
};

/**
 * One Playwright test per viewport/count sample. Each case owns its fixture,
 * room, timeout, trace and cleanup, so a single viewport failure never hides
 * the remaining samples and no test walks the whole matrix sequentially.
 */
const layoutCases: LayoutCase[] = [
  ...layoutObserverCounts.map((observerCount) => ({
    viewport: desktopViewport,
    observerCount,
    desktopScaleSample: true,
  })),
  { viewport: { width: 1366, height: 768 }, observerCount: 4 },
  { viewport: { width: 1366, height: 768 }, observerCount: 12 },
  { viewport: { width: 1366, height: 768 }, observerCount: 30 },
  { viewport: { width: 1280, height: 720 }, observerCount: 4 },
  { viewport: { width: 1280, height: 720 }, observerCount: 12 },
  { viewport: { width: 1280, height: 720 }, observerCount: 30 },
  { viewport: { width: 1024, height: 768 }, observerCount: 4 },
  { viewport: { width: 1024, height: 768 }, observerCount: 12 },
  { viewport: { width: 768, height: 1024 }, observerCount: 4 },
  { viewport: { width: 768, height: 1024 }, observerCount: 12 },
  { viewport: { width: 768, height: 1024 }, observerCount: 30 },
  { viewport: { width: 390, height: 844 }, observerCount: 1 },
  { viewport: { width: 390, height: 844 }, observerCount: 4 },
  { viewport: { width: 390, height: 844 }, observerCount: 12 },
];

for (const layoutCase of layoutCases) {
  const { width, height } = layoutCase.viewport;
  const { observerCount } = layoutCase;
  const scenarioId = `viewport-${width}x${height}-${observerCount}`;

  test(`observer rail layout at ${width}x${height} with ${observerCount} observers`, {
    tag: [OBSERVER_LAYOUT_TAG],
  }, async ({ page }) => {
    const session = await test.step(`create ${observerCount} observer fixture`, () =>
      createObserverScalingSession({
        observerCount,
        lifecycle: "RUNNING",
        cameraPattern: observerCount === 0 || observerCount >= 30 ? "all-off" : "mixed",
        micPattern: observerCount % 3 === 0 ? "all-off" : "mixed",
        longNames: observerCount >= 12,
        duplicateLookingNames: layoutCase.desktopScaleSample === true && observerCount === 12,
        preferredLocale: width <= 768 ? "ru" : "en",
      }));

    await page.setViewportSize({ width, height });
    await test.step(`open ${scenarioId}`, () => openRoom(page, session, scenarioId));
    await expect(page.getByTestId("vox-observer-tile")).toHaveCount(observerCount);

    const expectDesktopOverflow =
      layoutCase.desktopScaleSample === true &&
      observerCount > desktopLastFittingObserverCount;

    if (layoutCase.desktopScaleSample) {
      await expect(page.getByTestId("vox-zone-participant-a")).toBeVisible();
      await expect(page.getByTestId("vox-zone-participant-b")).toBeVisible();
      await expect(page.getByTestId("vox-zone-facilitator")).toBeVisible();

      // Settle the scroll-affordance state before snapshotting geometry, so a
      // measured arrow value can never race the React re-render.
      if (observerCount > 0) {
        await waitForRailOverflow(page, expectDesktopOverflow);
        await expect(page.getByTestId("vox-observer-scroll-left")).toHaveCount(0);
        if (expectDesktopOverflow) {
          await expect(page.getByTestId("vox-observer-scroll-right")).toBeVisible();
        } else {
          await expect(page.getByTestId("vox-observer-scroll-right")).toHaveCount(0);
        }
      }
    }

    const metrics = await captureEvidence(page, scenarioId, observerCount);
    assertObserverRailMetrics(metrics, observerCount);
    assertAppendRightOrderAndFirstObserverVisible(metrics);
    assertStableObserverOrder(await observerTileIds(page), session.observerParticipantIds);

    if (layoutCase.desktopScaleSample) {
      scaleEvidenceRecords.push(metrics);
      const fitState = assertMeasuredFitOrOverflowContract(metrics);
      if (observerCount > 0) {
        expect(fitState).toBe(expectDesktopOverflow ? "overflow" : "fit");
      }
    }
  });
}

test("observer rail exposes conditional arrows during manual scrolling", {
  tag: [OBSERVER_LAYOUT_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 30,
    lifecycle: "RUNNING",
    cameraPattern: "mixed",
    micPattern: "mixed",
    longNames: true,
  });

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session);
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(30);

  await assertConditionalArrowScrollSequence(page, {
    observerCount: 30,
    scenarioPrefix: "desktop-1440x900-30",
    withEvidence: true,
    withKeyboardAccessibility: true,
  });
});

test("observer rail exposes conditional arrows at a moderate overflow size", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 12,
    lifecycle: "RUNNING",
    cameraPattern: "mixed",
    micPattern: "mixed",
    longNames: true,
    duplicateLookingNames: true,
  });

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session, "smoke-desktop-1440x900-12");
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(12);
  assertStableObserverOrder(await observerTileIds(page), session.observerParticipantIds);

  await assertConditionalArrowScrollSequence(page, {
    observerCount: 12,
    scenarioPrefix: "smoke-desktop-1440x900-12",
    withEvidence: false,
    withKeyboardAccessibility: false,
  });

  assertObserverRailMetrics(
    await collectLayoutMetrics(page, "smoke-desktop-1440x900-12-final", 12),
    12,
  );
});

test("observer rail grows from empty to first overflow with stable append-right order", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 0,
    lifecycle: "RUNNING",
    cameraPattern: "all-off",
    micPattern: "all-off",
  });

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session, "smoke-append-0");
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(0);
  await expect(page.getByTestId("vox-zone-participant-a")).toBeVisible();
  await expect(page.getByTestId("vox-zone-participant-b")).toBeVisible();
  await expect(page.getByTestId("vox-zone-facilitator")).toBeVisible();

  const emptyMetrics = await collectLayoutMetrics(page, "smoke-append-0", 0);
  assertObserverRailMetrics(emptyMetrics, 0);
  expect(assertMeasuredFitOrOverflowContract(emptyMetrics)).toBe("empty");
  const emptyRailHeight = emptyMetrics.observerZoneBox.height;

  // The roster polls every second, so observers can join the open room instead
  // of forcing one navigation per count.
  for (let count = 1; count <= desktopLastFittingObserverCount + 1; count += 1) {
    const shouldOverflow = count > desktopLastFittingObserverCount;
    await appendObserverToSession(session, count - 1);
    await expect(page.getByTestId("vox-observer-tile")).toHaveCount(count, {
      timeout: 10_000,
    });

    await waitForRailOverflow(page, shouldOverflow);
    await expect(page.getByTestId("vox-observer-scroll-left")).toHaveCount(0);
    if (shouldOverflow) {
      await expect(page.getByTestId("vox-observer-scroll-right")).toBeVisible();
    } else {
      await expect(page.getByTestId("vox-observer-scroll-right")).toHaveCount(0);
    }

    const metrics = await collectLayoutMetrics(page, `smoke-append-${count}`, count);
    assertObserverRailMetrics(metrics, count);
    assertAppendRightOrderAndFirstObserverVisible(metrics);
    expect(assertMeasuredFitOrOverflowContract(metrics)).toBe(
      shouldOverflow ? "overflow" : "fit",
    );
    if (shouldOverflow) {
      expect(metrics.railScrollLeft).toBeLessThanOrEqual(2);
    }

    const observerIds = await observerTileIds(page);
    expect(new Set(observerIds).size).toBe(observerIds.length);
    assertStableObserverOrder(observerIds, session.observerParticipantIds);

    if (count === 1) {
      expect(Math.abs(metrics.observerZoneBox.height - emptyRailHeight)).toBeLessThanOrEqual(2);
    }
  }
});

test("observer rail stays bounded on a narrow mobile viewport", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 4,
    lifecycle: "RUNNING",
    cameraPattern: "mixed",
    micPattern: "mixed",
    preferredLocale: "ru",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await openRoom(page, session, "smoke-mobile-390x844-4");
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(4);

  const metrics = await collectLayoutMetrics(page, "smoke-mobile-390x844-4", 4);
  assertObserverRailMetrics(metrics, 4);
  assertAppendRightOrderAndFirstObserverVisible(metrics);
  assertStableObserverOrder(await observerTileIds(page), session.observerParticipantIds);
});

test("unassigned participant remains in observer rail during debrief", {
  tag: [OBSERVER_SMOKE_TAG],
}, async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 4,
    lifecycle: "DEBRIEF_OPEN",
    cameraPattern: "all-off",
    micPattern: "all-off",
    includeUnassignedParticipantObserver: true,
  });

  await page.setViewportSize(desktopViewport);
  await openRoom(page, session);
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible();
  await expect(page.getByTestId("vox-observer-tile")).toHaveCount(5);
  await expect(page.getByText("Unassigned Participant Observer")).toBeVisible();
  await expect(page.getByTestId("vox-zone-participant-a")).toBeVisible();
  await expect(page.getByTestId("vox-zone-participant-b")).toBeVisible();

  const observerIds = await page
    .getByTestId("vox-observer-tile")
    .evaluateAll((tiles) =>
      tiles.map((tile) => (tile as HTMLElement).dataset.observerId ?? ""),
    );
  expect(new Set(observerIds).size).toBe(observerIds.length);

  const metrics = await captureEvidence(page, "debrief-open-unassigned-observer", 5);
  assertObserverRailMetrics(metrics, 5);
});
