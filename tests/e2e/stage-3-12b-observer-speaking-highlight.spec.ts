import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  e2eId,
  forceSessionRunningForE2e,
  getSessionNegotiationState,
  query,
} from "./helpers/db";
import { ParticipantType } from "@/app/generated/prisma/enums";
import {
  buildParticipantReconnectMediaState,
  normalizeParticipantPresenceMedia,
} from "@/lib/voximplant/participant-presence-media-model";
import {
  resolveRemoteAudioStream,
  buildRemoteAudioElementKey,
  shouldCreateRemoteAudioElement,
} from "@/lib/voximplant/remote-audio-registry";
import {
  resolveSpeakingAudioTrackId,
  resolveSpeakingSourceStream,
  shouldAttachRemoteSpeakingMeter,
} from "@/lib/voximplant/remote-speaking";
import {
  resolveTileBorderState,
  resolveTileSpeakingHighlight,
} from "@/lib/voximplant/tile-speaking-state";
import type { SessionMediaStatusRecord } from "@/lib/voximplant/reconnect-media-state";

/**
 * Stage 3.12B-W1 hotfix coverage: an observer with a current enabled audio track
 * must show the same active-speaker highlight as every other room user, in
 * RUNNING, in a paused negotiation, and in DEBRIEF_OPEN.
 *
 * Provider media is simulated deterministically (fake MediaStreams and audio
 * level events); no microphone hardware and no AudioContext are used.
 */

test.describe.configure({ mode: "serial" });

// ── Deterministic provider/media simulation ──────────────────────────────────

type FakeTrack = MediaStreamTrack & { enabled: boolean };

function fakeAudioTrack(id: string, enabled = true): FakeTrack {
  return { id, kind: "audio", enabled } as FakeTrack;
}

