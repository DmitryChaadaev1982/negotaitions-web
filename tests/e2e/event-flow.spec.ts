import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  countEventParticipants,
  createE2eCase,
  createE2eEvent,
  getEventParticipants,
  getSession,
  getTrainingEvent,
  participantByName,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test("event lobby join and rejoin do not duplicate participant", async ({
  page,
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Club Event Rejoin" });

  await page.goto(`/events/join/${event.publicJoinCode}`);
  await page.getByTestId("event-join-name-input").fill("Igor");
  await page.locator('input[name="preference"][value="PLAY"]').check();
  await page.getByTestId("join-event-button").click();

  await expect(page).toHaveURL(new RegExp(`/events/${event.id}/lobby`));
  await expect
    .poll(async () => countEventParticipants(event.id))
    .toBe(1);

  const [igor] = await getEventParticipants(event.id);
  expect(igor?.displayName).toBe("Igor");

  const validationResponse = await request.post("/api/rejoin/validate", {
    data: {
      type: "EVENT_LOBBY",
      eventId: event.id,
      participantToken: igor!.participantToken,
    },
  });
  const validation = await validationResponse.json();
  expect(validation.valid).toBe(true);

  await page.evaluate(
    ({ eventId, participantToken }) => {
      window.localStorage.setItem(
        "negotaitions.recovery.v1",
        JSON.stringify({
          type: "EVENT_LOBBY",
          eventId,
          participantToken,
          displayName: "Igor",
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    { eventId: event.id, participantToken: igor!.participantToken },
  );

  await page.reload();
  await expect
    .poll(async () => countEventParticipants(event.id))
    .toBe(1);

  await expect
    .poll(async () => countEventParticipants(event.id))
    .toBe(1);
});

test("event session keeps event, preparation, and negotiation durations separate", async ({
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

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

  const body = (await createResponse.json()) as {
    session: { id: string };
    state: unknown;
  };

  const [updatedEvent, session] = await Promise.all([
    getTrainingEvent(event.id),
    getSession(body.session.id),
  ]);

  expect(updatedEvent.estimatedEventDurationSeconds).toBe(90 * 60);
  expect(session.eventId).toBe(event.id);
  expect(session.preparationDurationSeconds).toBe(5 * 60);
  expect(session.durationSeconds).toBe(15 * 60);
  expect(session.durationSeconds).not.toBe(updatedEvent.estimatedEventDurationSeconds);
  expect(session.snapshotCaseTitle).toBe(negotiationCase.title);
  expect(session.sessionRoles).toHaveLength(2);

  const sessionParticipants = session.participants;
  expect(participantByName(sessionParticipants, "Dmitry").type).toBe("FACILITATOR");
  expect(participantByName(sessionParticipants, "Igor").sessionRole?.name).toBe("Buyer");
  expect(participantByName(sessionParticipants, "Alex").sessionRole?.name).toBe("Seller");
  expect(participantByName(sessionParticipants, "Serg").type).toBe("OBSERVER");

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  const stateText = await stateResponse.text();
  expect(stateText).not.toContain("E2E_PRIVATE_IGOR_ONLY");
  expect(stateText).not.toContain("E2E_PRIVATE_ALEX_ONLY");
});

