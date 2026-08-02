import { createHash, randomBytes } from "node:crypto";

import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  getEventParticipants,
  getSession,
  participantByName,
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

async function createAssignedSession(request: APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const hostUser = await createActiveUser();
  const igorUser = await createActiveUser();
  const alexUser = await createActiveUser();
  const sergUser = await createActiveUser();

  if (!buyerRole || !sellerRole) {
    throw new Error("E2E case roles were not created.");
  }

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
      igorUser.id,
      alexUser.id,
      sergUser.id,
    ],
  );

  const assignmentDraft = {
    roomLabel: "Session Navigation Room",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: alex.id,
    },
    observerEventParticipantIds: [serg.id],
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createResponse.ok()).toBeTruthy();
  const body = (await createResponse.json()) as { session: { id: string } };

  const session = await getSession(body.session.id);
  const igorEvent = participantByName(participants, "Igor");

  return {
    event,
    session,
    igorEvent,
    igorSession: participantByName(session.participants, "Igor"),
    igorUser,
  };
}

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });
});

test("assigned lobby navigation targets video room directly", async ({
  page,
  request,
}) => {
  const { event, session, igorEvent, igorSession, igorUser } =
    await createAssignedSession(request);
  await login(page, igorUser.id);

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?participantToken=${igorEvent.participantToken}`,
  );
  expect(stateResponse.ok()).toBeTruthy();
  const state = (await stateResponse.json()) as {
    participants: Array<{
      displayName: string;
      joinToken: string | null;
      assignedSessionId: string | null;
    }>;
  };
  const igorState = state.participants.find(
    (participant) => participant.displayName === "Igor",
  );
  expect(igorState?.joinToken).toBe(igorSession.joinToken);
  expect(igorState?.assignedSessionId).toBe(session.id);

  const tokenRoomUrl = `/room/${session.id}?joinToken=${encodeURIComponent(igorSession.joinToken)}`;
  const accountRoomUrl = `/room/${session.id}`;
  await page.goto(tokenRoomUrl);
  await expect(page).toHaveURL(new RegExp(`/room/${session.id}$`));
  await expect(page.getByText(/Connecting to video room/i)).toBeVisible({
    timeout: 15000,
  });

  await page.goto(`/join/${igorSession.joinToken}`);
  await expect(page.getByText("E2E_PRIVATE_IGOR_ONLY")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open room" })).toHaveAttribute(
    "href",
    accountRoomUrl,
  );
});

test("finished session rejoin routes to materials", async ({ request }) => {
  const { session, igorSession, igorUser } = await createAssignedSession(request);
  const facilitator = participantByName(session.participants, "Dmitry");
  const authToken = await createUserSessionCookie(igorUser.id);

  await request.post(`/api/sessions/${session.id}/control`, {
    data: { joinToken: facilitator.joinToken, action: "SKIP_PREPARATION" },
  });
  await request.post(`/api/sessions/${session.id}/control`, {
    data: { joinToken: facilitator.joinToken, action: "START" },
  });
  await request.post(`/api/sessions/${session.id}/control`, {
    data: { joinToken: facilitator.joinToken, action: "FINISH" },
  });
  await query(
    `UPDATE "Session"
     SET "status"='COMPLETED',
         "negotiationState"='FINISHED',
         "roomLifecycle"='CLOSED',
         "negotiationEndedAt"=COALESCE("negotiationEndedAt", NOW()),
         "updatedAt"=NOW()
     WHERE "id"=$1`,
    [session.id],
  );

  const rejoinResponse = await request.post("/api/rejoin/validate", {
    headers: { Cookie: `auth_session=${authToken}` },
    data: {
      type: "SESSION_ROOM",
      sessionId: session.id,
      joinToken: igorSession.joinToken,
    },
  });
  const rejoinBody = await rejoinResponse.json();
  expect(rejoinBody.valid).toBe(true);
  expect(rejoinBody.primaryAction).toBe("materials");
  expect(rejoinBody.targetUrl).toContain(`/join/${igorSession.joinToken}`);
  expect(rejoinBody.targetUrl).not.toContain(`/room/${session.id}`);
});
