import { expect, test, type Page } from "@playwright/test";

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
import { seedCookieConsent } from "./helpers/cookie-consent";

test.describe.configure({ mode: "serial" });

type LaneFixture = {
  userId: string;
  futureIdleTitle: string;
  pastIdleId: string;
  pastIdleTitle: string;
  pastLobbyId: string;
  pastLobbyTitle: string;
  pastOpenTitle: string;
  pastClosedTitle: string;
  pastDebriefId: string;
  pastDebriefTitle: string;
  pastDebriefSessionId: string;
  completedTitle: string;
  futureHistoricalTitle: string;
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

async function insertChildSession(input: {
  sessionId: string;
  caseId: string;
  userId: string;
  eventId: string;
  title: string;
  negotiationState: "RUNNING" | "FINISHED";
  roomLifecycle: "OPEN" | "DEBRIEF_OPEN" | "CLOSED";
  status: "READY" | "COMPLETED";
}) {
  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","eventId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$5,'context','instructions','EN',$6,$7,$8,300,900,NOW())`,
    [
      input.sessionId,
      input.caseId,
      input.userId,
      input.eventId,
      input.title,
      input.status,
      input.negotiationState,
      input.roomLifecycle,
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","type","joinToken","displayName","notes","updatedAt")
     VALUES ($1,$2,$3,'FACILITATOR',$4,'Lane Facilitator','',NOW())`,
    [e2eId("dash-lane-sp"), input.sessionId, input.userId, e2eId("dash-lane-join")],
  );
}

async function createOwnedEvent(input: {
  userId: string;
  title: string;
  scheduledAtSql: string;
  status?: "LOBBY_OPEN" | "COMPLETED" | "CANCELLED";
}) {
  const event = await createE2eEvent({ title: input.title });
  await query(
    `UPDATE "TrainingEvent"
        SET "hostUserId"=$2,
            "facilitatorUserId"=$2,
            "status"=$3,
            "scheduledAt"=${input.scheduledAtSql},
            "updatedAt"=NOW()
      WHERE "id"=$1`,
    [event.id, input.userId, input.status ?? "LOBBY_OPEN"],
  );
  return event;
}

async function bindCurrentLobbyPresence(eventId: string, userId: string) {
  await query(
    `INSERT INTO "EventParticipant"
      ("id","eventId","userId","displayName","participantToken","preference",
       "isHost","wantsToPlay","wantsToObserve","wantsToFacilitate",
       "joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'Lane Host',$4,'FACILITATE',true,false,false,true,NOW(),NOW(),NOW())`,
    [e2eId("dash-lane-ep"), eventId, userId, e2eId("dash-lane-token")],
  );
}

function eventCard(page: Page, title: string) {
  return page.getByTestId("dashboard-event-card").filter({ hasText: title });
}

async function createLaneFixture(): Promise<LaneFixture> {
  const user = await createActiveUser({ preferredLocale: "en" });
  const negotiationCase = await createE2eCase();

  const futureIdle = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane future idle"),
    scheduledAtSql: "NOW() + INTERVAL '2 days'",
  });
  const pastIdle = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane past idle"),
    scheduledAtSql: "NOW() - INTERVAL '2 days'",
  });
  const pastLobby = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane past lobby"),
    scheduledAtSql: "NOW() - INTERVAL '2 days'",
  });
  await bindCurrentLobbyPresence(pastLobby.id, user.id);

  const pastOpen = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane past open child"),
    scheduledAtSql: "NOW() - INTERVAL '2 days'",
  });
  await insertChildSession({
    sessionId: e2eId("dash-lane-open"),
    caseId: negotiationCase.id,
    userId: user.id,
    eventId: pastOpen.id,
    title: e2eName("Lane open child session"),
    negotiationState: "RUNNING",
    roomLifecycle: "OPEN",
    status: "READY",
  });

  const pastClosed = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane past closed child"),
    scheduledAtSql: "NOW() - INTERVAL '2 days'",
  });
  await insertChildSession({
    sessionId: e2eId("dash-lane-closed"),
    caseId: negotiationCase.id,
    userId: user.id,
    eventId: pastClosed.id,
    title: e2eName("Lane closed child session"),
    negotiationState: "FINISHED",
    roomLifecycle: "CLOSED",
    status: "COMPLETED",
  });

  const pastDebrief = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane past debrief child"),
    scheduledAtSql: "NOW() - INTERVAL '2 days'",
  });
  const pastDebriefSessionId = e2eId("dash-lane-debrief");
  await insertChildSession({
    sessionId: pastDebriefSessionId,
    caseId: negotiationCase.id,
    userId: user.id,
    eventId: pastDebrief.id,
    title: e2eName("Lane debrief child session"),
    negotiationState: "FINISHED",
    roomLifecycle: "DEBRIEF_OPEN",
    status: "COMPLETED",
  });

  const completed = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane completed terminal"),
    scheduledAtSql: "NOW() - INTERVAL '1 day'",
    status: "COMPLETED",
  });
  await bindCurrentLobbyPresence(completed.id, user.id);

  const futureHistorical = await createOwnedEvent({
    userId: user.id,
    title: e2eName("Lane future historical child"),
    scheduledAtSql: "NOW() + INTERVAL '3 days'",
  });
  await insertChildSession({
    sessionId: e2eId("dash-lane-future-hist"),
    caseId: negotiationCase.id,
    userId: user.id,
    eventId: futureHistorical.id,
    title: e2eName("Lane future historical session"),
    negotiationState: "FINISHED",
    roomLifecycle: "CLOSED",
    status: "COMPLETED",
  });

  return {
    userId: user.id,
    futureIdleTitle: futureIdle.title,
    pastIdleId: pastIdle.id,
    pastIdleTitle: pastIdle.title,
    pastLobbyId: pastLobby.id,
    pastLobbyTitle: pastLobby.title,
    pastOpenTitle: pastOpen.title,
    pastClosedTitle: pastClosed.title,
    pastDebriefId: pastDebrief.id,
    pastDebriefTitle: pastDebrief.title,
    pastDebriefSessionId,
    completedTitle: completed.title,
    futureHistoricalTitle: futureHistorical.title,
  };
}

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

