import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  e2eId,
  forceSessionRunningForE2e,
  query,
} from "./helpers/db";
import { ParticipantType } from "@/app/generated/prisma/enums";
import {
  isMediaStatusCurrentForConnection,
  type SessionMediaStatusRecord,
} from "@/lib/voximplant/reconnect-media-state";

test.describe.configure({ mode: "serial" });

async function cleanupReconnectMediaData() {
  const sessions = await query<{ id: string }>(
    `SELECT "id"
     FROM "Session"
     WHERE "title" LIKE 'Stage 3.12B Reconnect Media%'`,
  );
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length > 0) {
    await query(`DELETE FROM "AppSetting" WHERE "key" = ANY($1)`, [
      sessionIds.map((sessionId) => `voximplant:session-media-status:${sessionId}`),
    ]);
    await query(`DELETE FROM "Session" WHERE "id" = ANY($1)`, [sessionIds]);
  }
}

async function createReconnectFixture() {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const participantAUser = await createActiveUser({ preferredLocale: "en" });
  const participantBUser = await createActiveUser({ preferredLocale: "en" });
  const observerUser = await createActiveUser({ preferredLocale: "en" });
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const sessionId = e2eId("stage-312b-reconnect-media-session");
  const facilitatorId = e2eId("stage-312b-reconnect-media-facilitator");
  const participantAId = e2eId("stage-312b-reconnect-media-a");
  const participantBId = e2eId("stage-312b-reconnect-media-b");
  const observerId = e2eId("stage-312b-reconnect-media-observer");
  const roleAId = e2eId("stage-312b-reconnect-media-role-a");
  const roleBId = e2eId("stage-312b-reconnect-media-role-b");

  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","title","roomLabel",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,'Stage 3.12B Reconnect Media Session','Reconnect Media Room',
        'Stage 3.12B Reconnect Case','Business context','Public instructions','EN',300,900,NOW())`,
    [sessionId, negotiationCase.id, facilitatorUser.id],
  );
  await query(
    `INSERT INTO "SessionRole"
       ("id","sessionId","name","privateInstructions","objectives","constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
       ($1,$3,$4,'Buyer private','Buyer objective','Buyer constraints','Buyer hidden','Buyer fallback',0,NOW()),
       ($2,$3,$5,'Seller private','Seller objective','Seller constraints','Seller hidden','Seller fallback',1,NOW())`,
    [roleAId, roleBId, sessionId, buyerRole?.name ?? "Buyer", sellerRole?.name ?? "Seller"],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id","sessionId","userId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
     VALUES
       ($1,$5,$6,NULL,'FACILITATOR',$10,'Dmitry','',NOW()),
       ($2,$5,$7,$11,'PARTICIPANT',$12,'Igor','',NOW()),
       ($3,$5,$8,$13,'PARTICIPANT',$14,'Alex','',NOW()),
       ($4,$5,$9,NULL,'OBSERVER',$15,'Test','',NOW())`,
    [
      facilitatorId,
      participantAId,
      participantBId,
      observerId,
      sessionId,
      facilitatorUser.id,
      participantAUser.id,
      participantBUser.id,
      observerUser.id,
      `reconnect-fac-${sessionId}`,
      roleAId,
      `reconnect-a-${sessionId}`,
      roleBId,
      `reconnect-b-${sessionId}`,
      `reconnect-observer-${sessionId}`,
    ],
  );
  await forceSessionRunningForE2e(sessionId);

  return {
    sessionId,
    facilitator: {
      participantId: facilitatorId,
      userId: facilitatorUser.id,
      role: ParticipantType.FACILITATOR,
    },
    participantA: {
      participantId: participantAId,
      userId: participantAUser.id,
      role: ParticipantType.PARTICIPANT,
    },
    participantB: {
      participantId: participantBId,
      userId: participantBUser.id,
      role: ParticipantType.PARTICIPANT,
    },
    observer: {
      participantId: observerId,
      userId: observerUser.id,
      role: ParticipantType.OBSERVER,
    },
  };
}

