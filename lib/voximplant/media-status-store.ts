import "server-only";

import { prisma } from "@/lib/prisma";

type MediaStatusRecord = {
  connectionId: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  updatedAt: string;
};

type MediaStatusDocument = {
  version: 1;
  participants: Record<string, MediaStatusRecord>;
};

const SESSION_KEY_PREFIX = "voximplant:session-media-status:";
const EVENT_KEY_PREFIX = "voximplant:event-media-status:";
const CURRENT_VERSION = 1 as const;

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function eventKey(eventId: string): string {
  return `${EVENT_KEY_PREFIX}${eventId}`;
}

function parseDocument(raw: string | null | undefined): MediaStatusDocument {
  if (!raw) {
    return {
      version: CURRENT_VERSION,
      participants: {},
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MediaStatusDocument>;
    if (parsed.version !== CURRENT_VERSION || !parsed.participants) {
      return {
        version: CURRENT_VERSION,
        participants: {},
      };
    }
    return {
      version: CURRENT_VERSION,
      participants: parsed.participants,
    };
  } catch {
    return {
      version: CURRENT_VERSION,
      participants: {},
    };
  }
}

async function readDocument(key: string): Promise<MediaStatusDocument> {
  const row = await prisma.appSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  return parseDocument(row?.value);
}

async function upsertParticipantStatus(params: {
  key: string;
  participantId: string;
  connectionId?: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
}): Promise<MediaStatusRecord> {
  const nextRecord: MediaStatusRecord = {
    connectionId: params.connectionId ?? null,
    micEnabled: params.micEnabled,
    cameraEnabled: params.cameraEnabled,
    updatedAt: new Date().toISOString(),
  };
  // Optimistic compare-and-swap loop to prevent concurrent participant updates
  // from clobbering each other in the shared AppSetting JSON document.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await prisma.appSetting.findUnique({
      where: { key: params.key },
      select: { value: true },
    });
    const nextDocument = parseDocument(current?.value);
    nextDocument.participants[params.participantId] = nextRecord;
    const nextValue = JSON.stringify(nextDocument);

    if (!current) {
      try {
        await prisma.appSetting.create({
          data: { key: params.key, value: nextValue },
        });
        return nextRecord;
      } catch {
        continue;
      }
    }

    const updated = await prisma.appSetting.updateMany({
      where: { key: params.key, value: current.value },
      data: { value: nextValue },
    });
    if (updated.count > 0) {
      return nextRecord;
    }
  }

  throw new Error("Failed to persist media status due to concurrent updates.");
}

export async function getSessionMediaStatusMap(
  sessionId: string,
): Promise<Record<string, MediaStatusRecord>> {
  const doc = await readDocument(sessionKey(sessionId));
  return doc.participants;
}

export async function upsertSessionParticipantMediaStatus(params: {
  sessionId: string;
  participantId: string;
  connectionId?: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
}): Promise<MediaStatusRecord> {
  return upsertParticipantStatus({
    key: sessionKey(params.sessionId),
    participantId: params.participantId,
    connectionId: params.connectionId,
    micEnabled: params.micEnabled,
    cameraEnabled: params.cameraEnabled,
  });
}

export async function getEventMediaStatusMap(
  eventId: string,
): Promise<Record<string, MediaStatusRecord>> {
  const doc = await readDocument(eventKey(eventId));
  return doc.participants;
}

export async function upsertEventParticipantMediaStatus(params: {
  eventId: string;
  participantId: string;
  connectionId?: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
}): Promise<MediaStatusRecord> {
  return upsertParticipantStatus({
    key: eventKey(params.eventId),
    participantId: params.participantId,
    connectionId: params.connectionId,
    micEnabled: params.micEnabled,
    cameraEnabled: params.cameraEnabled,
  });
}