function fakeStream(input: { id: string; audioTracks?: FakeTrack[] }): MediaStream {
  const audioTracks = input.audioTracks ?? [];
  return {
    id: input.id,
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

/**
 * Minimal stand-in for the client-side speaking analyser: it only accepts audio
 * levels while it is bound to the current audio track and generation.
 */
class SimulatedSpeakingAnalyser {
  private speaking = false;

  constructor(
    readonly audioTrackId: string,
    readonly generation: string,
  ) {}

  emitLevel(level: number, options?: { microphoneEnabled?: boolean }) {
    if (options?.microphoneEnabled === false) {
      this.speaking = false;
      return;
    }
    if (level > 8) this.speaking = true;
    if (level < 8 * 0.6) this.speaking = false;
  }

  get isSpeaking() {
    return this.speaking;
  }
}

type SimulatedEndpoint = {
  endpointId: string;
  audioStreams: MediaStream[];
  attachedAudioStream: MediaStream | null;
  attachedElementKeys: string[];
  analysers: SimulatedSpeakingAnalyser[];
};

function createSimulatedEndpoint(endpointId: string): SimulatedEndpoint {
  return {
    endpointId,
    audioStreams: [],
    attachedAudioStream: null,
    attachedElementKeys: [],
    analysers: [],
  };
}

/** Mirrors `attachRemoteAudioStream`: publish the stream, then attach playback once. */
function remoteAudioAdded(endpoint: SimulatedEndpoint, stream: MediaStream) {
  endpoint.audioStreams = [...endpoint.audioStreams, stream];
  endpoint.attachedAudioStream = stream;
  const key = buildRemoteAudioElementKey(endpoint.endpointId, stream.id);
  if (
    shouldCreateRemoteAudioElement({
      attachedElementKeys: endpoint.attachedElementKeys,
      key,
    })
  ) {
    endpoint.attachedElementKeys = [...endpoint.attachedElementKeys, key];
  }
}

/** Mirrors `onRemoved`: release the playback element, then re-resolve audio. */
function remoteAudioRemoved(endpoint: SimulatedEndpoint, stream: MediaStream) {
  endpoint.audioStreams = endpoint.audioStreams.filter((item) => item !== stream);
  endpoint.attachedElementKeys = endpoint.attachedElementKeys.filter(
    (key) => key !== buildRemoteAudioElementKey(endpoint.endpointId, stream.id),
  );
  endpoint.attachedAudioStream = resolveRemoteAudioStream({
    endpointAudioStreams: endpoint.audioStreams,
    attachedAudioStream: null,
  });
}

/** Mirrors `applyRemoteVideoStream`: refresh must never drop a live audio stream. */
function remoteEndpointRefreshed(endpoint: SimulatedEndpoint) {
  endpoint.attachedAudioStream = resolveRemoteAudioStream({
    endpointAudioStreams: endpoint.audioStreams,
    attachedAudioStream: endpoint.attachedAudioStream,
  });
}

function attachAnalyser(endpoint: SimulatedEndpoint, generation: string) {
  const source = resolveSpeakingSourceStream({
    audioStream: endpoint.attachedAudioStream,
    videoStream: null,
  });
  const attachable = shouldAttachRemoteSpeakingMeter({
    id: endpoint.endpointId,
    stream: source,
    microphoneEnabled: true,
    generation,
  });
  const audioTrackId = resolveSpeakingAudioTrackId(source);
  if (!attachable || audioTrackId === null) return null;
  const analyser = new SimulatedSpeakingAnalyser(audioTrackId, generation);
  endpoint.analysers = [...endpoint.analysers, analyser];
  return analyser;
}

/** Mirrors one rendered tile: presence/media model → reconnect state → shared rule. */
function renderObserverTile(input: {
  endpoint: SimulatedEndpoint;
  connectionId: string;
  micEnabled: boolean;
  isSpeaking: boolean;
  speakingGeneration?: string;
  connected?: boolean;
}) {
  const audioStream = input.endpoint.attachedAudioStream;
  const mediaModel = normalizeParticipantPresenceMedia({
    displayName: "Observer",
    connectedSignal: input.connected !== false,
    allowConnectedWithoutMediaTile: true,
    lastSeenAt: null,
    videoStream: null,
    audioStream,
    micSignal: input.micEnabled ? "on" : "off",
    cameraSignal: "on",
  });
  const reconnectMediaState = buildParticipantReconnectMediaState({
    userId: "observer-user",
    role: ParticipantType.OBSERVER,
    connectionGeneration: input.connectionId,
    providerEndpointId: input.endpoint.endpointId,
    streamId: audioStream?.id ?? null,
    audioStream,
    microphoneEnabled:
      mediaModel.connectionStatus === "connected" && mediaModel.micStatus !== "unknown"
        ? mediaModel.micStatus === "on"
        : null,
    cameraEnabled: true,
    isSpeaking: input.isSpeaking,
    lastMediaUpdateAt: "2026-08-03T12:00:00.000Z",
  });
  const highlight = resolveTileSpeakingHighlight({
    connectionStatus: mediaModel.connectionStatus,
    micStatus: mediaModel.micStatus,
    audioTrackPresent: reconnectMediaState.audioTrackPresent,
    isSpeaking: input.isSpeaking,
    connectionGeneration: input.connectionId,
    speakingGeneration: input.speakingGeneration ?? input.connectionId,
  });
  return {
    borderState: resolveTileBorderState({
      connectionStatus: mediaModel.connectionStatus,
      micStatus: mediaModel.micStatus,
      isSpeaking: highlight,
    }),
    highlight,
  };
}

// ── Session fixture ──────────────────────────────────────────────────────────

async function cleanupObserverSpeakingData() {
  const sessions = await query<{ id: string }>(
    `SELECT "id"
     FROM "Session"
     WHERE "title" LIKE 'Stage 3.12B Observer Speaking%'`,
  );
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length > 0) {
    await query(`DELETE FROM "AppSetting" WHERE "key" = ANY($1)`, [
      sessionIds.map((sessionId) => `voximplant:session-media-status:${sessionId}`),
    ]);
    await query(`DELETE FROM "Session" WHERE "id" = ANY($1)`, [sessionIds]);
  }
}

async function createObserverSpeakingFixture() {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const participantAUser = await createActiveUser({ preferredLocale: "en" });
  const participantBUser = await createActiveUser({ preferredLocale: "en" });
  const observerUser = await createActiveUser({ preferredLocale: "en" });
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const sessionId = e2eId("stage-312b-observer-speaking-session");
  const facilitatorId = e2eId("stage-312b-observer-speaking-facilitator");
  const participantAId = e2eId("stage-312b-observer-speaking-a");
  const participantBId = e2eId("stage-312b-observer-speaking-b");
  const observerId = e2eId("stage-312b-observer-speaking-observer");
  const roleAId = e2eId("stage-312b-observer-speaking-role-a");
  const roleBId = e2eId("stage-312b-observer-speaking-role-b");

  await query(
    `INSERT INTO "Session"
       ("id","negotiationCaseId","facilitatorId","title","roomLabel",
        "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
        "snapshotCaseLanguage","preparationDurationSeconds","durationSeconds","updatedAt")
     VALUES ($1,$2,$3,'Stage 3.12B Observer Speaking Session','Observer Speaking Room',
        'Stage 3.12B Observer Speaking Case','Business context','Public instructions','EN',300,900,NOW())`,
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
       ($4,$5,$9,NULL,'OBSERVER',$15,'Pasha','',NOW())`,
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
      `observer-speaking-fac-${sessionId}`,
      roleAId,
      `observer-speaking-a-${sessionId}`,
      roleBId,
      `observer-speaking-b-${sessionId}`,
      `observer-speaking-observer-${sessionId}`,
    ],
  );
  await forceSessionRunningForE2e(sessionId);

  return {
    sessionId,
    facilitator: { participantId: facilitatorId, userId: facilitatorUser.id },
    participantA: { participantId: participantAId, userId: participantAUser.id },
    participantB: { participantId: participantBId, userId: participantBUser.id },
    observer: { participantId: observerId, userId: observerUser.id },
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
  connectionId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
}) {
  const key = `voximplant:session-media-status:${input.sessionId}`;
  const rows = await query<{ value: string | null }>(
    `SELECT "value" FROM "AppSetting" WHERE "key"=$1`,
    [key],
  );
  const doc = rows[0]?.value
    ? (JSON.parse(rows[0].value) as {
        version: 1;
        participants: Record<string, SessionMediaStatusRecord>;
      })
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

async function pauseNegotiation(sessionId: string) {
  await query(
    `UPDATE "Session"
     SET "negotiationState"='PAUSED',"roomLifecycle"='OPEN',"updatedAt"=NOW()
     WHERE "id"=$1`,
    [sessionId],
  );
}

async function openDebrief(sessionId: string) {
  await query(
    `UPDATE "Session"
     SET "negotiationState"='FINISHED',"roomLifecycle"='DEBRIEF_OPEN',"updatedAt"=NOW()
     WHERE "id"=$1`,
    [sessionId],
  );
}

async function observerRosterEntry(input: { sessionId: string; participantId: string }) {
  const rows = await query<{
    id: string;
    type: string;
    displayName: string;
    isLogicallyPresent: boolean | null;
  }>(
    `SELECT sp."id", sp."type", sp."displayName",
            (src."connectionId" IS NOT NULL) AS "isLogicallyPresent"
     FROM "SessionParticipant" sp
     LEFT JOIN "SessionRoomConnection" src
       ON src."sessionId" = sp."sessionId"
      AND src."userId" = sp."userId"
      AND src."disconnectedAt" IS NULL
      AND src."supersededAt" IS NULL
      AND src."revokedAt" IS NULL
      AND src."expiresAt" > NOW()
     WHERE sp."sessionId" = $1 AND sp."id" = $2`,
    [input.sessionId, input.participantId],
  );
  return rows[0]!;
}

test.beforeEach(async () => {
  await cleanupObserverSpeakingData();
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupObserverSpeakingData();
  await cleanupE2eData();
});

test("observer speaking highlights in RUNNING and clears when silent @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  const connectionId = "observer-running";
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId,
    micEnabled: true,
    cameraEnabled: true,
  });
  expect((await getSessionNegotiationState(fixture.sessionId)).negotiationState).toBe("RUNNING");

  const endpoint = createSimulatedEndpoint("observer-endpoint");
  remoteAudioAdded(
    endpoint,
    fakeStream({ id: "observer-audio-1", audioTracks: [fakeAudioTrack("observer-track-1")] }),
  );
  const roster = await observerRosterEntry({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
  });
  expect(roster.type).toBe("OBSERVER");
  expect(roster.isLogicallyPresent).toBe(true);

  const analyser = attachAnalyser(endpoint, connectionId);
  expect(analyser).not.toBeNull();

  analyser!.emitLevel(45);
  const speaking = renderObserverTile({
    endpoint,
    connectionId,
    micEnabled: true,
    isSpeaking: analyser!.isSpeaking,
  });
  expect(speaking.highlight).toBe(true);
  expect(speaking.borderState).toBe("speaking");

  analyser!.emitLevel(1);
  const silent = renderObserverTile({
    endpoint,
    connectionId,
    micEnabled: true,
    isSpeaking: analyser!.isSpeaking,
  });
  expect(silent.highlight).toBe(false);
  expect(silent.borderState).toBe("connected");
});

test("observer speaking still highlights while the negotiation is paused @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  const connectionId = "observer-paused";
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId,
    micEnabled: true,
    cameraEnabled: true,
  });
  await pauseNegotiation(fixture.sessionId);

  const state = await getSessionNegotiationState(fixture.sessionId);
  expect(state.negotiationState).toBe("PAUSED");
  const roster = await observerRosterEntry({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
  });
  expect(roster.isLogicallyPresent).toBe(true);

  const endpoint = createSimulatedEndpoint("observer-endpoint");
  remoteAudioAdded(
    endpoint,
    fakeStream({ id: "observer-audio-1", audioTracks: [fakeAudioTrack("observer-track-1")] }),
  );
  const analyser = attachAnalyser(endpoint, connectionId);
  analyser!.emitLevel(40);

  const tile = renderObserverTile({
    endpoint,
    connectionId,
    micEnabled: true,
    isSpeaking: analyser!.isSpeaking,
  });
  expect(tile.highlight).toBe(true);
  expect(tile.borderState).toBe("speaking");
});

test("observer speaking still highlights in DEBRIEF_OPEN @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  const connectionId = "observer-debrief";
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId,
    micEnabled: true,
    cameraEnabled: true,
  });
  await openDebrief(fixture.sessionId);

  const before = await getSessionNegotiationState(fixture.sessionId);
  expect(before.roomLifecycle).toBe("DEBRIEF_OPEN");

  const endpoint = createSimulatedEndpoint("observer-endpoint");
  remoteAudioAdded(
    endpoint,
    fakeStream({ id: "observer-audio-1", audioTracks: [fakeAudioTrack("observer-track-1")] }),
  );
  const analyser = attachAnalyser(endpoint, connectionId);
  analyser!.emitLevel(30);

  const tile = renderObserverTile({
    endpoint,
    connectionId,
    micEnabled: true,
    isSpeaking: analyser!.isSpeaking,
  });
  expect(tile.highlight).toBe(true);
  expect(tile.borderState).toBe("speaking");

  // Debrief lifecycle is untouched by speaking visualization.
  const after = await getSessionNegotiationState(fixture.sessionId);
  expect(after.roomLifecycle).toBe("DEBRIEF_OPEN");
});

test("muting the observer clears speaking and restores the muted border @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  const connectionId = "observer-mute";
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId,
    micEnabled: true,
    cameraEnabled: true,
  });

  const endpoint = createSimulatedEndpoint("observer-endpoint");
  remoteAudioAdded(
    endpoint,
    fakeStream({ id: "observer-audio-1", audioTracks: [fakeAudioTrack("observer-track-1")] }),
  );
  const analyser = attachAnalyser(endpoint, connectionId);
  analyser!.emitLevel(50);
  expect(
    renderObserverTile({
      endpoint,
      connectionId,
      micEnabled: true,
      isSpeaking: analyser!.isSpeaking,
    }).borderState,
  ).toBe("speaking");

  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId,
    micEnabled: false,
    cameraEnabled: true,
  });
  analyser!.emitLevel(50, { microphoneEnabled: false });
  const muted = renderObserverTile({
    endpoint,
    connectionId,
    micEnabled: false,
    isSpeaking: analyser!.isSpeaking,
  });
  expect(muted.highlight).toBe(false);
  expect(muted.borderState).toBe("muted");
});

test("observer rejoin attaches a new analyser and keeps one tile @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  const oldConnectionId = "observer-old";
  const newConnectionId = "observer-new";
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId: oldConnectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId: oldConnectionId,
    micEnabled: true,
    cameraEnabled: true,
  });

  const endpoint = createSimulatedEndpoint("observer-endpoint");
  const firstStream = fakeStream({
    id: "observer-audio-1",
    audioTracks: [fakeAudioTrack("observer-track-1")],
  });
  remoteAudioAdded(endpoint, firstStream);
  const oldAnalyser = attachAnalyser(endpoint, oldConnectionId);
  oldAnalyser!.emitLevel(50);

  // Observer leaves: the removed audio stream releases its playback element.
  remoteAudioRemoved(endpoint, firstStream);
  expect(endpoint.attachedAudioStream).toBeNull();
  expect(endpoint.attachedElementKeys).toHaveLength(0);

  // Observer rejoins with a replacement audio stream and a new connection.
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId: newConnectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId: newConnectionId,
    micEnabled: true,
    cameraEnabled: true,
  });
  const secondStream = fakeStream({
    id: "observer-audio-2",
    audioTracks: [fakeAudioTrack("observer-track-2")],
  });
  remoteAudioAdded(endpoint, secondStream);
  // A later endpoint refresh must not drop the live audio stream.
  remoteEndpointRefreshed(endpoint);
  expect(endpoint.attachedAudioStream).toBe(secondStream);
  expect(endpoint.attachedElementKeys).toHaveLength(1);

  const newAnalyser = attachAnalyser(endpoint, newConnectionId);
  expect(newAnalyser).not.toBeNull();
  expect(newAnalyser!.audioTrackId).toBe("observer-track-2");
  expect(newAnalyser!.audioTrackId).not.toBe(oldAnalyser!.audioTrackId);
  newAnalyser!.emitLevel(45);

  const highlighted = renderObserverTile({
    endpoint,
    connectionId: newConnectionId,
    micEnabled: true,
    isSpeaking: newAnalyser!.isSpeaking,
  });
  expect(highlighted.highlight).toBe(true);
  expect(highlighted.borderState).toBe("speaking");

  // The old analyser still reports speech but belongs to a superseded generation.
  expect(oldAnalyser!.isSpeaking).toBe(true);
  const staleSignal = renderObserverTile({
    endpoint,
    connectionId: newConnectionId,
    micEnabled: true,
    isSpeaking: oldAnalyser!.isSpeaking,
    speakingGeneration: oldConnectionId,
  });
  expect(staleSignal.highlight).toBe(false);

  const activeConnections = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SessionRoomConnection"
     WHERE "sessionId"=$1
       AND "userId"=$2
       AND "disconnectedAt" IS NULL
       AND "supersededAt" IS NULL
       AND "revokedAt" IS NULL
       AND "expiresAt" > NOW()`,
    [fixture.sessionId, fixture.observer.userId],
  );
  expect(Number(activeConnections[0]?.count ?? "0")).toBe(1);
});