async function claimConnection(input: {
  sessionId: string;
  userId: string;
  role: ParticipantType;
  connectionId: string;
}) {
  await query(
    `UPDATE "SessionRoomConnection"
     SET "supersededAt"=NOW(),"supersededByConnectionId"=$3,"updatedAt"=NOW()
     WHERE "sessionId"=$1
       AND "userId"=$2
       AND "connectionId" <> $3
       AND "disconnectedAt" IS NULL
       AND "supersededAt" IS NULL
       AND "revokedAt" IS NULL`,
    [input.sessionId, input.userId, input.connectionId],
  );
  await query(
    `INSERT INTO "SessionRoomConnection"
       ("id","sessionId","userId","connectionId","role","leaseVersion","expiresAt","createdAt","updatedAt")
     VALUES (gen_random_uuid(),$1,$2,$3,$4,1,NOW() + INTERVAL '2 minutes',NOW(),NOW())
     ON CONFLICT ("connectionId") DO UPDATE
       SET "expiresAt"=NOW() + INTERVAL '2 minutes',
           "disconnectedAt"=NULL,
           "supersededAt"=NULL,
           "revokedAt"=NULL,
           "updatedAt"=NOW()`,
    [input.sessionId, input.userId, input.connectionId, input.role],
  );
}

async function publishMediaStatus(input: {
  sessionId: string;
  participantId: string;
  userId: string;
  role: ParticipantType;
  connectionId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
}) {
  await claimConnection(input);
  const key = `voximplant:session-media-status:${input.sessionId}`;
  const rows = await query<{ value: string | null }>(
    `SELECT "value" FROM "AppSetting" WHERE "key"=$1`,
    [key],
  );
  const doc = rows[0]?.value
    ? JSON.parse(rows[0].value) as {
        version: 1;
        participants: Record<string, SessionMediaStatusRecord>;
      }
    : { version: 1 as const, participants: {} };
  doc.participants[input.participantId] = {
    connectionId: input.connectionId,
    micEnabled: input.micEnabled,
    cameraEnabled: input.cameraEnabled,
    updatedAt: new Date().toISOString(),
  };
  await query(
    `INSERT INTO "AppSetting" ("key","value","updatedAt")
     VALUES ($1,$2,NOW())
     ON CONFLICT ("key") DO UPDATE SET "value"=$2,"updatedAt"=NOW()`,
    [key, JSON.stringify(doc)],
  );
}

async function readVisibleMediaStatus(input: {
  sessionId: string;
  participantId: string;
  userId: string;
}) {
  const activeRows = await query<{ connectionId: string | null }>(
    `SELECT "connectionId"
     FROM "SessionRoomConnection"
     WHERE "sessionId"=$1
       AND "userId"=$2
       AND "disconnectedAt" IS NULL
       AND "supersededAt" IS NULL
       AND "revokedAt" IS NULL
       AND "expiresAt" > NOW()
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    [input.sessionId, input.userId],
  );
  const activeConnectionId = activeRows[0]?.connectionId ?? null;
  const key = `voximplant:session-media-status:${input.sessionId}`;
  const rows = await query<{ value: string | null }>(
    `SELECT "value" FROM "AppSetting" WHERE "key"=$1`,
    [key],
  );
  const doc = rows[0]?.value
    ? JSON.parse(rows[0].value) as {
        version: 1;
        participants: Record<string, SessionMediaStatusRecord>;
      }
    : { version: 1 as const, participants: {} };
  const mediaStatus = doc.participants[input.participantId] ?? null;
  if (!isMediaStatusCurrentForConnection(mediaStatus, activeConnectionId)) {
    return {
      logicalConnectionId: activeConnectionId,
      micEnabled: undefined as boolean | undefined,
      cameraEnabled: undefined as boolean | undefined,
    };
  }
  return {
    logicalConnectionId: activeConnectionId,
    micEnabled: mediaStatus.micEnabled,
    cameraEnabled: mediaStatus.cameraEnabled,
  };
}

async function claimAndReadMediaStatus(input: {
  sessionId: string;
  participantId: string;
  userId: string;
  role: ParticipantType;
  connectionId: string;
}) {
  await claimConnection(input);
  return readVisibleMediaStatus(input);
}

async function activeConnectionCount(input: {
  sessionId: string;
  userId: string;
}) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SessionRoomConnection"
     WHERE "sessionId"=$1
       AND "userId"=$2
       AND "disconnectedAt" IS NULL
       AND "supersededAt" IS NULL
       AND "revokedAt" IS NULL
       AND "expiresAt" > NOW()`,
    [input.sessionId, input.userId],
  );
  return Number(rows[0]?.count ?? "0");
}

type VisibleMediaStatus = Awaited<ReturnType<typeof claimAndReadMediaStatus>>;

