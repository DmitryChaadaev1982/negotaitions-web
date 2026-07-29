import "server-only";

import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";

export type ServerStopRegistrationErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_DELETED"
  | "CONFERENCE_MISMATCH"
  | "CONTROL_URL_MISSING"
  | "CONTROL_URL_INVALID"
  | "PROVIDER_SESSION_CONFLICT"
  | "PROVIDER_TERMINAL_LOCKED"
  | "STALE_REGISTRATION";

export class ServerStopRegistrationError extends Error {
  code: ServerStopRegistrationErrorCode;

  constructor(code: ServerStopRegistrationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type RegisterServerStopControlChannelInput = {
  sessionId: string;
  providerSessionId: string;
  conferenceName: string;
  accessSecureUrl?: string | null;
  controlUrl?: string | null;
  scenarioBuild?: string | null;
  scenarioSource?: string | null;
  ruleIdentity?: string | null;
  callbackTimestamp?: Date;
};

export type RegisteredServerStopControlChannel = {
  channelId: string;
  sessionId: string;
  providerSessionId: string;
  conferenceName: string;
  controlUrlFingerprint: string;
  registeredAt: Date;
  lastSeenAt: Date;
  replacedExisting: boolean;
};

function normalizeControlUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ServerStopRegistrationError(
      "CONTROL_URL_INVALID",
      "Control URL is not a valid URL.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new ServerStopRegistrationError(
      "CONTROL_URL_INVALID",
      "Control URL must use https://.",
    );
  }
  return parsed.toString();
}

function buildControlUrlFingerprint(controlUrl: string) {
  const parsed = new URL(controlUrl);
  const sanitized = `${parsed.origin}${parsed.pathname}`;
  return createHash("sha256").update(sanitized).digest("hex");
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function registerSessionVoximplantControlChannel(
  input: RegisterServerStopControlChannelInput,
): Promise<RegisteredServerStopControlChannel> {
  const providerSessionId = input.providerSessionId.trim();
  if (!providerSessionId) {
    throw new ServerStopRegistrationError(
      "PROVIDER_SESSION_CONFLICT",
      "providerSessionId is required.",
    );
  }

  const resolvedControlUrlRaw =
    trimOrNull(input.accessSecureUrl) ?? trimOrNull(input.controlUrl);
  if (!resolvedControlUrlRaw) {
    throw new ServerStopRegistrationError(
      "CONTROL_URL_MISSING",
      "Missing private control URL in provider registration.",
    );
  }

  const normalizedControlUrl = normalizeControlUrl(resolvedControlUrlRaw);
  const controlUrlFingerprint = buildControlUrlFingerprint(normalizedControlUrl);
  const callbackTimestamp = input.callbackTimestamp ?? new Date();
  const expectedConferenceName = buildVoximplantConferenceName(input.sessionId);
  if (input.conferenceName !== expectedConferenceName) {
    throw new ServerStopRegistrationError(
      "CONFERENCE_MISMATCH",
      "Conference name does not match the canonical session conference name.",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: input.sessionId },
      select: { id: true, deletedAt: true },
    });
    if (!session) {
      throw new ServerStopRegistrationError(
        "SESSION_NOT_FOUND",
        "Session not found for control channel registration.",
      );
    }
    if (session.deletedAt) {
      throw new ServerStopRegistrationError(
        "SESSION_DELETED",
        "Session is deleted.",
      );
    }

    const providerConflict =
      await tx.sessionVoximplantControlChannel.findUnique({
        where: { providerSessionId },
        select: { id: true, sessionId: true },
      });
    if (providerConflict && providerConflict.sessionId !== input.sessionId) {
      throw new ServerStopRegistrationError(
        "PROVIDER_SESSION_CONFLICT",
        "providerSessionId is already registered to another session.",
      );
    }

    const existing = await tx.sessionVoximplantControlChannel.findUnique({
      where: { sessionId: input.sessionId },
      select: {
        id: true,
        sessionId: true,
        providerSessionId: true,
        conferenceName: true,
        controlUrl: true,
        registeredAt: true,
      },
    });

    let replacedExisting = false;

    if (existing) {
      const isSameBinding =
        existing.providerSessionId === providerSessionId &&
        existing.conferenceName === input.conferenceName &&
        existing.controlUrl === normalizedControlUrl;
      if (!isSameBinding && existing.providerSessionId !== providerSessionId) {
        const terminalStopExists =
          (await tx.sessionRecordingStopOperation.count({
            where: {
              sessionId: input.sessionId,
              providerTerminalAt: { not: null },
            },
          })) > 0;
        if (terminalStopExists) {
          throw new ServerStopRegistrationError(
            "PROVIDER_TERMINAL_LOCKED",
            "Session already has provider-terminal stop evidence; registration replacement is locked.",
          );
        }
        if (callbackTimestamp <= existing.registeredAt) {
          throw new ServerStopRegistrationError(
            "STALE_REGISTRATION",
            "Registration callback timestamp is older than the currently saved registration.",
          );
        }
        replacedExisting = true;
      }

      await tx.sessionVoximplantControlChannel.update({
        where: { id: existing.id },
        data: {
          providerSessionId,
          conferenceName: input.conferenceName,
          controlUrl: normalizedControlUrl,
          controlUrlFingerprint,
          scenarioBuild: trimOrNull(input.scenarioBuild),
          scenarioSource: trimOrNull(input.scenarioSource),
          ruleIdentity: trimOrNull(input.ruleIdentity),
          ...(replacedExisting ? { registeredAt: callbackTimestamp } : {}),
          lastSeenAt: callbackTimestamp,
        },
      });

      return { replacedExisting };
    }

    await tx.sessionVoximplantControlChannel.create({
      data: {
        sessionId: input.sessionId,
        providerSessionId,
        conferenceName: input.conferenceName,
        controlUrl: normalizedControlUrl,
        controlUrlFingerprint,
        scenarioBuild: trimOrNull(input.scenarioBuild),
        scenarioSource: trimOrNull(input.scenarioSource),
        ruleIdentity: trimOrNull(input.ruleIdentity),
        registeredAt: callbackTimestamp,
        lastSeenAt: callbackTimestamp,
      },
    });
    return { replacedExisting: false };
  });

  const reread = await prisma.sessionVoximplantControlChannel.findUnique({
    where: { sessionId: input.sessionId },
    select: {
      id: true,
      sessionId: true,
      providerSessionId: true,
      conferenceName: true,
      controlUrlFingerprint: true,
      registeredAt: true,
      lastSeenAt: true,
    },
  });
  if (!reread || reread.providerSessionId !== providerSessionId) {
    throw new ServerStopRegistrationError(
      "PROVIDER_SESSION_CONFLICT",
      "Control channel registration verification failed.",
    );
  }

  console.log(
    JSON.stringify({
      area: "voximplant_server_stop_registration",
      event: "channel_registered",
      sessionId: reread.sessionId,
      providerSessionId: reread.providerSessionId,
      conferenceName: reread.conferenceName,
      controlUrlFingerprint: reread.controlUrlFingerprint,
      replacedExisting: result.replacedExisting,
    }),
  );

  return {
    channelId: reread.id,
    sessionId: reread.sessionId,
    providerSessionId: reread.providerSessionId,
    conferenceName: reread.conferenceName,
    controlUrlFingerprint: reread.controlUrlFingerprint,
    registeredAt: reread.registeredAt,
    lastSeenAt: reread.lastSeenAt,
    replacedExisting: result.replacedExisting,
  };
}
