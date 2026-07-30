import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  e2eId,
  e2eName,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

const ARTIFACT_ROOT = path.join(
  process.cwd(),
  "artifacts",
  "stage-3-12b-observer-scaling",
);

type ObserverPattern = "all-on" | "all-off" | "mixed";
type Lifecycle = "OPEN" | "RUNNING" | "DEBRIEF_OPEN";

type ObserverScalingSession = {
  sessionId: string;
  facilitatorUserId: string;
  facilitatorParticipantId: string;
  observerParticipantIds: string[];
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
  observerZoneBox: { x: number; y: number; width: number; height: number };
  mainStageBox: { x: number; y: number; width: number; height: number } | null;
  rightSidebarBox: { x: number; y: number; width: number; height: number } | null;
  observerTileTops: number[];
};

const evidenceRecords: LayoutMetrics[] = [];

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
  const facilitator = await createActiveUser({
    preferredLocale: input.preferredLocale ?? "en",
    email: `${e2eId("observer-scaling-fac")}@test.invalid`,
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
  for (let index = 0; index < input.observerCount; index += 1) {
    const participantId = e2eId("observer-scaling-observer");
    observerParticipantIds.push(participantId);
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, NULL, NULL, 'OBSERVER', $3, $4, 'observer notes', NOW(), NOW(), NOW())`,
      [
        participantId,
        sessionId,
        `observer-scaling-o-${e2eId("token")}`,
        observerName(
          index,
          input.longNames ?? false,
          input.duplicateLookingNames ?? false,
        ),
      ],
    );
  }

  if (input.includeUnassignedParticipantObserver) {
    const participantId = e2eId("observer-scaling-unassigned");
    observerParticipantIds.push(participantId);
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, NULL, NULL, 'PARTICIPANT', $3, 'Unassigned Participant Observer', 'unassigned notes', NOW(), NOW(), NOW())`,
      [participantId, sessionId, `observer-scaling-u-${e2eId("token")}`],
    );
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
  };
}

async function openRoom(page: Page, session: ObserverScalingSession) {
  await page.context().clearCookies();
  await seedCookieConsent(page);
  await loginWithUserSession(page, session.facilitatorUserId);
  await page.goto(`/room/${session.sessionId}?media=off`);
  await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("vox-zone-observers")).toBeVisible({ timeout: 25_000 });
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
        };
      };
      const observerZone = document.querySelector('[data-testid="vox-zone-observers"]');
      const rail = document.querySelector('[data-testid="vox-observer-row"]') as HTMLElement | null;
      const tiles = Array.from(document.querySelectorAll('[data-testid="vox-observer-tile"]'));
      const mainStage = document.querySelector('[data-testid="vox-zone-main-desktop"]');
      const rightSidebar = document.querySelector(".hidden.h-full.min-h-0.w-\\[28rem\\]");
      const observerZoneBox = toBox(observerZone);
      if (!observerZoneBox) {
        throw new Error("Missing observer zone box");
      }
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
        observerZoneBox,
        mainStageBox: toBox(mainStage),
        rightSidebarBox: toBox(rightSidebar),
        observerTileTops: tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)),
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
  expect(metrics.observerZoneBox.height).toBeLessThanOrEqual(150);
  expect(metrics.observerCount).toBe(expectedObserverCount);
  if (expectedObserverCount > 0) {
    expect(metrics.railScrollWidth).toBeGreaterThan(0);
    const uniqueTopCount = new Set(metrics.observerTileTops).size;
    expect(uniqueTopCount).toBeLessThanOrEqual(1);
  }
  if (expectedObserverCount >= 8) {
    expect(metrics.railScrollWidth).toBeGreaterThan(metrics.railClientWidth);
  }
}

test.beforeAll(async () => {
  await cleanupE2eData();
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
});

test.afterAll(async () => {
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
  await cleanupE2eData();
});

