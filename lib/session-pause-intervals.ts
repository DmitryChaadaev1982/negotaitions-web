import { prisma } from "@/lib/prisma";

type PauseIntervalDelegate = {
  create: (args: {
    data: { sessionId: string; startedAt: Date };
  }) => Promise<unknown>;
  findFirst: (args: {
    where: { sessionId: string; endedAt: null };
    orderBy: { startedAt: "desc" };
  }) => Promise<{ id: string } | null>;
  update: (args: {
    where: { id: string };
    data: { endedAt: Date };
  }) => Promise<unknown>;
  findMany: (args: {
    where: { sessionId: string };
    orderBy: { startedAt: "asc" };
    select: { startedAt: true; endedAt: true };
  }) => Promise<Array<{ startedAt: Date; endedAt: Date | null }>>;
};

function getPauseIntervalDelegate(): PauseIntervalDelegate | null {
  const delegate = (
    prisma as unknown as { sessionPauseInterval?: PauseIntervalDelegate }
  ).sessionPauseInterval;

  return delegate ?? null;
}

export async function createPauseInterval(sessionId: string, startedAt: Date) {
  const delegate = getPauseIntervalDelegate();
  if (!delegate) {
    console.warn(
      "[session-pause-intervals] Prisma delegate missing. Run `npx prisma generate` and restart the dev server.",
    );
    return null;
  }

  try {
    return await delegate.create({
      data: {
        sessionId,
        startedAt,
      },
    });
  } catch (error) {
    console.error("[session-pause-intervals] Failed to create pause interval:", error);
    return null;
  }
}

export async function closeLatestPauseInterval(sessionId: string, endedAt: Date) {
  const delegate = getPauseIntervalDelegate();
  if (!delegate) {
    console.warn(
      "[session-pause-intervals] Prisma delegate missing. Run `npx prisma generate` and restart the dev server.",
    );
    return null;
  }

  try {
    const openInterval = await delegate.findFirst({
      where: {
        sessionId,
        endedAt: null,
      },
      orderBy: {
        startedAt: "desc",
      },
    });

    if (!openInterval) {
      return null;
    }

    return await delegate.update({
      where: { id: openInterval.id },
      data: { endedAt },
    });
  } catch (error) {
    console.error("[session-pause-intervals] Failed to close pause interval:", error);
    return null;
  }
}

export async function listPauseIntervals(sessionId: string) {
  const delegate = getPauseIntervalDelegate();
  if (!delegate) {
    console.warn(
      "[session-pause-intervals] Prisma delegate missing. Run `npx prisma generate` and restart the dev server.",
    );
    return [];
  }

  try {
    return await delegate.findMany({
      where: { sessionId },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, endedAt: true },
    });
  } catch (error) {
    console.error("[session-pause-intervals] Failed to list pause intervals:", error);
    return [];
  }
}
