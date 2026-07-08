import { prisma } from "@/lib/prisma";

type PauseIntervalDelegate = {
  create: (args: {
    data: { sessionId: string; startedAt: Date };
  }) => Promise<{ id: string; startedAt: Date; endedAt: Date | null }>;
  findFirst: (args: {
    where: { sessionId: string; endedAt: null };
    orderBy: { startedAt: "desc" };
  }) => Promise<{ id: string; startedAt: Date; endedAt: Date | null } | null>;
  update: (args: {
    where: { id: string };
    data: { endedAt: Date };
  }) => Promise<{ id: string; startedAt: Date; endedAt: Date | null }>;
  findMany: (args: {
    where: { sessionId: string; endedAt?: null };
    orderBy: { startedAt: "asc" };
    select: { id?: true; startedAt: true; endedAt: true };
  }) => Promise<Array<{ id?: string; startedAt: Date; endedAt: Date | null }>>;
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
    const openInterval = await delegate.findFirst({
      where: {
        sessionId,
        endedAt: null,
      },
      orderBy: {
        startedAt: "desc",
      },
    });

    if (openInterval) {
      console.info(
        `[session-pause-intervals] pause interval open skipped (already open): sessionId=${sessionId} openIntervalId=${openInterval.id}`,
      );
      return openInterval;
    }

    const created = await delegate.create({
      data: {
        sessionId,
        startedAt,
      },
    });
    console.info(
      `[session-pause-intervals] pause interval opened: sessionId=${sessionId} intervalId=${created.id} startedAt=${created.startedAt.toISOString()}`,
    );
    return created;
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
      console.info(
        `[session-pause-intervals] close skipped (no open interval): sessionId=${sessionId}`,
      );
      return null;
    }

    const closed = await delegate.update({
      where: { id: openInterval.id },
      data: { endedAt },
    });
    console.info(
      `[session-pause-intervals] pause interval closed: sessionId=${sessionId} intervalId=${closed.id} endedAt=${endedAt.toISOString()}`,
    );
    return closed;
  } catch (error) {
    console.error("[session-pause-intervals] Failed to close pause interval:", error);
    return null;
  }
}

export async function closeAllOpenPauseIntervals(sessionId: string, endedAt: Date) {
  const delegate = getPauseIntervalDelegate();
  if (!delegate) {
    console.warn(
      "[session-pause-intervals] Prisma delegate missing. Run `npx prisma generate` and restart the dev server.",
    );
    return 0;
  }

  let closedCount = 0;
  // Defensive loop in case legacy data has multiple open intervals.
  while (true) {
    const closed = await closeLatestPauseInterval(sessionId, endedAt);
    if (!closed) {
      break;
    }
    closedCount += 1;
  }

  console.info(
    `[session-pause-intervals] close-all completed: sessionId=${sessionId} closedCount=${closedCount}`,
  );
  return closedCount;
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
