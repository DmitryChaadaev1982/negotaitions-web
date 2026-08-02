import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

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

async function cleanupStage312bData() {
  const sessions = await query<{ id: string }>(
    `SELECT "id"
     FROM "Session"
     WHERE "title" LIKE 'Stage 3.12B%'
        OR "roomLabel" LIKE 'Wave1%'
        OR "snapshotCaseTitle" LIKE 'Stage 3.12B%'`,
  );
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length > 0) {
    await query(`DELETE FROM "SessionParticipant" WHERE "sessionId" = ANY($1)`, [sessionIds]);
    await query(`DELETE FROM "SessionRole" WHERE "sessionId" = ANY($1)`, [sessionIds]);
    await query(`DELETE FROM "Session" WHERE "id" = ANY($1)`, [sessionIds]);
  }
  const events = await query<{ id: string }>(
    `SELECT "id" FROM "TrainingEvent" WHERE "title" LIKE 'Stage 3.12B%'`,
  );
  const eventIds = events.map((event) => event.id);
  if (eventIds.length > 0) {
    await query(`DELETE FROM "EventParticipant" WHERE "eventId" = ANY($1)`, [eventIds]);
    await query(`DELETE FROM "TrainingEvent" WHERE "id" = ANY($1)`, [eventIds]);
  }
}

