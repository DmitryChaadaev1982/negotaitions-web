import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createDiarizedTranscript,
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

async function createCorrectionFixture() {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    withParticipants: true,
    title: "Stage 3.12B-W1C Corrections Event",
  });
  const eventParticipants = await getEventParticipants(event.id);
  const dmitry = eventParticipants.find((participant) => participant.displayName === "Dmitry")!;
  const igor = eventParticipants.find((participant) => participant.displayName === "Igor")!;
  const alex = eventParticipants.find((participant) => participant.displayName === "Alex")!;
  const serg = eventParticipants.find((participant) => participant.displayName === "Serg")!;
  const hostUser = await createActiveUser({ preferredLocale: "en" });
  const participantAUser = await createActiveUser({ preferredLocale: "en" });
  const participantBUser = await createActiveUser({ preferredLocale: "en" });
  const observerUser = await createActiveUser({ preferredLocale: "en" });
  const invitedUser = await createActiveUser({ preferredLocale: "en" });
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const sessionId = e2eId("stage-312b-w1c-session");
  const participantAId = e2eId("stage-312b-w1c-a");
  const participantBId = e2eId("stage-312b-w1c-b");
  const facilitatorId = e2eId("stage-312b-w1c-facilitator");
  const observerId = e2eId("stage-312b-w1c-observer");
  const invitedId = e2eId("stage-312b-w1c-invited");
  const roleAId = e2eId("stage-312b-w1c-role-a");
  const roleBId = e2eId("stage-312b-w1c-role-b");

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, hostUser.id],
  );
  await query(
    `UPDATE "EventParticipant"
     SET "userId" = CASE "id"
       WHEN $2 THEN $6
       WHEN $3 THEN $7
       WHEN $4 THEN $8
       WHEN $5 THEN $9
       ELSE "userId"
     END
     WHERE "eventId"=$1`,
    [
      event.id,
      dmitry.id,
      igor.id,
      alex.id,
      serg.id,
      hostUser.id,
      participantAUser.id,
      participantBUser.id,
      observerUser.id,
    ],
  );

  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","eventId","title","roomLabel",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,'Stage 3.12B-W1C Session','Wave1C Live Room',
        'Stage 3.12B-W1C Case','Business context','Public instructions','EN',300,900,NOW())`,
    [sessionId, negotiationCase.id, hostUser.id, event.id],
  );
  await query(
    `INSERT INTO "SessionRole"
       ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
       ($1,$3,$4,'Buyer private briefing','Buyer objective','Buyer constraints','Buyer hidden','Buyer fallback',0,NOW()),
       ($2,$3,$5,'Seller private briefing','Seller objective','Seller constraints','Seller hidden','Seller fallback',1,NOW())`,
    [roleAId, roleBId, sessionId, buyerRole?.name ?? "Buyer", sellerRole?.name ?? "Seller"],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","eventParticipantId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
     VALUES
       ($1,$6,$7,$8,NULL,'FACILITATOR',$9,'Dmitry','facilitator meeting note',NOW()),
       ($2,$6,$10,$11,$12,'PARTICIPANT',$13,'Igor','participant A meeting note',NOW()),
       ($3,$6,$14,$15,$16,'PARTICIPANT',$17,'Alex','participant B meeting note',NOW()),
       ($4,$6,$18,NULL,NULL,'OBSERVER',$19,'Observer','observer meeting note',NOW()),
       ($5,$6,$20,NULL,NULL,'PARTICIPANT',$21,'Test','invited only note',NOW())`,
    [
      facilitatorId,
      participantAId,
      participantBId,
      observerId,
      invitedId,
      sessionId,
      hostUser.id,
      dmitry.id,
      `stage312b-w1c-fac-${sessionId}`,
      participantAUser.id,
      igor.id,
      roleAId,
      `stage312b-w1c-a-${sessionId}`,
      participantBUser.id,
      alex.id,
      roleBId,
      `stage312b-w1c-b-${sessionId}`,
      observerUser.id,
      `stage312b-w1c-obs-${sessionId}`,
      invitedUser.id,
      `stage312b-w1c-never-${sessionId}`,
    ],
  );
  await forceSessionRunningForE2e(sessionId);

  await query(
    `INSERT INTO "AppSetting" ("key","value","updatedAt")
     VALUES ($1,$2,NOW())
     ON CONFLICT ("key") DO UPDATE SET "value"=$2,"updatedAt"=NOW()`,
    [
      `voximplant:event-media-status:${event.id}`,
      JSON.stringify({
        version: 1,
        participants: {
          [igor.id]: { connectionId: "media-a", micEnabled: true, cameraEnabled: true, updatedAt: new Date().toISOString() },
          [alex.id]: { connectionId: "media-b", micEnabled: false, cameraEnabled: false, updatedAt: new Date().toISOString() },
        },
      }),
    ],
  );

  return {
    eventId: event.id,
    sessionId,
    participantAId,
    participantBId,
    facilitatorId,
    observerId,
    invitedId,
    hostUserId: hostUser.id,
    observerUserId: observerUser.id,
    participantAUserId: participantAUser.id,
    participantBUserId: participantBUser.id,
    participantAJoinToken: `stage312b-w1c-a-${sessionId}`,
    facilitatorJoinToken: `stage312b-w1c-fac-${sessionId}`,
    participantAUser,
    participantBUser,
    observerUser,
  };
}

async function cleanupCorrectionsData() {
  const sessions = await query<{ id: string }>(
    `SELECT "id"
     FROM "Session"
     WHERE "title" LIKE 'Stage 3.12B-W1C%'
        OR "roomLabel" LIKE 'Wave1C%'`,
  );
  if (sessions.length > 0) {
    await query(`DELETE FROM "Session" WHERE "id" = ANY($1)`, [
      sessions.map((session) => session.id),
    ]);
  }
  await query(`DELETE FROM "TrainingEvent" WHERE "title" LIKE 'Stage 3.12B-W1C%'`);
}

