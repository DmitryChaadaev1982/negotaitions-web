import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createTestCase,
  createTestEvent,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createUserSessionCookie(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES ($1,$2,$3,NOW() + INTERVAL '30 days',NOW())`,
    [id("sess"), userId, tokenHash],
  );
  return rawToken;
}

async function loginWithSessionCookie(page: import("@playwright/test").Page, rawToken: string) {
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

test.afterAll(async () => {
  await cleanupE2eData();
});

test("management UI shows canonical complete flow and preserves sibling/event state", async ({
  page,
}) => {
  const adminUser = await createActiveUser({
    email: `stage310-admin-${Date.now()}@test.negotaitions.local`,
  });
  await query(`UPDATE "User" SET "globalRole" = 'ADMIN', "updatedAt" = NOW() WHERE "id" = $1`, [
    adminUser.id,
  ]);
  const adminSessionToken = await createUserSessionCookie(adminUser.id);

  const negotiationCase = await createTestCase({
    title: "ST310 Management UI Case",
  });
  const event = await createTestEvent({
    withParticipants: false,
    title: "ST310 Management UI Event",
  });
  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId" = $2,
         "facilitatorUserId" = $2,
         "visibility" = 'PUBLIC',
         "status" = 'SESSION_CREATED',
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [event.id, adminUser.id],
  );

  const targetSessionId = id("session");
  const siblingSessionId = id("session");
  const mappedSessionId = id("session");
  for (const [sessionId, title] of [
    [targetSessionId, "ST310 Target Session"],
    [siblingSessionId, "ST310 Sibling Session"],
    [mappedSessionId, "ST310 Mapping Session"],
  ] as const) {
    await query(
      `INSERT INTO "Session"
        ("id","negotiationCaseId","facilitatorId","eventId","title","snapshotCaseTitle",
         "snapshotBusinessContext","snapshotPublicInstructions","snapshotCaseLanguage",
         "status","negotiationState","roomLifecycle","preparationDurationSeconds","durationSeconds","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EN','READY','READY_TO_START','OPEN',300,900,NOW())`,
      [
        sessionId,
        negotiationCase.id,
        adminUser.id,
        event.id,
        title,
        negotiationCase.title,
        `${title} context`,
        `${title} instructions`,
      ],
    );
  }

  const participantA = id("sp");
  const participantB = id("sp");
  const participantC = id("sp");
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","joinedAt","lastSeenAt","updatedAt")
     VALUES
      ($1,$4,NULL,'PARTICIPANT',$5,'Player One',NOW(),NOW(),NOW()),
      ($2,$4,NULL,'PARTICIPANT',$6,'Player Two',NOW(),NOW(),NOW()),
      ($3,$7,NULL,'PARTICIPANT',$8,'Mapped Player',NOW(),NOW(),NOW())`,
    [
      participantA,
      participantB,
      participantC,
      targetSessionId,
      `join-${id("a")}`,
      `join-${id("b")}`,
      mappedSessionId,
      `join-${id("c")}`,
    ],
  );

  await query(
    `INSERT INTO "Transcript"
      ("id","sessionId","source","status","text","hasSpeakerDiarization","speakerMappingStatus","updatedAt","completedAt")
     VALUES
      ($1,$2,'MANUAL','COMPLETED','mapped transcript',TRUE,'REQUIRED',NOW(),NOW())`,
    [id("tx"), mappedSessionId],
  );
  await query(
    `INSERT INTO "AiAnalysis"
      ("id","sessionId","status","visibility","analysisJson","sharedAnalysisJson","sharedExecutiveSummary","updatedAt","completedAt")
     VALUES
      ($1,$2,'COMPLETED','SHARED_WITH_SESSION',$3,$3,'partial shared',NOW(),NOW()),
      ($4,$5,'COMPLETED','SHARED_WITH_SESSION',$6,$6,'full shared',NOW(),NOW())`,
    [
      id("ai"),
      targetSessionId,
      JSON.stringify({
        participantPersonalFeedback: [{ sessionParticipantId: participantA }],
      }),
      id("ai"),
      mappedSessionId,
      JSON.stringify({
        participantPersonalFeedback: [{ sessionParticipantId: participantC }],
      }),
    ],
  );

  await loginWithSessionCookie(page, adminSessionToken);

  await page.goto("/sessions");
  const targetRow = page.getByTestId("session-row").filter({ hasText: "ST310 Target Session" }).first();
  const siblingRow = page.getByTestId("session-row").filter({ hasText: "ST310 Sibling Session" }).first();
  const mappedRow = page.getByTestId("session-row").filter({ hasText: "ST310 Mapping Session" }).first();

  await expect(targetRow.getByTestId("complete-session-button")).toBeVisible();
  await expect(targetRow.getByRole("button", { name: /delete/i })).toBeVisible();
  await expect(targetRow.getByRole("link", { name: /Open materials|Открыть материалы/i })).toBeVisible();
  await expect(targetRow.getByTestId("sessions-analysis-shared-badge")).toHaveCount(1);
  await expect(mappedRow.getByTestId("sessions-analysis-shared-badge")).toHaveCount(1);
  await expect(mappedRow.getByTestId("sessions-speaker-mapping-required-badge")).toBeVisible();

  const completeButton = targetRow.getByTestId("complete-session-button");
  await completeButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/Complete session|Завершить сессию/i);
  await expect(dialog).not.toContainText(/immediate.*disconnect|немедленн.*отключ/i);

  const cancelButton = dialog.getByRole("button", { name: /cancel|отмена/i });
  await cancelButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(completeButton).toBeFocused();

  let completeCalls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(`/api/sessions/${targetSessionId}/complete`)) {
      completeCalls += 1;
    }
  });

  await completeButton.click();
  const confirmButton = page.getByTestId("confirm-complete-session-button");
  await confirmButton.dblclick();

  await expect(targetRow.getByTestId("complete-session-button")).toHaveCount(0);
  await expect(targetRow.getByRole("link", { name: /Open materials|Открыть материалы/i })).toBeVisible();
  await expect(siblingRow.getByTestId("complete-session-button")).toBeVisible();
  expect(completeCalls).toBe(1);

  await page.goto("/events");
  const eventRow = page
    .locator('[data-testid="event-row"]:visible')
    .filter({ hasText: event.title })
    .first();
  await expect(eventRow.getByTestId("open-event-lobby-button")).toBeVisible();

  await query(
    `UPDATE "TrainingEvent" SET "status" = 'COMPLETED', "completedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1`,
    [event.id],
  );
  await page.reload();
  await expect(eventRow.getByTestId("open-event-lobby-button")).toHaveCount(0);
});
