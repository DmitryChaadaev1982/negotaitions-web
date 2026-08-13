import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

type StatusFixture = {
  userId: string;
  standaloneSessionId: string;
  standaloneTitle: string;
  standaloneJoinToken: string;
  eventSessionId: string;
  eventSessionTitle: string;
  eventJoinToken: string;
  explicitSessionId: string;
  explicitSessionTitle: string;
  eventId: string;
};

async function login(page: Page, userId: string) {
  const cookieHeader = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookieHeader.slice("auth_session=".length),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function createStatusFixture(): Promise<StatusFixture> {
  const user = await createActiveUser({ preferredLocale: "en" });
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    title: e2eName("Session overview status Event"),
  });
  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId"=$2,"facilitatorUserId"=$2,"updatedAt"=NOW()
     WHERE "id"=$1`,
    [event.id, user.id],
  );

  const standaloneSessionId = e2eId("overview-status-standalone");
  const eventSessionId = e2eId("overview-status-event");
  const explicitSessionId = e2eId("overview-status-explicit");
  const standaloneTitle = e2eName("Standalone empty Debrief status");
  const eventSessionTitle = e2eName("Event-created Debrief status");
  const explicitSessionTitle = e2eName("Rejoined Debrief status");
  const standaloneJoinToken = e2eId("overview-status-standalone-join");
  const eventJoinToken = e2eId("overview-status-event-join");
  const explicitJoinToken = e2eId("overview-status-explicit-join");

  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","eventId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","negotiationEndedAt","updatedAt")
     VALUES
      ($1,$4,$5,NULL,$6,$9,'context','instructions','EN','COMPLETED','FINISHED','DEBRIEF_OPEN',300,900,NOW(),NOW()),
      ($2,$4,$5,$10,$7,$9,'context','instructions','EN','COMPLETED','FINISHED','DEBRIEF_OPEN',300,900,NOW(),NOW()),
      ($3,$4,$5,NULL,$8,$9,'context','instructions','EN','COMPLETED','FINISHED','DEBRIEF_OPEN',300,900,NOW(),NOW())`,
    [
      standaloneSessionId,
      eventSessionId,
      explicitSessionId,
      negotiationCase.id,
      user.id,
      standaloneTitle,
      eventSessionTitle,
      explicitSessionTitle,
      negotiationCase.title,
      event.id,
    ],
  );

  for (const [sessionId, joinToken] of [
    [standaloneSessionId, standaloneJoinToken],
    [eventSessionId, eventJoinToken],
    [explicitSessionId, explicitJoinToken],
  ]) {
    await query(
      `INSERT INTO "SessionParticipant"
        ("id","sessionId","userId","type","joinToken","displayName","notes","updatedAt")
       VALUES ($1,$2,$3,'FACILITATOR',$4,'Status Facilitator','',NOW())`,
      [
        e2eId("overview-status-participant"),
        sessionId,
        user.id,
        joinToken,
      ],
    );
  }

  await query(
    `INSERT INTO "SessionRoomConnection"
      ("id","sessionId","userId","connectionId","role","expiresAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'FACILITATOR',NOW() + INTERVAL '5 minutes',NOW(),NOW())`,
    [
      e2eId("overview-status-connection"),
      explicitSessionId,
      user.id,
      e2eId("overview-status-rejoin"),
    ],
  );

  const recordingId = e2eId("overview-status-recording");
  const transcriptId = e2eId("overview-status-transcript");
  await query(
    `INSERT INTO "Recording"
      ("id","sessionId","provider","status","recordingType","endedAt","updatedAt")
     VALUES ($1,$2,'E2E','COMPLETED','AUDIO_ONLY',NOW(),NOW())`,
    [recordingId, standaloneSessionId],
  );
  await query(
    `INSERT INTO "Transcript"
      ("id","sessionId","recordingId","source","status","text","completedAt","updatedAt")
     VALUES ($1,$2,$3,'MANUAL','COMPLETED','completed transcript',NOW(),NOW())`,
    [transcriptId, standaloneSessionId, recordingId],
  );
  await query(
    `INSERT INTO "AiAnalysis"
      ("id","sessionId","transcriptId","status","analysisJson","completedAt","updatedAt")
     VALUES ($1,$2,$3,'COMPLETED',$4,NOW(),NOW())`,
    [
      e2eId("overview-status-analysis"),
      standaloneSessionId,
      transcriptId,
      JSON.stringify({ summary: "completed analysis" }),
    ],
  );

  return {
    userId: user.id,
    standaloneSessionId,
    standaloneTitle,
    standaloneJoinToken,
    eventSessionId,
    eventSessionTitle,
    eventJoinToken,
    explicitSessionId,
    explicitSessionTitle,
    eventId: event.id,
  };
}

function sessionRow(page: Page, title: string) {
  return page.getByTestId("session-row").filter({ hasText: title });
}

