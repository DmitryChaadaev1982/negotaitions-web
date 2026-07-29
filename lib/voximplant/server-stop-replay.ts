import "server-only";

import { createHash } from "crypto";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type ServerStopReplayReserveResult =
  | { status: "accepted" }
  | { status: "duplicate" };

export class ServerStopReplayConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function hashNonce(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}

export async function reserveVoximplantCallbackNonce(input: {
  nonce: string;
  eventType: string;
  sessionId: string;
  operationId?: string | null;
  providerSessionId: string;
  replayWindowSeconds: number;
  now?: Date;
}): Promise<ServerStopReplayReserveResult> {
  const nonceHash = hashNonce(input.nonce);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.replayWindowSeconds * 1000);

  try {
    await prisma.voximplantCallbackNonce.create({
      data: {
        nonceHash,
        eventType: input.eventType,
        sessionId: input.sessionId,
        operationId: input.operationId ?? null,
        providerSessionId: input.providerSessionId,
        expiresAt,
      },
    });
    return { status: "accepted" };
  } catch (error) {
    const prismaError = error as Prisma.PrismaClientKnownRequestError | undefined;
    if (!prismaError || prismaError.code !== "P2002") {
      throw error;
    }

    const existing = await prisma.voximplantCallbackNonce.findUnique({
      where: { nonceHash },
      select: {
        eventType: true,
        sessionId: true,
        operationId: true,
        providerSessionId: true,
      },
    });
    if (
      existing &&
      existing.eventType === input.eventType &&
      existing.sessionId === input.sessionId &&
      (existing.operationId ?? null) === (input.operationId ?? null) &&
      existing.providerSessionId === input.providerSessionId
    ) {
      return { status: "duplicate" };
    }

    throw new ServerStopReplayConflictError(
      "Nonce replay conflict with different callback correlation data.",
    );
  }
}

export async function cleanupExpiredVoximplantCallbackNonces(now = new Date()) {
  const deleted = await prisma.voximplantCallbackNonce.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });
  return deleted.count;
}
