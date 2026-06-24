import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  createE2eEvent,
  getEventParticipants,
  getSession,
  participantByName,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

async function createAssignedSession(request: APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  if (!buyerRole || !sellerRole) {
    throw new Error("E2E case roles were not created.");
  }

  const assignmentDraft = {
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: alex.id,
    },
    observerEventParticipantIds: [serg.id],
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };

  await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
    },
  });

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
  const { event, session, igorEvent, igorSession } =
    await createAssignedSession(request);

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

  const roomUrl = `/room/${session.id}?joinToken=${encodeURIComponent(igorSession.joinToken)}`;
  await page.goto(roomUrl);
  await expect(page).toHaveURL(new RegExp(`/room/${session.id}\\?joinToken=`));
  await expect(page.getByText(/Connecting to video room/i)).toBeVisible({
    timeout: 15000,
  });

  await page.goto(`/join/${igorSession.joinToken}`);
  await expect(page.getByRole("heading", { name: "Session materials" })).toBeVisible();
  await expect(page.getByText("E2E_PRIVATE_IGOR_ONLY")).toBeVisible();
  await expect(page.getByRole("link", { name: "Join video room" })).toHaveAttribute(
    "href",
    roomUrl,
  );
});

test("finished session rejoin routes to materials", async ({ request }) => {
  const { session, igorSession } = await createAssignedSession(request);
  const facilitator = participantByName(session.participants, "Dmitry");

  await request.post(`/api/sessions/${session.id}/control`, {
    data: { joinToken: facilitator.joinToken, action: "SKIP_PREPARATION" },
  });
  await request.post(`/api/sessions/${session.id}/control`, {
    data: { joinToken: facilitator.joinToken, action: "START" },
  });
  await request.post(`/api/sessions/${session.id}/control`, {
    data: { joinToken: facilitator.joinToken, action: "FINISH" },
  });

  const rejoinResponse = await request.post("/api/rejoin/validate", {
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