async function createEventSessionFixture(input?: {
  participantPreference?: "UNDECIDED" | "PLAY" | "OBSERVE" | "FACILITATE";
  assignParticipant?: boolean;
}) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: "Stage 3.12B Wave1 Lobby Event",
  });
  const participants = await getEventParticipants(event.id);
  const dmitry = participants.find((participant) => participant.displayName === "Dmitry")!;
  const igor = participants.find((participant) => participant.displayName === "Igor")!;
  const alex = participants.find((participant) => participant.displayName === "Alex")!;
  const hostUser = await createActiveUser({ preferredLocale: "en" });
  const participantUser = await createActiveUser({ preferredLocale: "en" });
  const otherUser = await createActiveUser({ preferredLocale: "en" });
  const [buyerRole, sellerRole] = negotiationCase.roles;

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, hostUser.id],
  );
  await query(`UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`, [
    dmitry.id,
    hostUser.id,
  ]);
  await query(
    `UPDATE "EventParticipant"
     SET "userId"=$2,"preference"=$3
     WHERE "id"=$1`,
    [igor.id, participantUser.id, input?.participantPreference ?? "PLAY"],
  );
  await query(`UPDATE "EventParticipant" SET "userId"=$2 WHERE "id"=$1`, [
    alex.id,
    otherUser.id,
  ]);

  const sessionId = e2eId("stage-312b-session");
  const roleAId = e2eId("stage-312b-role-a");
  const roleBId = e2eId("stage-312b-role-b");
  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","eventId","title","roomLabel",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,'Stage 3.12B Wave1 Session','Wave1 Room',
        'Stage 3.12B Case','Business context','Public instructions','EN',300,900,NOW())`,
    [sessionId, negotiationCase.id, hostUser.id, event.id],
  );
  await query(
    `INSERT INTO "SessionRole"
       ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
       ($1,$3,$4,'Buyer private','Buyer objective','Buyer constraints','Buyer hidden','Buyer fallback',0,NOW()),
       ($2,$3,$5,'Seller private','Seller objective','Seller constraints','Seller hidden','Seller fallback',1,NOW())`,
    [roleAId, roleBId, sessionId, buyerRole?.name ?? "Buyer", sellerRole?.name ?? "Seller"],
  );

  if (input?.assignParticipant ?? true) {
    await query(
      `INSERT INTO "SessionParticipant"
         ("id","sessionId","userId","eventParticipantId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
       VALUES
         (gen_random_uuid(),$1,$2,$3,NULL,'FACILITATOR',$4,'Dmitry','',NOW()),
         (gen_random_uuid(),$1,$5,$6,$7,'PARTICIPANT',$8,'Igor','',NOW()),
         (gen_random_uuid(),$1,$9,$10,$11,'PARTICIPANT',$12,'Alex','',NOW())`,
      [
        sessionId,
        hostUser.id,
        dmitry.id,
        `stage312b-host-${sessionId}`,
        participantUser.id,
        igor.id,
        roleAId,
        `stage312b-igor-${sessionId}`,
        otherUser.id,
        alex.id,
        roleBId,
        `stage312b-alex-${sessionId}`,
      ],
    );
    await forceSessionRunningForE2e(sessionId);
  }

  return {
    eventId: event.id,
    sessionId,
    participantUserId: participantUser.id,
    hostUserId: hostUser.id,
  };
}

test.beforeEach(async () => {
  await cleanupStage312bData();
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupStage312bData();
  await cleanupE2eData();
});

test("assigned lobby shows compact desired role, My Session, and one primary room target", async ({
  page,
}) => {
  const fixture = await createEventSessionFixture();
  await login(page, fixture.participantUserId);

  await page.goto(`/events/${fixture.eventId}/lobby`);
  await expect(page.getByTestId("desired-role-summary")).toBeVisible();
  await page.getByTestId("desired-role-change-button").click();
  await expect(page.getByTestId("desired-role-options")).toBeVisible();
  await page.getByTestId("desired-role-cancel-button").click();
  await expect(page.getByTestId("desired-role-summary")).toBeVisible();

  await expect(page.getByTestId("my-session-card")).toBeVisible();
  await expect(page.getByTestId("participant-card").first()).toBeVisible();

  const roomTarget = `/room/${fixture.sessionId}`;
  const primaryRoomActions = page.locator(
    `[data-action-kind="PRIMARY_PROGRESS"][data-action-target="${roomTarget}"]`,
  );
  await expect(primaryRoomActions).toHaveCount(1);
  await expect(page.getByTestId("go-to-session-room-button")).toHaveCount(1);
  await expect(page.getByTestId("open-session-materials-button")).toBeVisible();
});

test("undecided desired role keeps the full selector visible", async ({ page }) => {
  const fixture = await createEventSessionFixture({
    participantPreference: "UNDECIDED",
    assignParticipant: false,
  });
  await login(page, fixture.participantUserId);

  await page.goto(`/events/${fixture.eventId}/lobby`);
  await expect(page.getByTestId("desired-role-options")).toBeVisible();
  await expect(page.getByTestId("desired-role-option")).toHaveCount(4);
  await expect(page.getByTestId("desired-role-summary")).toHaveCount(0);
  await expect(page.getByTestId("my-session-card")).toContainText("No Session assignment yet");
});

test("dashboard separates current activity from collapsed archive", async ({ page }) => {
  const active = await createEventSessionFixture();
  const completedCase = await createE2eCase();
  const completedSessionId = e2eId("stage-312b-completed-session");
  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","title",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
        "preparationDurationSeconds","durationSeconds","negotiationEndedAt","updatedAt")
     VALUES ($1,$2,$3,'Stage 3.12B Completed Session',
        'Stage 3.12B Completed Case','Business context','Public instructions',
        'EN','COMPLETED','FINISHED','CLOSED',300,900,NOW(),NOW())`,
    [completedSessionId, completedCase.id, active.hostUserId],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","type","joinToken","displayName","notes","updatedAt")
     VALUES (gen_random_uuid(),$1,$2,'PARTICIPANT',$3,'Igor','',NOW())`,
    [completedSessionId, active.participantUserId, `stage312b-completed-${completedSessionId}`],
  );
  await login(page, active.participantUserId);

  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-current-section")).toBeVisible();
  await expect(page.getByTestId("dashboard-upcoming-active-section")).toBeVisible();
  await expect(page.getByTestId("dashboard-archive-disclosure")).toBeVisible();
  await expect(page.getByTestId("dashboard-archive-disclosure")).not.toHaveAttribute("open", "");

  const currentTop = await page.getByTestId("dashboard-current-section").evaluate((node) =>
    node.getBoundingClientRect().top,
  );
  const archiveTop = await page.getByTestId("dashboard-archive-section").evaluate((node) =>
    node.getBoundingClientRect().top,
  );
  expect(currentTop).toBeLessThan(archiveTop);

  await page.getByTestId("dashboard-archive-disclosure").locator("summary").click();
  await expect(page.getByTestId("dashboard-session-materials-action").first()).toBeVisible();
  await expect(page.getByTestId("dashboard-session-materials-action").first()).toHaveAttribute(
    "data-action-kind",
    "REVIEW_RESULTS",
  );
});