function expectVisibleMediaStatus(
  entry: VisibleMediaStatus,
  expected: {
    micEnabled?: boolean;
    cameraEnabled?: boolean;
    logicalConnectionId?: string;
  },
) {
  if ("logicalConnectionId" in expected) {
    expect(entry.logicalConnectionId).toBe(expected.logicalConnectionId);
  }
  if ("micEnabled" in expected) {
    expect(entry.micEnabled).toBe(expected.micEnabled);
  }
  if ("cameraEnabled" in expected) {
    expect(entry.cameraEnabled).toBe(expected.cameraEnabled);
  }
}

test.beforeEach(async () => {
  await cleanupReconnectMediaData();
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupReconnectMediaData();
  await cleanupE2eData();
});

test("observer reconnect ignores old enabled state and accepts current muted state", async () => {
  const fixture = await createReconnectFixture();
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    userId: fixture.observer.userId,
    role: fixture.observer.role,
    connectionId: "observer-old",
    micEnabled: true,
    cameraEnabled: true,
  });

  const afterReconnect = await claimAndReadMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    userId: fixture.observer.userId,
    role: fixture.observer.role,
    connectionId: "observer-new",
  });
  expectVisibleMediaStatus(afterReconnect, {
    logicalConnectionId: "observer-new",
    micEnabled: undefined,
    cameraEnabled: undefined,
  });

  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    userId: fixture.observer.userId,
    role: fixture.observer.role,
    connectionId: "observer-new",
    micEnabled: false,
    cameraEnabled: true,
  });
  const current = await readVisibleMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    userId: fixture.observer.userId,
  });
  expectVisibleMediaStatus(current, {
    logicalConnectionId: "observer-new",
    micEnabled: false,
    cameraEnabled: true,
  });
});

test("facilitator reconnect ignores old state, then enabled state is visible", async () => {
  const fixture = await createReconnectFixture();
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "facilitator-old",
    micEnabled: true,
    cameraEnabled: true,
  });
  const afterReconnect = await claimAndReadMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "facilitator-new",
  });
  expectVisibleMediaStatus(afterReconnect, { micEnabled: undefined });

  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "facilitator-new",
    micEnabled: false,
    cameraEnabled: true,
  });
  const muted = await claimAndReadMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "facilitator-new",
  });
  expectVisibleMediaStatus(muted, { micEnabled: false });

  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "facilitator-new",
    micEnabled: true,
    cameraEnabled: true,
  });
  const enabled = await readVisibleMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
  });
  expectVisibleMediaStatus(enabled, { micEnabled: true });
});

test("participant reconnect media state is scoped to each current connection", async () => {
  const fixture = await createReconnectFixture();
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.participantA.participantId,
    userId: fixture.participantA.userId,
    role: fixture.participantA.role,
    connectionId: "participant-a-current",
    micEnabled: false,
    cameraEnabled: false,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.participantB.participantId,
    userId: fixture.participantB.userId,
    role: fixture.participantB.role,
    connectionId: "participant-b-current",
    micEnabled: true,
    cameraEnabled: true,
  });

  expectVisibleMediaStatus(
    await readVisibleMediaStatus({
      sessionId: fixture.sessionId,
      participantId: fixture.participantA.participantId,
      userId: fixture.participantA.userId,
    }),
    { micEnabled: false },
  );
  expectVisibleMediaStatus(
    await readVisibleMediaStatus({
      sessionId: fixture.sessionId,
      participantId: fixture.participantB.participantId,
      userId: fixture.participantB.userId,
    }),
    { micEnabled: true },
  );
});

test("repeated reconnect leaves one active connection and preserves camera status", async () => {
  const fixture = await createReconnectFixture();
  await claimAndReadMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "fac-repeat-1",
  });
  await claimAndReadMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "fac-repeat-2",
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.participantId,
    userId: fixture.facilitator.userId,
    role: fixture.facilitator.role,
    connectionId: "fac-repeat-2",
    micEnabled: false,
    cameraEnabled: true,
  });
  expectVisibleMediaStatus(
    await readVisibleMediaStatus({
      sessionId: fixture.sessionId,
      participantId: fixture.facilitator.participantId,
      userId: fixture.facilitator.userId,
    }),
    { micEnabled: false, cameraEnabled: true },
  );

  await expect(
    activeConnectionCount({
      sessionId: fixture.sessionId,
      userId: fixture.facilitator.userId,
    }),
  ).resolves.toBe(1);
});