async function expectRejoinAction(
  request: APIRequestContext,
  sessionId: string,
  joinToken: string,
  expectedAction: "room" | "materials",
) {
  const response = await request.post("/api/rejoin/validate", {
    data: {
      type: "SESSION_ROOM",
      sessionId,
      joinToken,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    valid: boolean;
    primaryAction?: string;
    targetUrl?: string;
  };
  expect(body.valid).toBe(true);
  expect(body.primaryAction).toBe(expectedAction);
  expect(body.targetUrl).toContain(
    expectedAction === "room" ? `/room/${sessionId}` : `/join/${joinToken}`,
  );
}

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

test("standalone and Event-created overview statuses distinguish Debrief from canonical completion", async ({
  page,
}) => {
  const fixture = await createStatusFixture();
  await login(page, fixture.userId);

  await page.goto("/sessions");
  for (const title of [
    fixture.standaloneTitle,
    fixture.eventSessionTitle,
    fixture.explicitSessionTitle,
  ]) {
    const row = sessionRow(page, title);
    await expect(row).toContainText("Debrief");
    await expect(row).not.toContainText("Completed");
    await expect(row.getByTestId("open-room-button")).toBeVisible();
  }

  for (const [sessionId, joinToken] of [
    [fixture.standaloneSessionId, fixture.standaloneJoinToken],
    [fixture.eventSessionId, fixture.eventJoinToken],
  ]) {
    await page.goto(`/sessions/${sessionId}/materials`);
    await expect(page.getByTestId("materials-open-room-button")).toBeVisible();
    await expectRejoinAction(page.request, sessionId, joinToken, "room");
  }

  await page.goto("/dashboard");
  const currentSection = page.getByTestId("dashboard-upcoming-active-section");
  await expect(currentSection).toContainText(fixture.standaloneTitle);
  await expect(currentSection).toContainText(fixture.eventSessionTitle);
  await expect(currentSection.getByText("Debrief", { exact: true })).toHaveCount(3);
  await expect(page.getByTestId("dashboard-archive-disclosure")).toHaveCount(0);

  await page.evaluate(() => {
    window.localStorage.setItem("negotaitions_locale", "ru");
    document.cookie = "negotaitions_locale=ru;path=/";
  });
  await page.goto("/sessions");
  for (const title of [
    fixture.standaloneTitle,
    fixture.eventSessionTitle,
    fixture.explicitSessionTitle,
  ]) {
    const row = sessionRow(page, title);
    await expect(row).toContainText("Дебриф");
    await expect(row).not.toContainText("Завершено");
  }

  await query(
    `UPDATE "Session"
     SET "status"='READY',"roomLifecycle"='CLOSED',
         "endedAt"=NOW(),"closeReason"='DEBRIEF_EMPTY_TIMEOUT',"updatedAt"=NOW()
     WHERE "id"=$1`,
    [fixture.standaloneSessionId],
  );
  await query(
    `UPDATE "Session"
     SET "status"='DRAFT',"roomLifecycle"='CLOSED',
         "endedAt"=NOW(),"closeReason"='FACILITATOR_SESSION_COMPLETE',"updatedAt"=NOW()
     WHERE "id"=$1`,
    [fixture.explicitSessionId],
  );
  await query(
    `UPDATE "TrainingEvent"
     SET "status"='COMPLETED',"completedAt"=NOW(),"updatedAt"=NOW()
     WHERE "id"=$1`,
    [fixture.eventId],
  );
  await query(
    `UPDATE "Session"
     SET "status"='READY',"roomLifecycle"=NULL,"endedAt"=NOW(),
         "closeReason"='EVENT_COMPLETED',"closedByEventAt"=NOW(),
         "closedByEventId"=$2,"updatedAt"=NOW()
     WHERE "id"=$1`,
    [fixture.eventSessionId, fixture.eventId],
  );

  await page.reload();
  for (const title of [
    fixture.standaloneTitle,
    fixture.eventSessionTitle,
    fixture.explicitSessionTitle,
  ]) {
    const row = sessionRow(page, title);
    await expect(row).toContainText("Завершено");
    await expect(row).not.toContainText("Дебриф");
    await expect(row.getByTestId("open-room-button")).toHaveCount(0);
  }

  for (const [sessionId, joinToken] of [
    [fixture.standaloneSessionId, fixture.standaloneJoinToken],
    [fixture.eventSessionId, fixture.eventJoinToken],
  ]) {
    await page.goto(`/sessions/${sessionId}/materials`);
    await expect(page.getByTestId("materials-open-room-button")).toHaveCount(0);
    await expectRejoinAction(page.request, sessionId, joinToken, "materials");
  }

  await page.goto("/dashboard");
  const terminalCurrentSection = page.getByTestId("dashboard-current-section");
  await expect(terminalCurrentSection).toContainText(
    "Нет активных комнат для подключения.",
  );
  for (const title of [
    fixture.standaloneTitle,
    fixture.eventSessionTitle,
    fixture.explicitSessionTitle,
  ]) {
    await expect(terminalCurrentSection).not.toContainText(title);
  }
  const archive = page.getByTestId("dashboard-archive-disclosure");
  await expect(archive).toBeVisible();
  await archive.locator("summary").click();
  await expect(archive).toContainText(fixture.standaloneTitle);
  await expect(archive).toContainText(fixture.eventSessionTitle);
  await expect(archive).toContainText(fixture.explicitSessionTitle);
});
