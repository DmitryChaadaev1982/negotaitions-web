import { AccessToken, TrackSource } from "livekit-server-sdk";

import type { Session, SessionParticipant } from "@/app/generated/prisma/client";
import { buildLiveKitParticipantMetadata } from "@/lib/livekit-participant-metadata";
import { prisma } from "@/lib/prisma";

export type LiveKitConfig = {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
};

export function getLiveKitConfig(): LiveKitConfig | null {
  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!serverUrl || !apiKey || !apiSecret) {
    return null;
  }

  return { serverUrl, apiKey, apiSecret };
}

export function buildLiveKitRoomName(sessionId: string) {
  return `negotiations-${sessionId}`;
}

export function buildEventLobbyRoomName(eventId: string) {
  return `event-lobby-${eventId}`;
}

export async function ensureEventLobbyRoomName(
  event: Pick<{ id: string; lobbyRoomName: string | null }, "id" | "lobbyRoomName">,
) {
  if (event.lobbyRoomName) {
    return event.lobbyRoomName;
  }

  const lobbyRoomName = buildEventLobbyRoomName(event.id);

  await prisma.trainingEvent.update({
    where: { id: event.id },
    data: { lobbyRoomName },
  });

  return lobbyRoomName;
}

export async function ensureSessionLiveKitRoomName(
  session: Pick<Session, "id" | "livekitRoomName">,
) {
  if (session.livekitRoomName) {
    return session.livekitRoomName;
  }

  const livekitRoomName = buildLiveKitRoomName(session.id);

  await prisma.session.update({
    where: { id: session.id },
    data: { livekitRoomName },
  });

  return livekitRoomName;
}

export async function createLiveKitAccessToken(
  sessionParticipant: Pick<SessionParticipant, "id" | "displayName" | "type">,
  session: Pick<Session, "id" | "livekitRoomName">,
  config: LiveKitConfig,
  caseRoleName: string | null = null,
) {
  const roomName = await ensureSessionLiveKitRoomName(session);
  const canPublish = true;

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: sessionParticipant.id,
    name: sessionParticipant.displayName,
    metadata: buildLiveKitParticipantMetadata(
      sessionParticipant.type,
      caseRoleName,
    ),
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canSubscribe: true,
  });

  return token.toJwt();
}

export async function createEventLobbyLiveKitAccessToken(
  input: {
    identity: string;
    displayName: string;
    eventId: string;
    lobbyRoomName: string | null;
  },
  config: LiveKitConfig,
) {
  const roomName = await ensureEventLobbyRoomName({
    id: input.eventId,
    lobbyRoomName: input.lobbyRoomName,
  });

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.displayName,
    metadata: JSON.stringify({ kind: "event-lobby" }),
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canSubscribe: true,
  });

  return { token: await token.toJwt(), roomName };
}