test.beforeEach(async () => {
  await cleanupCorrectionsData();
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupCorrectionsData();
  await cleanupE2eData();
});

test("lobby visual/status corrections keep media labels accessible", async ({ page }) => {
  const fixture = await createCorrectionFixture();
  await login(page, fixture.observerUserId);

  await page.goto(`/events/${fixture.eventId}/lobby`);
  await expect(page.getByTestId("participant-card").first()).toBeVisible();
  await expect(page.getByTestId("compact-person-mic-status-icon").first()).toHaveAttribute("aria-label", "Microphone on");
  await expect(page.getByTestId("compact-person-camera-status-icon").first()).toHaveAttribute("aria-label", "Camera on");
  await expect(page.getByText("Microphone on")).toHaveCount(0);
  await expect(page.getByText("Camera on")).toHaveCount(0);
});

test("observer active Session action is primary and above participant history", async ({ page }) => {
  const fixture = await createCorrectionFixture();
  await login(page, fixture.observerUserId);

  await page.goto(`/events/${fixture.eventId}/lobby`);
  const available = page.getByTestId("available-observer-session-section");
  const participants = page.getByTestId("lobby-panel-participants");
  await expect(available).toBeVisible();
  await expect(available.getByTestId("join-session-as-observer")).toHaveAttribute(
    "data-action-kind",
    "PRIMARY_PROGRESS",
  );
  const availableTop = await available.evaluate((node) => node.getBoundingClientRect().top);
  const participantsTop = await participants.evaluate((node) => node.getBoundingClientRect().top);
  expect(availableTop).toBeLessThan(participantsTop);
});

test("debrief notes are server-filtered by viewer role", async ({ page }) => {
  const fixture = await createCorrectionFixture();
  await query(
    `UPDATE "Session" SET "roomLifecycle"='DEBRIEF_OPEN',"negotiationState"='FINISHED',"updatedAt"=NOW() WHERE "id"=$1`,
    [fixture.sessionId],
  );
  await login(page, fixture.observerUserId);

  const response = await page.request.get(
    `/api/livekit/sidebar?participantId=${fixture.observerId}`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    debriefNotes: Array<{ displayName: string; notes: string }>;
  };

  expect(body.debriefNotes.map((note) => note.displayName)).toEqual([
    "Igor",
    "Alex",
    "Observer",
  ]);
  expect(body.debriefNotes.map((note) => note.notes).join("\n")).not.toContain(
    "facilitator meeting note",
  );
});

test("speaker mapping excludes invited never-connected participant", async ({ page }) => {
  const fixture = await createCorrectionFixture();
  await createDiarizedTranscript(fixture.sessionId, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 5, text: "Opening." },
    { speakerLabel: "speaker_2", startSeconds: 5, endSeconds: 10, text: "Reply." },
  ]);
  await query(
    `INSERT INTO "Recording"
       ("id","sessionId","provider","status","startedAt","endedAt","updatedAt")
     VALUES ($1,$2,'VOXIMPLANT','COMPLETED',NOW() - INTERVAL '20 minutes',NOW() - INTERVAL '5 minutes',NOW())
     ON CONFLICT ("sessionId") DO UPDATE
       SET "startedAt"=EXCLUDED."startedAt","endedAt"=EXCLUDED."endedAt","status"='COMPLETED',"updatedAt"=NOW()`,
    [e2eId("stage-312b-w1c-recording"), fixture.sessionId],
  );
  await query(
    `INSERT INTO "SessionRoomConnection"
       ("id","sessionId","userId","connectionId","role","expiresAt","disconnectedAt","createdAt","updatedAt")
     VALUES
       ($1,$5,$6,$7,'PARTICIPANT',NOW() - INTERVAL '4 minutes',NOW() - INTERVAL '6 minutes',NOW() - INTERVAL '19 minutes',NOW()),
       ($2,$5,$8,$9,'PARTICIPANT',NOW() - INTERVAL '4 minutes',NOW() - INTERVAL '6 minutes',NOW() - INTERVAL '18 minutes',NOW()),
       ($3,$5,$10,$11,'OBSERVER',NOW() - INTERVAL '4 minutes',NOW() - INTERVAL '6 minutes',NOW() - INTERVAL '17 minutes',NOW()),
       ($4,$5,$12,$13,'FACILITATOR',NOW() - INTERVAL '4 minutes',NOW() - INTERVAL '6 minutes',NOW() - INTERVAL '16 minutes',NOW())`,
    [
      e2eId("conn-a"),
      e2eId("conn-b"),
      e2eId("conn-obs"),
      e2eId("conn-fac"),
      fixture.sessionId,
      fixture.participantAUser.id,
      e2eId("conn-a-id"),
      fixture.participantBUser.id,
      e2eId("conn-b-id"),
      fixture.observerUser.id,
      e2eId("conn-obs-id"),
      fixture.hostUserId,
      e2eId("conn-fac-id"),
    ],
  );

  await login(page, fixture.hostUserId);
  const response = await page.request.get(
    `/api/sessions/${fixture.sessionId}/speaker-mapping?joinToken=${fixture.facilitatorJoinToken}`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    participants: Array<{ sessionParticipantId: string; displayName: string }>;
  };
  expect(body.participants.map((participant) => participant.displayName)).toEqual([
    "Igor",
    "Alex",
    "Dmitry",
    "Observer",
  ]);
  expect(body.participants.map((participant) => participant.sessionParticipantId)).not.toContain(
    fixture.invitedId,
  );
});
