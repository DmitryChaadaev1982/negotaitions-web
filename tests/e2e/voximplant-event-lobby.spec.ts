import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  getEventParticipants,
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

test("event lobby lease: newest connection wins for same login", async ({
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Vox Lobby Lease" });
  await query(`UPDATE "TrainingEvent" SET "visibility"='PUBLIC' WHERE "id"=$1`, [event.id]);
  const user = await createActiveUser();
  const authCookie = await createUserSessionCookie(user.id);
  await query(
    `INSERT INTO "EventInvite" ("id","eventId","userId","invitedByUserId","createdAt")
     VALUES (gen_random_uuid(),$1,$2,$2,NOW())`,
    [event.id, user.id],
  );

  const stateAClaim = await request.get(
    `/api/events/${event.id}/state?connectionId=lease-a&claimLease=1`,
    {
      headers: { Cookie: authCookie },
    },
  );
  expect(stateAClaim.status()).toBe(200);

  const stateBClaim = await request.get(
    `/api/events/${event.id}/state?connectionId=lease-b&claimLease=1`,
    {
      headers: { Cookie: authCookie },
    },
  );
  expect(stateBClaim.status()).toBe(200);

  const stateAStale = await request.get(
    `/api/events/${event.id}/state?connectionId=lease-a`,
    {
      headers: { Cookie: authCookie },
    },
  );
  expect(stateAStale.status()).toBe(409);
  const stalePayload = (await stateAStale.json()) as { code?: string };
  expect(stalePayload.code).toBe("STALE_CONNECTION");
});

test("event lobby stale lease blocks participant/host/voximplant actions", async ({
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Vox Lobby Stale Action Block" });
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
     VALUES ($1,$2,'hash','Stale Owner','PARTICIPANT','USER','ACTIVE','en',NOW())
     ON CONFLICT ("id") DO NOTHING`,
    ["e2e_stale_owner", "e2e_stale_owner@test.local"],
  );
  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, "e2e_stale_owner"],
  );
  const authCookie = await createUserSessionCookie("e2e_stale_owner");
  await query(`DELETE FROM "EventParticipant" WHERE "eventId"=$1`, [event.id]);
  await query(
    `INSERT INTO "EventParticipant"
       ("id","eventId","userId","displayName","participantToken","isHost","joinedAt","lastSeenAt","createdAt","updatedAt")
     VALUES
       (gen_random_uuid(),$1,$2,'Stale Owner',gen_random_uuid()::text,true,NOW(),NOW(),NOW(),NOW()),
       (gen_random_uuid(),$1,$2,'Stale Owner Duplicate',gen_random_uuid()::text,false,NOW(),NOW(),NOW(),NOW())`,
    [event.id, "e2e_stale_owner"],
  );

  const claimA = await request.get(
    `/api/events/${event.id}/state?connectionId=stale-a&claimLease=1`,
    { headers: { Cookie: authCookie } },
  );
  expect(claimA.status()).toBe(200);

  const claimB = await request.get(
    `/api/events/${event.id}/state?connectionId=stale-b&claimLease=1`,
    { headers: { Cookie: authCookie } },
  );
  expect(claimB.status()).toBe(200);

  const staleParticipant = await request.patch(`/api/events/${event.id}/participant`, {
    headers: { Cookie: authCookie },
    data: { connectionId: "stale-a", preference: "PLAY" },
  });
  expect(staleParticipant.status()).toBe(409);
  expect(((await staleParticipant.json()) as { code?: string }).code).toBe(
    "STALE_CONNECTION",
  );

  const staleHostPatch = await request.patch(`/api/events/${event.id}/host`, {
    headers: { Cookie: authCookie },
    data: { connectionId: "stale-a", selectedCaseId: null },
  });
  expect(staleHostPatch.status()).toBe(409);
  expect(((await staleHostPatch.json()) as { code?: string }).code).toBe(
    "STALE_CONNECTION",
  );

  const staleHostCreate = await request.post(`/api/events/${event.id}/host`, {
    headers: { Cookie: authCookie },
    data: { connectionId: "stale-a" },
  });
  expect(staleHostCreate.status()).toBe(409);
  expect(((await staleHostCreate.json()) as { code?: string }).code).toBe(
    "STALE_CONNECTION",
  );

  const staleVox = await request.post(`/api/events/${event.id}/voximplant-access`, {
    headers: { Cookie: authCookie },
    data: { connectionId: "stale-a" },
  });
  expect(staleVox.status()).toBe(409);
  expect(((await staleVox.json()) as { code?: string }).code).toBe("STALE_CONNECTION");
});

test("event lobby participant list payload is deduped by user identity", async ({
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Vox Lobby Identity Dedupe" });
  const user = await createActiveUser();
  const authCookie = await createUserSessionCookie(user.id);
  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, user.id],
  );
  await query(`DELETE FROM "EventParticipant" WHERE "eventId"=$1`, [event.id]);
  await query(
    `INSERT INTO "EventParticipant"
       ("id","eventId","userId","displayName","participantToken","isHost","preference","joinedAt","lastSeenAt","createdAt","updatedAt")
     VALUES
       (gen_random_uuid(),$1,$2,'Primary Name',gen_random_uuid()::text,true,'UNDECIDED',NOW(),NOW(),NOW(),NOW()),
       (gen_random_uuid(),$1,$2,'Duplicate Name',gen_random_uuid()::text,false,'OBSERVE',NOW(),NOW() - INTERVAL '5 minutes',NOW() - INTERVAL '5 minutes',NOW() - INTERVAL '5 minutes')`,
    [event.id, user.id],
  );

  const state = await request.get(
    `/api/events/${event.id}/state?connectionId=dedupe-a&claimLease=1`,
    { headers: { Cookie: authCookie } },
  );
  expect(state.status()).toBe(200);
  const payload = (await state.json()) as {
    currentParticipant: { id: string } | null;
    participants: Array<{ id: string; displayName: string }>;
  };

  expect(payload.currentParticipant).toBeTruthy();
  expect(payload.participants).toHaveLength(1);
  expect(payload.participants[0]?.id).toBe(payload.currentParticipant?.id);
});

test("voximplant provider path is present and livekit path is isolated", async ({
  request,
}) => {
  const event = await createE2eEvent({ title: "E2E Vox Lobby Provider Path" });
  await query(`UPDATE "TrainingEvent" SET "visibility"='PUBLIC' WHERE "id"=$1`, [event.id]);
  const user = await createActiveUser();
  const authCookie = await createUserSessionCookie(user.id);
  await query(
    `INSERT INTO "EventInvite" ("id","eventId","userId","invitedByUserId","createdAt")
     VALUES (gen_random_uuid(),$1,$2,$2,NOW())`,
    [event.id, user.id],
  );

  const voxAccess = await request.post(`/api/events/${event.id}/voximplant-access`, {
    headers: { Cookie: authCookie },
    data: { connectionId: "vox-provider-check", claimLease: true },
  });
  expect([200, 403, 409, 501, 503]).toContain(voxAccess.status());

  if ((process.env.VIDEO_PROVIDER ?? "").trim().toLowerCase() === "voximplant") {
    const liveKitToken = await request.post(`/api/events/${event.id}/livekit-token`, {
      headers: { Cookie: authCookie },
      data: { connectionId: "vox-provider-check", claimLease: true },
    });
    expect(liveKitToken.status()).toBe(409);
    const payload = (await liveKitToken.json()) as { code?: string };
    expect(payload.code).toBe("LIVEKIT_LOBBY_DISABLED");
  }
});

test("session creation from event preserves role assignment and account room path", async ({
  request,
}) => {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true, title: "E2E Vox Event Session Flow" });
  await query(`UPDATE "TrainingEvent" SET "visibility"='PUBLIC' WHERE "id"=$1`, [event.id]);
  const participants = await getEventParticipants(event.id);
  const dmitry = participants.find((participant) => participant.displayName === "Dmitry");
  const igor = participants.find((participant) => participant.displayName === "Igor");
  const alex = participants.find((participant) => participant.displayName === "Alex");
  const serg = participants.find((participant) => participant.displayName === "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  expect(dmitry && igor && alex && serg && buyerRole && sellerRole).toBeTruthy();

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      connectionId: "host-owner-tab",
      assignmentDraft: {
        facilitatorEventParticipantId: dmitry!.id,
        roleAssignments: {
          [buyerRole!.id]: igor!.id,
          [sellerRole!.id]: alex!.id,
        },
        observerEventParticipantIds: [serg!.id],
        roomLabel: "Vox Event Room",
        preparationDurationMinutes: 5,
        negotiationDurationMinutes: 15,
      },
    },
  });
  expect(patchResponse.ok()).toBeTruthy();

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken, connectionId: "host-owner-tab" },
  });
  expect(createResponse.ok()).toBeTruthy();
  const payload = (await createResponse.json()) as {
    state: {
      participants: Array<{ id: string; assignedSessionId: string | null; roomUrl: string | null }>;
    };
  };
  const igorState = payload.state.participants.find((participant) => participant.id === igor!.id);
  expect(igorState?.assignedSessionId).toBeTruthy();
  expect(igorState?.roomUrl).toContain(`/room/${igorState?.assignedSessionId}`);
});

test("lobby camera busy path reports localized warning key and keeps controls shared", async () => {
  const lobbySource = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  const viewSource = readFileSync("components/event-lobby-view.tsx", "utf-8");
  const roomLayoutSource = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  expect(lobbySource).toContain("onDeviceWarning?.(\"cameraBusyOrUnavailable\")");
  expect(lobbySource).toContain("VoximplantMediaControls");
  expect(lobbySource).toContain("VoximplantParticipantTile");
  expect(roomLayoutSource).toContain("VoximplantParticipantTile");
  expect(lobbySource).toContain("micState");
  expect(lobbySource).toContain("room.unknownMicState");
  expect(viewSource).toContain("events.cameraBusyOrUnavailable");
});
