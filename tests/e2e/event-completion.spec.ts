import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  countTranscripts,
  createE2eCase,
  createE2eEvent,
  forceSessionRunningForE2e,
  getEventParticipants,
  getExternalServiceEvent,
  getRecordingBySession,
  getRecordingStopOperations,
  getSessionNegotiationState,
  getTrainingEvent,
  participantByName,
  upsertRecordingForSession,
} from "./helpers/db";

// Stage 3.10 traceability:
// ST310-EVENT-001..010, ST310-NAV-005, ST310-RACE-007, ST310-RACE-010

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

async function createEventSession(request: import("@playwright/test").APIRequestContext) {
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

  const body = (await createResponse.json()) as {
    session: { id: string };
  };

  return { event, sessionId: body.session.id, participants };
}

test("complete event from lobby closes event and disables session creation @browser-smoke", async ({
  page,
  request,
}) => {
  const { event, participants } = await createEventSession(request);
  const host = participantByName(participants, "Dmitry");

  await page.goto(
    `/events/${event.id}/lobby?hostToken=${encodeURIComponent(event.hostToken)}&participantToken=${encodeURIComponent(host.participantToken)}`,
  );

  await expect(page.getByTestId("complete-event-button")).toBeVisible();
  await page.getByTestId("complete-event-button").click();
  await page.getByTestId("confirm-complete-event-button").click();

  await expect(
    page.getByText(/completed by the host|завершена организатором/i),
  ).toBeVisible();

  const updatedEvent = await getTrainingEvent(event.id);
  expect(updatedEvent.status).toBe("COMPLETED");
  expect(updatedEvent.completedAt).not.toBeNull();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createResponse.status()).toBe(409);
});

test("complete event closes preparation session without recording", async ({
  request,
}) => {
  const { event, sessionId } = await createEventSession(request);

  const completeResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeResponse.ok()).toBeTruthy();

  const session = await getSessionNegotiationState(sessionId);
  expect(session.negotiationState).toBe("FINISHED");
  expect(session.roomLifecycle).toBe("CLOSED");
  expect(session.closeReason).toBe("EVENT_COMPLETED");
  expect(session.negotiationStartedAt).toBeNull();

  const recording = await getRecordingBySession(sessionId);
  expect(recording).toBeNull();
});

test("complete event closes running session and stops active recording [ST310-EVENT-004]", async ({
  request,
}) => {
  const { event, sessionId } = await createEventSession(request);
  await forceSessionRunningForE2e(sessionId);

  await upsertRecordingForSession({
    sessionId,
    status: "RECORDING",
    provider: "LIVEKIT_CLOUD",
    egressId: `mock-egress-${sessionId}`,
  });

  const recordingBefore = await getRecordingBySession(sessionId);
  expect(recordingBefore?.status).toBe("RECORDING");

  const completeResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeResponse.ok()).toBeTruthy();

  const session = await getSessionNegotiationState(sessionId);
  expect(session.negotiationState).toBe("FINISHED");
  expect(session.roomLifecycle).toBe("CLOSED");
  expect(session.closeReason).toBe("EVENT_COMPLETED");

  const recording = await getRecordingBySession(sessionId);
  expect(recording).not.toBeNull();
  expect(["PROCESSING", "STOPPED", "COMPLETED"]).toContain(recording?.status);
  const stopOperations = await getRecordingStopOperations(sessionId);
  expect(stopOperations.length).toBe(1);
  expect(["DELIVERED", "FAILED"]).toContain(stopOperations[0]!.state);

  const transcriptCount = await countTranscripts(sessionId);
  expect(transcriptCount).toBe(0);
});

test("recording stop failure still completes event", async ({ request }) => {
  const { event, sessionId } = await createEventSession(request);
  await forceSessionRunningForE2e(sessionId);
  await upsertRecordingForSession({
    sessionId,
    status: "RECORDING",
    provider: "LIVEKIT_CLOUD",
    egressId: `mock-egress-${sessionId}`,
  });

  await request.post("/api/test/mock-external-service", {
    data: { service: "LIVEKIT", error: "NETWORK_ERROR" },
  });

  const completeResponse = await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });
  expect(completeResponse.ok()).toBeTruthy();

  const body = await completeResponse.json();
  expect(body.eventStatus).toBe("COMPLETED");

  const updatedEvent = await getTrainingEvent(event.id);
  expect(updatedEvent.status).toBe("COMPLETED");

  const externalEvent = await getExternalServiceEvent(sessionId, "LIVEKIT");
  expect(externalEvent).not.toBeNull();
  const stopOperations = await getRecordingStopOperations(sessionId);
  expect(stopOperations.length).toBe(1);
});

test("rejoin after event completed denies lobby and redirects to login [ST310-NAV-005]", async ({
  page,
  request,
}) => {
  const { event, participants } = await createEventSession(request);
  const igor = participantByName(participants, "Igor");

  await request.post(`/api/events/${event.id}/complete`, {
    data: { hostToken: event.hostToken },
  });

  await page.goto(
    `/events/${event.id}/lobby?participantToken=${encodeURIComponent(igor.participantToken)}`,
  );

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /welcome back|вход/i })).toBeVisible();
});