test("dashboard Event lanes are exclusive and past idle Archive remains joinable", async ({
  page,
}) => {
  const fixture = await createLaneFixture();
  await seedCookieConsent(page);
  await login(page, fixture.userId);
  await page.goto("/dashboard");

  const active = page.getByTestId("dashboard-upcoming-active-section");
  const archive = page.getByTestId("dashboard-archive-disclosure");
  await expect(archive).toBeVisible();
  await archive.locator("summary").click();

  for (const title of [
    fixture.futureIdleTitle,
    fixture.pastLobbyTitle,
    fixture.pastOpenTitle,
    fixture.pastDebriefTitle,
    fixture.futureHistoricalTitle,
  ]) {
    await expect(active.getByTestId("dashboard-event-card").filter({ hasText: title })).toHaveCount(1);
    await expect(archive.getByTestId("dashboard-event-card").filter({ hasText: title })).toHaveCount(0);
  }

  for (const title of [
    fixture.pastIdleTitle,
    fixture.pastClosedTitle,
    fixture.completedTitle,
  ]) {
    await expect(archive.getByTestId("dashboard-event-card").filter({ hasText: title })).toHaveCount(1);
    await expect(active.getByTestId("dashboard-event-card").filter({ hasText: title })).toHaveCount(0);
  }

  const pastIdleCard = eventCard(page, fixture.pastIdleTitle);
  await expect(pastIdleCard).toHaveAttribute("data-dashboard-lane", "archive");
  await expect(pastIdleCard).toHaveAttribute("data-event-terminal", "false");
  await expect(pastIdleCard.getByTestId("dashboard-event-lobby-action")).toBeVisible();

  const completedCard = eventCard(page, fixture.completedTitle);
  await expect(completedCard).toHaveAttribute("data-event-terminal", "true");

  await pastIdleCard.getByTestId("dashboard-event-lobby-action").click();
  await expect(page).toHaveURL(new RegExp(`/events/${fixture.pastIdleId}/lobby`));
  await expect(page.getByText(fixture.pastIdleTitle)).toBeVisible();
  await expect(page.getByText("Event unavailable")).toHaveCount(0);

  await query(
    `UPDATE "EventParticipant" SET "lastSeenAt"=NOW() - INTERVAL '2 minutes' WHERE "eventId"=$1`,
    [fixture.pastLobbyId],
  );
  await query(
    `UPDATE "Session"
        SET "roomLifecycle"='CLOSED',"status"='COMPLETED',"updatedAt"=NOW()
      WHERE "id"=$1`,
    [fixture.pastDebriefSessionId],
  );
  await query(
    `INSERT INTO "EventParticipant"
      ("id","eventId","userId","displayName","participantToken","preference",
       "isHost","wantsToPlay","wantsToObserve","wantsToFacilitate",
       "joinedAt","lastSeenAt","updatedAt")
     VALUES ($1,$2,$3,'Lane Reentry',$4,'FACILITATE',true,false,false,true,NOW(),NOW(),NOW())`,
    [e2eId("dash-lane-reentry"), fixture.pastIdleId, fixture.userId, e2eId("dash-lane-reentry-token")],
  );

  await page.goto("/dashboard");
  const activeAfter = page.getByTestId("dashboard-upcoming-active-section");
  const archiveAfter = page.getByTestId("dashboard-archive-disclosure");
  await archiveAfter.locator("summary").click();

  await expect(activeAfter.getByTestId("dashboard-event-card").filter({ hasText: fixture.pastIdleTitle })).toHaveCount(1);
  await expect(archiveAfter.getByTestId("dashboard-event-card").filter({ hasText: fixture.pastIdleTitle })).toHaveCount(0);
  await expect(archiveAfter.getByTestId("dashboard-event-card").filter({ hasText: fixture.pastLobbyTitle })).toHaveCount(1);
  await expect(activeAfter.getByTestId("dashboard-event-card").filter({ hasText: fixture.pastLobbyTitle })).toHaveCount(0);
  await expect(archiveAfter.getByTestId("dashboard-event-card").filter({ hasText: fixture.pastDebriefTitle })).toHaveCount(1);
  await expect(activeAfter.getByTestId("dashboard-event-card").filter({ hasText: fixture.pastDebriefTitle })).toHaveCount(0);
});
