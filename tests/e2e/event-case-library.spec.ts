import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  createE2eEvent,
  e2eRoleMarkers,
  getEventParticipants,
  participantByName,
} from "./helpers/db";
import { filterEventCases } from "../../lib/event-case-search";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test("event state exposes public cases for host case library", async ({ request }) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  expect(stateResponse.ok()).toBeTruthy();

  const state = await stateResponse.json();
  expect(state.isHost).toBe(true);
  expect(state.availableCases.length).toBeGreaterThan(0);
  expect(
    state.availableCases.some(
      (item: { id: string }) => item.id === negotiationCase.id,
    ),
  ).toBe(true);

  const stateText = await stateResponse.text();
  expect(stateText).not.toContain(e2eRoleMarkers.igor);
  expect(stateText).not.toContain(e2eRoleMarkers.alex);
});

test("case library search filters public case fields", async ({ request }) => {
  const alphaCase = await createE2eCase();
  await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  const state = await stateResponse.json();

  const filtered = filterEventCases(state.availableCases, {
    query: alphaCase.title,
    language: "ALL",
    difficulty: "ALL",
  });

  expect(filtered).toHaveLength(1);
  expect(filtered[0]?.id).toBe(alphaCase.id);
  expect(filtered[0]?.businessContext).toContain("E2E public business context");
  expect(filtered[0]?.roleNames).toEqual(["Buyer", "Seller"]);
});

test("selecting a case does not create a session until host posts create", async ({
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  const state = await patchResponse.json();
  expect(state.selectedCase.id).toBe(negotiationCase.id);
  expect(state.createdSession).toBeNull();
  expect(state.assignmentDraft.preparationDurationMinutes).toBe(5);
  expect(state.assignmentDraft.negotiationDurationMinutes).toBe(15);
});

test("session creation still works after case selection and assignment", async ({
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

  const body = await createResponse.json();
  expect(body.session.id).toBeTruthy();
  expect(body.state.createdSession.id).toBe(body.session.id);
  expect(body.state.linkedSessions.length).toBeGreaterThan(0);
});

test("participant state shows selected public case without private instructions", async ({
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });

  await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
    },
  });

  const participants = await getEventParticipants(event.id);
  const igor = participantByName(participants, "Igor");

  const stateResponse = await request.get(
    `/api/events/${event.id}/state?participantToken=${igor.participantToken}`,
  );
  expect(stateResponse.ok()).toBeTruthy();

  const state = await stateResponse.json();
  expect(state.isHost).toBe(false);
  expect(state.selectedCase.title).toBe(negotiationCase.title);
  expect(state.availableCases).toEqual([]);

  const stateText = await stateResponse.text();
  expect(stateText).not.toContain(e2eRoleMarkers.igor);
  expect(stateText).not.toContain(e2eRoleMarkers.alex);
});