test("stale endpoint refresh no longer strips the observer audio stream @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  const connectionId = "observer-refresh";
  await claimConnection({
    sessionId: fixture.sessionId,
    userId: fixture.observer.userId,
    role: ParticipantType.OBSERVER,
    connectionId,
  });
  await publishMediaStatus({
    sessionId: fixture.sessionId,
    participantId: fixture.observer.participantId,
    connectionId,
    micEnabled: true,
    cameraEnabled: true,
  });

  const endpoint = createSimulatedEndpoint("observer-endpoint");
  const stream = fakeStream({
    id: "observer-audio-1",
    audioTracks: [fakeAudioTrack("observer-track-1")],
  });
  remoteAudioAdded(endpoint, stream);

  // Camera toggles and other media events refresh the endpoint repeatedly.
  endpoint.audioStreams = [];
  remoteEndpointRefreshed(endpoint);
  remoteEndpointRefreshed(endpoint);
  expect(endpoint.attachedAudioStream).toBe(stream);

  const analyser = attachAnalyser(endpoint, connectionId);
  expect(analyser).not.toBeNull();
  analyser!.emitLevel(40);
  expect(
    renderObserverTile({
      endpoint,
      connectionId,
      micEnabled: true,
      isSpeaking: analyser!.isSpeaking,
    }).borderState,
  ).toBe("speaking");
});

