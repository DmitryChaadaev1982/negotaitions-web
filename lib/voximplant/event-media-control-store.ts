import "server-only";

import { randomUUID } from "crypto";

import { prisma } from "@/lib/prisma";

export type EventMediaControlDevice = "mic" | "camera";
export type EventMediaControlAction = "disable" | "enable_request";
export type EventMediaControlStatus =
  | "pending"
  | "applied"
  | "accepted"
  | "declined"
  | "expired"
  | "failed";

export type EventMediaControlCommand = {
  id: string;
  eventId: string;
  targetParticipantId: string;
  requestedByParticipantId: string | null;
  requestedByUserId: string | null;
  requestedByDisplayName: string;
  device: EventMediaControlDevice;
  action: EventMediaControlAction;
  status: EventMediaControlStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  resultMessage: string | null;
};

type EventMediaControlDocument = {
  version: 1;
  commands: EventMediaControlCommand[];
};

const KEY_PREFIX = "event-media-control:";
const CURRENT_VERSION = 1 as const;
const COMMAND_TTL_MS = 60_000;
const RETENTION_MS = 10 * 60_000;

function keyForEvent(eventId: string) {
  return `${KEY_PREFIX}${eventId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseDocument(raw: string | null | undefined): EventMediaControlDocument {
  if (!raw) return { version: CURRENT_VERSION, commands: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<EventMediaControlDocument>;
    if (parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.commands)) {
      return { version: CURRENT_VERSION, commands: [] };
    }
    return {
      version: CURRENT_VERSION,
      commands: parsed.commands.filter((command): command is EventMediaControlCommand =>
        Boolean(
          command &&
            typeof command.id === "string" &&
            typeof command.eventId === "string" &&
            typeof command.targetParticipantId === "string" &&
            (command.device === "mic" || command.device === "camera") &&
            (command.action === "disable" || command.action === "enable_request") &&
            typeof command.status === "string" &&
            typeof command.createdAt === "string" &&
            typeof command.expiresAt === "string",
        ),
      ),
    };
  } catch {
    return { version: CURRENT_VERSION, commands: [] };
  }
}

function normalizeDocument(document: EventMediaControlDocument, clock = new Date()) {
  const retentionCutoffMs = clock.getTime() - RETENTION_MS;
  const commands = document.commands
    .map((command) => {
      if (command.status === "pending" && Date.parse(command.expiresAt) <= clock.getTime()) {
        return {
          ...command,
          status: "expired" as const,
          completedAt: command.completedAt ?? clock.toISOString(),
        };
      }
      return command;
    })
    .filter((command) => {
      if (command.status === "pending") return true;
      const completedAtMs = Date.parse(command.completedAt ?? command.createdAt);
      return Number.isNaN(completedAtMs) || completedAtMs >= retentionCutoffMs;
    });
  return { version: CURRENT_VERSION, commands };
}

async function mutateDocument<T>(
  eventId: string,
  mutate: (document: EventMediaControlDocument) => { document: EventMediaControlDocument; result: T },
): Promise<T> {
  const key = keyForEvent(eventId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await prisma.appSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const normalized = normalizeDocument(parseDocument(current?.value));
    const { document, result } = mutate(normalized);
    const nextValue = JSON.stringify(normalizeDocument(document));

    if (!current) {
      try {
        await prisma.appSetting.create({ data: { key, value: nextValue } });
        return result;
      } catch {
        continue;
      }
    }

    const updated = await prisma.appSetting.updateMany({
      where: { key, value: current.value },
      data: { value: nextValue },
    });
    if (updated.count > 0) return result;
  }
  throw new Error("Failed to persist event media-control command.");
}

export async function createEventMediaControlCommand(params: {
  eventId: string;
  targetParticipantId: string;
  requestedByParticipantId: string | null;
  requestedByUserId: string | null;
  requestedByDisplayName: string;
  device: EventMediaControlDevice;
  action: EventMediaControlAction;
}) {
  return mutateDocument(params.eventId, (document) => {
    const existingPending = document.commands.find(
      (command) =>
        command.status === "pending" &&
        command.targetParticipantId === params.targetParticipantId &&
        command.device === params.device &&
        command.action === params.action,
    );
    if (existingPending) {
      return { document, result: existingPending };
    }

    const createdAt = nowIso();
    const command: EventMediaControlCommand = {
      id: randomUUID(),
      eventId: params.eventId,
      targetParticipantId: params.targetParticipantId,
      requestedByParticipantId: params.requestedByParticipantId,
      requestedByUserId: params.requestedByUserId,
      requestedByDisplayName: params.requestedByDisplayName,
      device: params.device,
      action: params.action,
      status: "pending",
      createdAt,
      expiresAt: new Date(Date.now() + COMMAND_TTL_MS).toISOString(),
      completedAt: null,
      resultMessage: null,
    };
    return {
      document: {
        ...document,
        commands: [...document.commands, command],
      },
      result: command,
    };
  });
}

export async function getPendingEventMediaControlCommands(params: {
  eventId: string;
  targetParticipantId: string;
}) {
  const row = await prisma.appSetting.findUnique({
    where: { key: keyForEvent(params.eventId) },
    select: { value: true },
  });
  const document = normalizeDocument(parseDocument(row?.value));
  return document.commands.filter(
    (command) =>
      command.status === "pending" &&
      command.targetParticipantId === params.targetParticipantId,
  );
}

export async function acknowledgeEventMediaControlCommand(params: {
  eventId: string;
  commandId: string;
  targetParticipantId: string;
  status: Exclude<EventMediaControlStatus, "pending">;
  resultMessage?: string | null;
}) {
  return mutateDocument(params.eventId, (document) => {
    let result: EventMediaControlCommand | null = null;
    const commands = document.commands.map((command) => {
      if (command.id !== params.commandId) return command;
      if (command.targetParticipantId !== params.targetParticipantId) return command;
      if (command.status !== "pending") {
        result = command;
        return command;
      }
      result = {
        ...command,
        status: params.status,
        completedAt: nowIso(),
        resultMessage: params.resultMessage ?? null,
      };
      return result;
    });
    return {
      document: { ...document, commands },
      result,
    };
  });
}