test("observer rail scales deterministic roster counts without stage shrink", async ({ page }) => {
  const counts = [0, 1, 4, 8, 12, 30, 50, 100];
  const sessions = new Map<number, ObserverScalingSession>();
  for (const count of counts) {
    sessions.set(
      count,
      await createObserverScalingSession({
        observerCount: count,
        lifecycle: "RUNNING",
        cameraPattern: count === 0 ? "all-off" : count % 2 === 0 ? "mixed" : "all-on",
        micPattern: count % 3 === 0 ? "all-off" : "mixed",
        longNames: count >= 12,
        duplicateLookingNames: count === 12,
      }),
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const stageBoxes: LayoutMetrics["mainStageBox"][] = [];
  let zeroObserverHeight = 0;
  let oneObserverHeight = 0;

  for (const count of counts) {
    const session = sessions.get(count)!;
    await openRoom(page, session);
    await expect(page.getByTestId("vox-observer-tile")).toHaveCount(count);
    await expect(page.getByTestId("vox-zone-participant-a")).toBeVisible();
    await expect(page.getByTestId("vox-zone-participant-b")).toBeVisible();
    await expect(page.getByTestId("vox-zone-facilitator")).toBeVisible();

    const metrics = await captureEvidence(page, `desktop-1440x900-${count}`, count);
    assertObserverRailMetrics(metrics, count);
    if (metrics.mainStageBox) stageBoxes.push(metrics.mainStageBox);
    if (count === 0) zeroObserverHeight = metrics.observerZoneBox.height;
    if (count === 1) oneObserverHeight = metrics.observerZoneBox.height;
  }

  const widths = stageBoxes.map((box) => box!.width);
  const heights = stageBoxes.map((box) => box!.height);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  expect(Math.abs(oneObserverHeight - zeroObserverHeight)).toBeLessThanOrEqual(2);

  const highCountSession = sessions.get(100)!;
  await openRoom(page, highCountSession);
  const rail = page.getByTestId("vox-observer-row");
  await rail.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => rail.evaluate((node) => (node as HTMLElement).scrollLeft))
    .toBeGreaterThan(0);
  await page.getByTestId("vox-observer-tile").last().focus();
  await expect(page.getByTestId("vox-observer-tile").last()).toBeFocused();
});

test("observer rail remains bounded across required viewport samples", async ({ page }) => {
  const scenarios = [
    { viewport: [1366, 768] as const, counts: [4, 12, 30] },
    { viewport: [1280, 720] as const, counts: [4, 12, 30] },
    { viewport: [1024, 768] as const, counts: [4, 12] },
    { viewport: [768, 1024] as const, counts: [4, 12, 30] },
    { viewport: [390, 844] as const, counts: [1, 4, 12] },
  ];
  const sessionCache = new Map<number, ObserverScalingSession>();

  for (const scenario of scenarios) {
    await page.setViewportSize({
      width: scenario.viewport[0],
      height: scenario.viewport[1],
    });
    for (const count of scenario.counts) {
      if (!sessionCache.has(count)) {
        sessionCache.set(
          count,
          await createObserverScalingSession({
            observerCount: count,
            lifecycle: "RUNNING",
            cameraPattern: "mixed",
            micPattern: "mixed",
            longNames: count >= 12,
            preferredLocale: scenario.viewport[0] <= 768 ? "ru" : "en",
          }),
        );
      }
      const session = sessionCache.get(count)!;
      await openRoom(page, session);
      await expect(page.getByTestId("vox-observer-tile")).toHaveCount(count);
      const scenarioId = `viewport-${scenario.viewport[0]}x${scenario.viewport[1]}-${count}`;
      const metrics = await captureEvidence(page, scenarioId, count);
      assertObserverRailMetrics(metrics, count);
    }
  }
});

test("unassigned participant remains in observer rail during debrief", async ({ page }) => {
  const session = await createObserverScalingSession({
    observerCount: 4,
    lifecycle: "DEBRIEF_OPEN",
    cameraPattern: "all-off",
    micPattern: "all-off",
    includeUnassignedParticipantObserver: true,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
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
