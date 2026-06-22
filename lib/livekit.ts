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