test("facilitator and participants keep the shared speaking behaviour @observer-smoke", async () => {
  const fixture = await createObserverSpeakingFixture();
  for (const [role, actor] of [
    [ParticipantType.FACILITATOR, fixture.facilitator],
    [ParticipantType.PARTICIPANT, fixture.participantA],
    [ParticipantType.PARTICIPANT, fixture.participantB],
  ] as const) {
    const connectionId = `shared-${actor.participantId}`;
    await claimConnection({
      sessionId: fixture.sessionId,
      userId: actor.userId,
      role,
      connectionId,
    });
    await publishMediaStatus({
      sessionId: fixture.sessionId,
      participantId: actor.participantId,
      connectionId,
      micEnabled: true,
      cameraEnabled: true,
    });

    const endpoint = createSimulatedEndpoint(`${actor.participantId}-endpoint`);
    remoteAudioAdded(
      endpoint,
      fakeStream({
        id: `${actor.participantId}-audio`,
        audioTracks: [fakeAudioTrack(`${actor.participantId}-track`)],
      }),
    );
    const analyser = attachAnalyser(endpoint, connectionId);
    expect(analyser).not.toBeNull();
    analyser!.emitLevel(35);
    const tile = renderObserverTile({
      endpoint,
      connectionId,
      micEnabled: true,
      isSpeaking: analyser!.isSpeaking,
    });
    expect(tile.highlight).toBe(true);
    expect(tile.borderState).toBe("speaking");
  }
});

test("observer rail ordering and geometry are untouched by the speaking hotfix @observer-smoke", () => {
  const layoutSource = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  // Stable roster order, single row, compact tile widths, and overflow handling
  // must remain exactly as deployed.
  expect(layoutSource).toContain("Stable roster order is the visual order");
  expect(layoutSource).toContain("w-40 min-w-0 max-w-full shrink-0 snap-start");
  expect(layoutSource).toContain("flex w-max flex-none gap-2");
  expect(layoutSource).toContain("overflow-x-auto overflow-y-hidden overscroll-x-contain");
  expect(layoutSource).toContain("vox-observer-rail-shell");
  expect(layoutSource).toContain("h-[10rem] shrink-0 overflow-hidden");

  const modelSource = readFileSync("lib/voximplant/room-layout-model.ts", "utf-8");
  expect(modelSource).toContain("a.stableRosterIndex - b.stableRosterIndex");
});
