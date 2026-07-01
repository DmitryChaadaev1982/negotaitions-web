import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  countEventParticipants,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  getEventParticipants,
  getSession,
  getTrainingEvent,
  participantByName,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

async function createUserSessionCookie(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,NOW() + INTERVAL '30 days',NOW())`,
    [userId, tokenHash],
  );
  return `auth_session=${rawToken}`;
}

test("account-first join redirects unauth users and prevents duplicate event participants", async ({
  page,
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Club Event Rejoin" });
  await query(`UPDATE "TrainingEvent" SET "visibility"='PUBLIC' WHERE "id"=$1`, [event.id]);
  const user = await createActiveUser();
  const authCookie = await createUserSessionCookie(user.id);

  await page.goto(`/events/${event.id}/join`);
  await expect(page).toHaveURL(new RegExp(`/login\\?returnUrl=.*events%2F${event.id}%2Fjoin`));

  const stateBefore = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: authCookie },
  });
  expect(stateBefore.ok()).toBeTruthy();
  await expect.poll(async () => countEventParticipants(event.id)).toBe(1);

  const stateAfter = await request.get(`/api/events/${event.id}/state`, {
    headers: { Cookie: authCookie },
  });
  expect(stateAfter.ok()).toBeTruthy();
  await expect.poll(async () => countEventParticipants(event.id)).toBe(1);

  const participants = await getEventParticipants(event.id);
  expect(participants).toHaveLength(1);
  expect(participants[0]?.displayName).toBeTruthy();
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

