import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  e2eId,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

const COOKIE_CONSENT_STORAGE_KEY = "negotaitions.cookieConsent.v1";

const VIEWPORT_MATRIX = [
  { width: 1920, height: 1080, label: "1920x1080" },
  { width: 1536, height: 864, label: "1536x864" },
  { width: 1366, height: 768, label: "1366x768" },
  { width: 1093, height: 614, label: "1093x614" },
  { width: 1024, height: 576, label: "1024x576" },
  { width: 911, height: 512, label: "911x512" },
  { width: 853, height: 480, label: "853x480" },
] as const;

const HIGHEST_PRESSURE_VIEWPORT = { width: 853, height: 480 } as const;

type RoomGeometryState =
  | "ROOM_READY"
  | "PREPARATION_PAUSED"
  | "WAITING_FOR_NEGOTIATION_START"
  | "NEGOTIATION_RUNNING"
  | "NEGOTIATION_PAUSED"
  | "FINAL_10_SECONDS"
  | "DEBRIEF";

type RoomFixture = {
  sessionId: string;
  facilitatorUserId: string;
};

type LobbyFixture = {
  eventId: string;
  participantUserId: string;
};

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

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

async function setSessionGeometryState(sessionId: string, state: RoomGeometryState) {
  switch (state) {
    case "ROOM_READY":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'PREPARATION',
               "roomLifecycle" = 'OPEN',
               "preparationStartedAt" = NULL,
               "preparationEndedAt" = NULL,
               "preparationTimerStartedAt" = NULL,
               "preparationPausedAt" = NULL,
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NULL,
               "timerStartedAt" = NULL,
               "pausedAt" = NULL,
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    case "PREPARATION_PAUSED":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'PREPARATION_PAUSED',
               "roomLifecycle" = 'OPEN',
               "preparationStartedAt" = NOW() - INTERVAL '4 minutes',
               "preparationEndedAt" = NULL,
               "preparationTimerStartedAt" = NOW() - INTERVAL '4 minutes',
               "preparationPausedAt" = NOW(),
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NULL,
               "timerStartedAt" = NULL,
               "pausedAt" = NULL,
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    case "WAITING_FOR_NEGOTIATION_START":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'READY_TO_START',
               "roomLifecycle" = 'OPEN',
               "preparationStartedAt" = NOW() - INTERVAL '8 minutes',
               "preparationEndedAt" = NOW() - INTERVAL '1 minute',
               "preparationTimerStartedAt" = NOW() - INTERVAL '8 minutes',
               "preparationPausedAt" = NULL,
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NULL,
               "timerStartedAt" = NULL,
               "pausedAt" = NULL,
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    case "NEGOTIATION_RUNNING":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'RUNNING',
               "roomLifecycle" = 'OPEN',
               "preparationStartedAt" = NOW() - INTERVAL '6 minutes',
               "preparationEndedAt" = NOW() - INTERVAL '3 minutes',
               "preparationTimerStartedAt" = NOW() - INTERVAL '6 minutes',
               "preparationPausedAt" = NULL,
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NOW() - INTERVAL '3 minutes',
               "timerStartedAt" = NOW() - INTERVAL '3 minutes',
               "pausedAt" = NULL,
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    case "NEGOTIATION_PAUSED":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'PAUSED',
               "roomLifecycle" = 'OPEN',
               "preparationStartedAt" = NOW() - INTERVAL '20 minutes',
               "preparationEndedAt" = NOW() - INTERVAL '15 minutes',
               "preparationTimerStartedAt" = NOW() - INTERVAL '20 minutes',
               "preparationPausedAt" = NULL,
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NOW() - INTERVAL '14 minutes 20 seconds',
               "timerStartedAt" = NOW() - INTERVAL '14 minutes 20 seconds',
               "pausedAt" = NOW(),
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    case "FINAL_10_SECONDS":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'RUNNING',
               "roomLifecycle" = 'OPEN',
               "preparationStartedAt" = NOW() - INTERVAL '20 minutes',
               "preparationEndedAt" = NOW() - INTERVAL '15 minutes',
               "preparationTimerStartedAt" = NOW() - INTERVAL '20 minutes',
               "preparationPausedAt" = NULL,
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NOW() - INTERVAL '14 minutes 50 seconds',
               "timerStartedAt" = NOW() - INTERVAL '14 minutes 50 seconds',
               "pausedAt" = NULL,
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    case "DEBRIEF":
      await query(
        `UPDATE "Session"
           SET "status" = 'READY',
               "negotiationState" = 'FINISHED',
               "roomLifecycle" = 'DEBRIEF_OPEN',
               "preparationStartedAt" = NOW() - INTERVAL '20 minutes',
               "preparationEndedAt" = NOW() - INTERVAL '15 minutes',
               "preparationTimerStartedAt" = NOW() - INTERVAL '20 minutes',
               "preparationPausedAt" = NULL,
               "preparationTotalPausedSeconds" = 0,
               "negotiationStartedAt" = NOW() - INTERVAL '14 minutes 50 seconds',
               "timerStartedAt" = NOW() - INTERVAL '14 minutes 50 seconds',
               "pausedAt" = NULL,
               "totalPausedSeconds" = 0,
               "negotiationEndedAt" = NOW(),
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        [sessionId],
      );
      return;
    default:
      throw new Error(`Unsupported geometry state: ${state}`);
  }
}

async function createRoomFixture(input: {
  state: RoomGeometryState;
  locale: "en" | "ru";
  observerCount: number;
}): Promise<RoomFixture> {
  const facilitator = await createActiveUser({
    preferredLocale: input.locale,
    email: `${e2eId("wave3-geometry-fac")}@test.invalid`,
  });
  const participantA = await createActiveUser({
    preferredLocale: input.locale,
    email: `${e2eId("wave3-geometry-pa")}@test.invalid`,
  });
  const participantB = await createActiveUser({
    preferredLocale: input.locale,
    email: `${e2eId("wave3-geometry-pb")}@test.invalid`,
  });
  const negotiationCase = await createE2eCase();

  const sessionId = e2eId("wave3-geometry-session");
  const roleAId = e2eId("wave3-geometry-role-a");
  const roleBId = e2eId("wave3-geometry-role-b");
  const facilitatorParticipantId = e2eId("wave3-geometry-fac-sp");
  const participantAId = e2eId("wave3-geometry-a-sp");
  const participantBId = e2eId("wave3-geometry-b-sp");

  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "status", "negotiationState", "preparationDurationSeconds", "durationSeconds",
        "visibility", "roomLifecycle", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       'READY', 'PREPARATION', 300, 900, 'PUBLIC', 'OPEN', NOW())`,
    [
      sessionId,
      negotiationCase.id,
      facilitator.id,
      input.locale === "ru"
        ? `Wave3 геометрия (${input.state}) ${e2eId("ru")}`
        : `Wave3 geometry (${input.state}) ${e2eId("en")}`,
      negotiationCase.title,
      negotiationCase.businessContext,
      negotiationCase.publicInstructions,
      input.locale.toUpperCase(),
    ],
  );

  await query(
    `INSERT INTO "SessionRole"
       ("id", "sessionId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
     VALUES
       ($1, $3, $4, 'Role A private', 'Role A objective', 'Role A constraints', 'Role A hidden', 'Role A fallback', 0, NOW()),
       ($2, $3, $5, 'Role B private', 'Role B objective', 'Role B constraints', 'Role B hidden', 'Role B fallback', 1, NOW())`,
    [
      roleAId,
      roleBId,
      sessionId,
      negotiationCase.roles[0]?.name ?? "Buyer",
      negotiationCase.roles[1]?.name ?? "Seller",
    ],
  );

  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
        "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
     VALUES
       ($1, $4, $5, NULL, 'FACILITATOR', $6, $7, 'fac notes', NOW(), NOW(), NOW()),
       ($2, $4, $8, $10, 'PARTICIPANT', $11, $12, 'a notes', NOW(), NOW(), NOW()),
       ($3, $4, $9, $13, 'PARTICIPANT', $14, $15, 'b notes', NOW(), NOW(), NOW())`,
    [
      facilitatorParticipantId,
      participantAId,
      participantBId,
      sessionId,
      facilitator.id,
      `wave3-fac-${e2eId("token")}`,
      input.locale === "ru" ? "Фасилитатор Wave3" : "Wave3 Facilitator",
      participantA.id,
      participantB.id,
      roleAId,
      `wave3-a-${e2eId("token")}`,
      input.locale === "ru" ? "Участник А" : "Participant A",
      roleBId,
      `wave3-b-${e2eId("token")}`,
      input.locale === "ru" ? "Участник Б" : "Participant B",
    ],
  );

  const observerParticipantIds: string[] = [];
  for (let index = 0; index < input.observerCount; index += 1) {
    const observerUser = await createActiveUser({
      preferredLocale: input.locale,
      email: `${e2eId(`wave3-geometry-observer-${index}`)}@test.invalid`,
    });
    const observerId = e2eId("wave3-geometry-observer-sp");
    observerParticipantIds.push(observerId);
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, $3, NULL, 'OBSERVER', $4, $5, 'observer notes', NOW(), NOW(), NOW())`,
      [
        observerId,
        sessionId,
        observerUser.id,
        `wave3-o-${e2eId("token")}`,
        input.locale === "ru" ? `Наблюдатель ${index + 1}` : `Observer ${index + 1}`,
      ],
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
        connectionId: `wave3-media-${participantId}`,
        micEnabled: index % 2 === 0,
        cameraEnabled: index % 3 !== 0,
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
  await query(
    `INSERT INTO "AppSetting" ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE
       SET "value" = EXCLUDED."value",
           "updatedAt" = NOW()`,
    [
      `voximplant:session-media-status:${sessionId}`,
      JSON.stringify({ version: 1, participants: mediaStatus }),
    ],
  );

  if (input.state === "DEBRIEF") {
    await ensureDebriefRecording(sessionId);
  }

  await setSessionGeometryState(sessionId, input.state);

  return {
    sessionId,
    facilitatorUserId: facilitator.id,
  };
}

async function ensureDebriefRecording(sessionId: string) {
  await query(
    `INSERT INTO "Recording"
       ("id", "sessionId", "provider", "status", "recordingType", "fileName", "mimeType", "updatedAt", "endedAt")
     SELECT $1, $2, 'E2E', 'PROCESSING', 'AUDIO_ONLY', 'wave3-geometry.mp4', 'audio/mp4', NOW(), NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM "Recording" WHERE "sessionId" = $2
     )`,
    [e2eId("wave3-geometry-recording"), sessionId],
  );
}

async function createLobbyFixture(locale: "en" | "ru"): Promise<LobbyFixture> {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: locale === "ru" ? "Wave3 Лобби" : "Wave3 Lobby",
  });

  const hostUser = await createActiveUser({
    preferredLocale: locale,
    email: `${e2eId("wave3-lobby-host")}@test.invalid`,
  });
  const participantUser = await createActiveUser({
    preferredLocale: locale,
    email: `${e2eId("wave3-lobby-participant")}@test.invalid`,
  });
  const otherUser = await createActiveUser({
    preferredLocale: locale,
    email: `${e2eId("wave3-lobby-other")}@test.invalid`,
  });

  const participants = await query<{
    id: string;
    displayName: string;
  }>(
    `SELECT "id", "displayName"
     FROM "EventParticipant"
     WHERE "eventId" = $1
     ORDER BY "createdAt" ASC`,
    [event.id],
  );
  const dmitry = participants.find((participant) => participant.displayName === "Dmitry");
  const igor = participants.find((participant) => participant.displayName === "Igor");
  const alex = participants.find((participant) => participant.displayName === "Alex");
  if (!dmitry || !igor || !alex) {
    throw new Error("Lobby fixture participants are missing");
  }

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility" = 'PUBLIC',
         "hostUserId" = $2,
         "facilitatorUserId" = $2,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, hostUser.id],
  );
  await query(`UPDATE "EventParticipant" SET "userId" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
    dmitry.id,
    hostUser.id,
  ]);
  await query(
    `UPDATE "EventParticipant"
     SET "userId" = $2,
         "preference" = 'PLAY',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [igor.id, participantUser.id],
  );
  await query(`UPDATE "EventParticipant" SET "userId" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
    alex.id,
    otherUser.id,
  ]);

  const sessionId = e2eId("wave3-lobby-session");
  const roleAId = e2eId("wave3-lobby-role-a");
  const roleBId = e2eId("wave3-lobby-role-b");
  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "eventId", "title", "roomLabel",
        "snapshotCaseTitle", "snapshotBusinessContext", "snapshotPublicInstructions",
        "snapshotCaseLanguage", "status", "negotiationState", "roomLifecycle",
        "preparationDurationSeconds", "durationSeconds", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        'READY', 'RUNNING', 'OPEN', 300, 900, NOW())`,
    [
      sessionId,
      negotiationCase.id,
      hostUser.id,
      event.id,
      locale === "ru" ? `Wave3 Лобби Сессия ${e2eId("ru")}` : `Wave3 Lobby Session ${e2eId("en")}`,
      locale === "ru" ? "Wave3 Комната" : "Wave3 Room",
      negotiationCase.title,
      negotiationCase.businessContext,
      negotiationCase.publicInstructions,
      locale.toUpperCase(),
    ],
  );
  await query(
    `INSERT INTO "SessionRole"
       ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
       ($1,$3,$4,'Buyer private','Buyer objective','Buyer constraints','Buyer hidden','Buyer fallback',0,NOW()),
       ($2,$3,$5,'Seller private','Seller objective','Seller constraints','Seller hidden','Seller fallback',1,NOW())`,
    [
      roleAId,
      roleBId,
      sessionId,
      negotiationCase.roles[0]?.name ?? "Buyer",
      negotiationCase.roles[1]?.name ?? "Seller",
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","eventParticipantId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
     VALUES
       (gen_random_uuid(),$1,$2,$3,NULL,'FACILITATOR',$4,$5,'',NOW()),
       (gen_random_uuid(),$1,$6,$7,$8,'PARTICIPANT',$9,$10,'',NOW()),
       (gen_random_uuid(),$1,$11,$12,$13,'PARTICIPANT',$14,$15,'',NOW())`,
    [
      sessionId,
      hostUser.id,
      dmitry.id,
      `wave3-lobby-host-${sessionId}`,
      locale === "ru" ? "Фасилитатор" : "Facilitator",
      participantUser.id,
      igor.id,
      roleAId,
      `wave3-lobby-igor-${sessionId}`,
      locale === "ru" ? "Участник" : "Participant",
      otherUser.id,
      alex.id,
      roleBId,
      `wave3-lobby-alex-${sessionId}`,
      locale === "ru" ? "Наблюдатель" : "Observer",
    ],
  );

  return {
    eventId: event.id,
    participantUserId: participantUser.id,
  };
}

async function openRoom(page: Page, fixture: RoomFixture) {
  await page.context().clearCookies();
  await seedCookieConsent(page);
  await login(page, fixture.facilitatorUserId);
  const response = await page.goto(`/room/${fixture.sessionId}?media=off`, {
    waitUntil: "domcontentloaded",
  });
  expect(response).not.toBeNull();
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
  await expect(page.getByTestId("session-room-header")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="vox-layout-root"], [data-testid="lk-layout-root"]').first(),
  ).toBeVisible({ timeout: 30_000 });
}

function overlap(a: Box, b: Box, tolerance = 0) {
  return !(
    a.right <= b.left + tolerance ||
    b.right <= a.left + tolerance ||
    a.bottom <= b.top + tolerance ||
    b.bottom <= a.top + tolerance
  );
}

async function assertRoomGeometry(
  page: Page,
  input: {
    state: RoomGeometryState;
    viewportLabel: string;
  },
) {
  await expect(page.locator('[data-testid="room-server-timer"]:visible').first()).toBeVisible();
  await expect(page.locator('[data-testid="room-status-badge-image"]:visible').first()).toBeVisible();
  await expect(page.getByTestId("room-notifications-control")).toBeVisible();
  await expect(page.getByTestId("room-media-controls-strip")).toBeVisible();

  const voxMic = page.getByTestId("vox-mic-toggle");
  if (await voxMic.count()) {
    await expect(voxMic).toBeVisible();
    await expect(page.getByTestId("vox-camera-toggle")).toBeVisible();
  } else {
    await expect(page.locator('button[data-lk-source="microphone"]').first()).toBeVisible();
    await expect(page.locator('button[data-lk-source="camera"]').first()).toBeVisible();
  }

  if (input.state === "DEBRIEF") {
    await expect(page.getByTestId("debrief-mode-badge")).toBeVisible();
  } else {
    const expectedControlByState: Record<Exclude<RoomGeometryState, "DEBRIEF">, string> = {
      ROOM_READY: "start-preparation-button",
      PREPARATION_PAUSED: "resume-preparation-button",
      WAITING_FOR_NEGOTIATION_START: "start-negotiation-button",
      NEGOTIATION_RUNNING: "pause-negotiation-button",
      NEGOTIATION_PAUSED: "resume-negotiation-button",
      FINAL_10_SECONDS: "pause-negotiation-button",
    };
    await expect(
      page.getByTestId(expectedControlByState[input.state]),
      `Expected facilitator control missing for ${input.state} at ${input.viewportLabel}`,
    ).toBeVisible();
    await expect(page.getByTestId("room-facilitator-controls-container")).toBeVisible();
  }

  const geometry = await page.evaluate(() => {
    const getBox = (selector: string): Box | null => {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          continue;
        }
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      }
      return null;
    };

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      timer: getBox('[data-testid="room-server-timer"]'),
      header: getBox('[data-testid="session-room-header"]'),
      stage:
        getBox('[data-testid="vox-zone-main-desktop"]') ??
        getBox('[data-testid="vox-zone-main-mobile"]') ??
        getBox('[data-testid="lk-zone-main"]'),
      videoSurface: getBox('[data-testid="room-video-surface"]'),
      observers: getBox('[data-testid="vox-zone-observers"]') ?? getBox('[data-testid="lk-observer-row"]'),
      controls: getBox('[data-testid="room-facilitator-controls-container"]'),
      mediaStrip: getBox('[data-testid="room-media-controls-strip"]'),
      desktopSidebar: getBox('[data-testid="room-desktop-sidebar"]'),
      sidebarToggle: getBox('[data-testid="room-sidebar-toggle"]'),
    };
  });

  expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
  expect(geometry.timer).not.toBeNull();
  expect(geometry.header).not.toBeNull();
  expect(geometry.stage).not.toBeNull();
  expect(geometry.videoSurface).not.toBeNull();
  expect(geometry.mediaStrip).not.toBeNull();

  if (geometry.header && geometry.videoSurface) {
    expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.videoSurface.bottom);
  }
  if (geometry.controls && geometry.videoSurface) {
    expect(
      overlap(geometry.controls, geometry.videoSurface, 1),
      `Facilitator controls overlap room stage at ${input.viewportLabel}`,
    ).toBe(false);
  }
  if (geometry.mediaStrip && geometry.videoSurface) {
    expect(
      overlap(geometry.mediaStrip, geometry.videoSurface, 1),
      `Media controls overlap room stage at ${input.viewportLabel}`,
    ).toBe(false);
  }
  if (geometry.desktopSidebar && geometry.videoSurface) {
    expect(
      overlap(geometry.desktopSidebar, geometry.videoSurface, 1),
      `Sidebar overlaps room stage at ${input.viewportLabel}`,
    ).toBe(false);
    expect(geometry.desktopSidebar.left).toBeGreaterThanOrEqual(geometry.videoSurface.right - 2);
  } else {
    expect(
      geometry.sidebarToggle !== null,
      `Compact sidebar toggle missing when desktop sidebar hidden at ${input.viewportLabel}`,
    ).toBe(true);
  }
  if (geometry.observers && geometry.controls) {
    expect(
      overlap(geometry.observers, geometry.controls, 1),
      `Observer rail overlaps controls at ${input.viewportLabel}`,
    ).toBe(false);
  }
}

async function assertCompactSidebarAccessibility(page: Page) {
  const sidebarToggle = page.getByTestId("room-sidebar-toggle");
  if (!(await sidebarToggle.count()) || !(await sidebarToggle.isVisible().catch(() => false))) {
    return;
  }
  const root = page.getByTestId("room-compact-sidebar-root");
  await expect(root).toHaveAttribute("aria-hidden", "true");
  await sidebarToggle.click();
  await expect(root).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByTestId("room-compact-sidebar-panel")).toBeVisible();
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("room-compact-sidebar-close").click();
  await expect(root).toHaveAttribute("aria-hidden", "true");
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "false");
}

async function openLobby(page: Page, fixture: LobbyFixture) {
  await page.context().clearCookies();
  await seedCookieConsent(page);
  await login(page, fixture.participantUserId);
  const response = await page.goto(`/events/${fixture.eventId}/lobby`, {
    waitUntil: "domcontentloaded",
  });
  expect(response).not.toBeNull();
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible({ timeout: 30_000 });
}

async function assertLobbyGeometry(page: Page, viewportLabel: string) {
  await expect(page.getByTestId("event-lobby-video-area")).toBeVisible();
  await expect(page.getByTestId("my-session-card")).toBeVisible();
  await expect(page.getByTestId("go-to-session-room-button")).toBeVisible();
  await expect(page.getByTestId("desired-role-card")).toBeVisible();

  const lobbyGeometry = await page.evaluate(() => {
    const getBox = (selector: string): Box | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return null;
      }
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      viewportWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      videoArea: getBox('[data-testid="event-lobby-video-area"]'),
      sidebar: getBox('[data-testid="event-lobby-sidebar"]'),
      desiredRoleCard: getBox('[data-testid="desired-role-card"]'),
      mySessionCard: getBox('[data-testid="my-session-card"]'),
    };
  });

  expect(lobbyGeometry.pageScrollWidth).toBeLessThanOrEqual(lobbyGeometry.viewportWidth + 2);
  expect(lobbyGeometry.videoArea).not.toBeNull();
  expect(lobbyGeometry.desiredRoleCard).not.toBeNull();
  expect(lobbyGeometry.mySessionCard).not.toBeNull();
  if (lobbyGeometry.videoArea && lobbyGeometry.sidebar) {
    expect(
      overlap(lobbyGeometry.videoArea, lobbyGeometry.sidebar, 1),
      `Lobby video area overlaps sidebar at ${viewportLabel}`,
    ).toBe(false);
  }
}

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

test("room geometry matrix keeps controls reachable and non-overlapping @observer-layout", async ({
  page,
}) => {
  const fixture = await createRoomFixture({
    state: "NEGOTIATION_RUNNING",
    locale: "en",
    observerCount: 3,
  });

  for (const viewport of VIEWPORT_MATRIX) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openRoom(page, fixture);
    await assertRoomGeometry(page, {
      state: "NEGOTIATION_RUNNING",
      viewportLabel: viewport.label,
    });
    await assertCompactSidebarAccessibility(page);
  }
});

test("high-pressure RU/EN room states stay usable at smallest viewport @observer-layout", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const states: RoomGeometryState[] = [
    "ROOM_READY",
    "PREPARATION_PAUSED",
    "WAITING_FOR_NEGOTIATION_START",
    "NEGOTIATION_RUNNING",
    "NEGOTIATION_PAUSED",
    "FINAL_10_SECONDS",
    "DEBRIEF",
  ];

  await page.setViewportSize(HIGHEST_PRESSURE_VIEWPORT);
  for (const locale of ["en", "ru"] as const) {
    const fixture = await createRoomFixture({
      state: "NEGOTIATION_RUNNING",
      locale,
      observerCount: 5,
    });
    for (const state of states) {
      if (state === "DEBRIEF") {
        await ensureDebriefRecording(fixture.sessionId);
      }
      await setSessionGeometryState(fixture.sessionId, state);
      await openRoom(page, fixture);
      await assertRoomGeometry(page, {
        state,
        viewportLabel: `${HIGHEST_PRESSURE_VIEWPORT.width}x${HIGHEST_PRESSURE_VIEWPORT.height} (${locale}, ${state})`,
      });
      await assertCompactSidebarAccessibility(page);
    }
  }
});

test("observer-heavy room keeps rail usable at responsive pressure @observer-layout", async ({
  page,
}) => {
  test.setTimeout(300_000);
  for (const observerCount of [30, 50, 100]) {
    const fixture = await createRoomFixture({
      state: "NEGOTIATION_RUNNING",
      locale: "en",
      observerCount,
    });
    for (const viewport of [HIGHEST_PRESSURE_VIEWPORT, { width: 1093, height: 614 }]) {
      await page.setViewportSize(viewport);
      await openRoom(page, fixture);
      await expect(page.getByTestId("vox-zone-observers")).toBeVisible();
      await assertRoomGeometry(page, {
        state: "NEGOTIATION_RUNNING",
        viewportLabel: `${viewport.width}x${viewport.height} (${observerCount} observers)`,
      });
    }
  }
});

test("lobby geometry matrix keeps entry controls reachable in RU/EN @observer-layout", async ({
  page,
}) => {
  for (const locale of ["en", "ru"] as const) {
    const fixture = await createLobbyFixture(locale);
    for (const viewport of VIEWPORT_MATRIX) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openLobby(page, fixture);
      await assertLobbyGeometry(page, `${viewport.label} (${locale})`);
    }
  }
});
