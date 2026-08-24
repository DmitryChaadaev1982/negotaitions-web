import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  createRoomConnectionForParticipant,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

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

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

test("UI-P1 sessions list drops Online immediately after explicit leave while lastSeenAt is still fresh", async ({
  page,
}) => {
  const user = await createActiveUser({ preferredLocale: "en" });
  const negotiationCase = await createE2eCase();
  const sessionId = e2eId("s318a-presence-session");
  const sessionTitle = e2eName("CU-K presence session");
  const joinToken = e2eId("s318a-presence-join");
  const participantId = e2eId("s318a-presence-participant");
  const connectionId = e2eId("s318a-presence-conn");

  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'context','instructions','EN','READY','RUNNING','OPEN',300,900,NOW())`,
    [sessionId, negotiationCase.id, user.id, sessionTitle, negotiationCase.title],
  );
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","notes",
       "joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'FACILITATOR',$4,'Presence Facilitator','',NOW(),NOW(),NOW())`,
    [participantId, sessionId, user.id, joinToken],
  );
  await createRoomConnectionForParticipant({
    sessionId,
    userId: user.id,
    role: "FACILITATOR",
    connectionId,
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });

  await login(page, user.id);
  await page.goto("/sessions");
  const onlineBadge = page.getByTestId(`session-online-count-${sessionId}`);
  await expect(onlineBadge).toHaveAttribute("data-online-count", "1", {
    timeout: 15_000,
  });

  const leave = await page.request.post(`/api/sessions/${sessionId}/presence/leave`, {
    data: {
      participantId,
      joinToken,
      connectionId,
    },
  });
  expect(leave.ok()).toBeTruthy();
  const leaveBody = (await leave.json()) as { disconnected: boolean };
  expect(leaveBody.disconnected).toBe(true);

  const lastSeenRows = await query<{ fresh: boolean }>(
    `SELECT ("lastSeenAt" >= NOW() - INTERVAL '30 seconds') AS fresh
     FROM "SessionParticipant" WHERE "id"=$1`,
    [participantId],
  );
  expect(lastSeenRows[0]?.fresh).toBe(true);

  await expect(onlineBadge).toHaveAttribute("data-online-count", "0", {
    timeout: 12_000,
  });
});

test("UI-P2 Event who-is-where moves Lobby → Session → Offline without lastSeenAt false Online", async ({
  page,
}) => {
  const host = await createActiveUser({ preferredLocale: "en" });
  const guest = await createActiveUser({ preferredLocale: "en" });
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({
    title: e2eName("CU-K presence Event"),
  });
  await query(
    `UPDATE "TrainingEvent"
     SET "hostUserId"=$2,"facilitatorUserId"=$2,"updatedAt"=NOW()
     WHERE "id"=$1`,
    [event.id, host.id],
  );
  const hostParticipantId = e2eId("s318a-event-host-ep");
  const guestParticipantId = e2eId("s318a-event-guest-ep");
  await query(
    `INSERT INTO "EventParticipant"
      ("id","eventId","userId","displayName","participantToken","preference",
       "isHost","wantsToPlay","wantsToObserve","wantsToFacilitate",
       "joinedAt","lastSeenAt","updatedAt")
     VALUES
      ($1,$3,$4,'Presence Host',$6,'FACILITATE',true,false,false,true,NOW(),NOW(),NOW()),
      ($2,$3,$5,'Presence Guest',$7,'PLAY',false,true,false,false,NOW(),NOW(),NOW())`,
    [
      hostParticipantId,
      guestParticipantId,
      event.id,
      host.id,
      guest.id,
      e2eId("s318a-event-host-token"),
      e2eId("s318a-event-guest-token"),
    ],
  );

  const sessionId = e2eId("s318a-event-session");
  const sessionTitle = e2eName("CU-K child room");
  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","eventId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'context','instructions','EN','READY','RUNNING','OPEN',300,900,NOW())`,
    [
      sessionId,
      negotiationCase.id,
      host.id,
      event.id,
      sessionTitle,
      negotiationCase.title,
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","eventParticipantId","type","joinToken",
       "displayName","notes","joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,$4,'PARTICIPANT',$5,'Presence Guest','',NOW(),NOW(),NOW())`,
    [
      e2eId("s318a-event-sp"),
      sessionId,
      guest.id,
      guestParticipantId,
      e2eId("s318a-event-join"),
    ],
  );

  await page.goto(
    `/events/${event.id}/lobby?hostToken=${encodeURIComponent(event.hostToken)}`,
  );
  const guestCard = page
    .getByTestId("participant-card")
    .filter({ hasText: "Presence Guest" });
  await expect(guestCard.locator("[data-testid=event-presence-indicator]")).toHaveAttribute(
    "data-presence-status",
    "IN_LOBBY",
    { timeout: 20_000 },
  );

  const connectionId = await createRoomConnectionForParticipant({
    sessionId,
    userId: guest.id,
    role: "PARTICIPANT",
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });

  await expect(guestCard.locator("[data-testid=event-presence-indicator]")).toHaveAttribute(
    "data-presence-status",
    "IN_SESSION",
    { timeout: 12_000 },
  );

  await query(
    `UPDATE "SessionRoomConnection"
     SET "disconnectedAt"=NOW(),"updatedAt"=NOW()
     WHERE "connectionId"=$1`,
    [connectionId],
  );
  await query(
    `UPDATE "EventParticipant"
     SET "lastSeenAt"=NULL,"updatedAt"=NOW()
     WHERE "id"=$1`,
    [guestParticipantId],
  );

  await expect(guestCard.locator("[data-testid=event-presence-indicator]")).not.toHaveAttribute(
    "data-presence-status",
    "IN_SESSION",
    { timeout: 12_000 },
  );
  await expect(guestCard.locator("[data-testid=event-presence-indicator]")).not.toHaveAttribute(
    "data-presence-status",
    "IN_LOBBY",
    { timeout: 12_000 },
  );

  const lastSeenRows = await query<{ lastSeenAt: Date | string | null }>(
    `SELECT "lastSeenAt" FROM "SessionParticipant" WHERE "sessionId"=$1`,
    [sessionId],
  );
  expect(lastSeenRows[0]?.lastSeenAt).not.toBeNull();
});
