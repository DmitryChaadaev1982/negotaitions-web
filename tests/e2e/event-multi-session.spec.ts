import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  createE2eEvent,
  e2eRoleMarkers,
  getEventParticipants,
  getSession,
  participantByName,
  query,
} from "./helpers/db";

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

async function addEventParticipant(eventId: string, name: string, preference = "PLAY") {
  const token = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await query(
    `INSERT INTO "EventParticipant"
      ("id", "eventId", "displayName", "participantToken", "preference",
       "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate",
       "joinedAt", "lastSeenAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, false, $6, false, $7, NOW(), NOW(), NOW())`,
    [
      `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventId,
      name,
      token,
      preference,
      preference === "PLAY",
      preference === "FACILITATE",
    ],
  );
}

async function createEventSession(
  request: import("@playwright/test").APIRequestContext,
  input: {
    eventId: string;
    hostToken: string;
    caseId: string;
    roomLabel: string;
    facilitatorEventParticipantId: string;
    roleAssignments: Array<{ caseRoleId: string; eventParticipantId: string }>;
  },
) {
  const response = await request.post(`/api/events/${input.eventId}/host`, {
    data: {
      hostToken: input.hostToken,
      caseId: input.caseId,
      roomLabel: input.roomLabel,
      preparationDurationSeconds: 120,
      negotiationDurationSeconds: 300,
      facilitatorEventParticipantId: input.facilitatorEventParticipantId,
      roleAssignments: input.roleAssignments,
      observerEventParticipantIds: [],
    },
  });

  return response;
}

test("event supports multiple sessions and active assignment rules", async ({
  page,
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const event = await createE2eEvent({ withParticipants: true });

  await addEventParticipant(event.id, "Masha");
  await addEventParticipant(event.id, "Olga", "FACILITATE");

  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const masha = participantByName(participants, "Masha");
  const olga = participantByName(participants, "Olga");

  const session1Response = await createEventSession(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room A",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: buyerRole.id, eventParticipantId: igor.id },
      { caseRoleId: sellerRole.id, eventParticipantId: alex.id },
    ],
  });
  expect(session1Response.ok()).toBeTruthy();
  const session1Body = (await session1Response.json()) as {
    session: { id: string };
  };

  const duplicateResponse = await createEventSession(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Duplicate Room",
    facilitatorEventParticipantId: olga.id,
    roleAssignments: [
      { caseRoleId: buyerRole.id, eventParticipantId: igor.id },
      { caseRoleId: sellerRole.id, eventParticipantId: serg.id },
    ],
  });
  expect(duplicateResponse.status()).toBe(400);
  await expect(duplicateResponse.json()).resolves.toMatchObject({
    error: "participantAlreadyAssigned",
  });

  const session2Response = await createEventSession(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room B",
    facilitatorEventParticipantId: olga.id,
    roleAssignments: [
      { caseRoleId: buyerRole.id, eventParticipantId: serg.id },
      { caseRoleId: sellerRole.id, eventParticipantId: masha.id },
    ],
  });
  expect(session2Response.ok()).toBeTruthy();
  const session2Body = (await session2Response.json()) as {
    session: { id: string };
  };

  const hostStateResponse = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  const hostState = await hostStateResponse.json();
  expect(hostState.sessions).toHaveLength(2);

  await page.goto(`/events/${event.id}/lobby?hostToken=${event.hostToken}`);
  await expect(page.getByTestId("event-session-card")).toHaveCount(2);

  const igorStateResponse = await request.get(
    `/api/events/${event.id}/state?participantToken=${igor.participantToken}`,
  );
  const igorState = await igorStateResponse.json();
  const igorSession = igorState.sessions.find(
    (session: { id: string }) => session.id === session1Body.session.id,
  );
  const otherSession = igorState.sessions.find(
    (session: { id: string }) => session.id === session2Body.session.id,
  );
  expect(igorState.participants.find((item: { id: string }) => item.id === igor.id).assignedSessionId).toBe(
    session1Body.session.id,
  );
  expect(igorSession.roomUrl).toContain(`/room/${session1Body.session.id}`);
  expect(otherSession.roomUrl).toBeNull();

  await page.goto(igorSession.roomUrl);
  await expect(page).toHaveURL(new RegExp(`/room/${session1Body.session.id}`));

  const session1 = await getSession(session1Body.session.id);
  const dmitrySessionParticipant = participantByName(session1.participants, "Dmitry");
  await request.post(`/api/sessions/${session1Body.session.id}/control`, {
    data: { joinToken: dmitrySessionParticipant.joinToken, action: "FINISH" },
  });

  const session3Response = await createEventSession(request, {
    eventId: event.id,
    hostToken: event.hostToken,
    caseId: negotiationCase.id,
    roomLabel: "Room C",
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: [
      { caseRoleId: buyerRole.id, eventParticipantId: igor.id },
      { caseRoleId: sellerRole.id, eventParticipantId: alex.id },
    ],
  });
  expect(session3Response.ok()).toBeTruthy();

  const session3Body = (await session3Response.json()) as {
    session: { id: string };
  };
  const session3 = await getSession(session3Body.session.id);
  const igorSession3Participant = participantByName(session3.participants, "Igor");

  await page.goto(`/join/${igorSession3Participant.joinToken}`);
  await expect(page.getByText(e2eRoleMarkers.igor)).toBeVisible();
  await expect(page.getByText(e2eRoleMarkers.alex)).not.toBeVisible();
});
