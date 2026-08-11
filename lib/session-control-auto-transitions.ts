import { Prisma } from "@/app/generated/prisma/client";
import { completeSessionCanonical } from "@/lib/session-completion";
import {
  getAutoFinishPreparationUpdateData,
  SESSION_CONTROL_SELECT,
  shouldAutoFinish,
  shouldAutoFinishPreparation,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  buildSessionCloseState,
  SESSION_CLOSE_SELECT,
} from "@/lib/session-close-state";
import {
  buildSessionControlSnapshotWhere,
  pickSessionControlSnapshot,
  SESSION_CONTROL_SNAPSHOT_SELECT,
} from "@/lib/session-control-snapshot";

export const SESSION_CONTROL_RECONCILIATION_SELECT = {
  ...SESSION_CONTROL_SELECT,
  ...SESSION_CONTROL_SNAPSHOT_SELECT,
  ...SESSION_CLOSE_SELECT,
} as const;

export type SessionControlReconciliationRow = Prisma.SessionGetPayload<{
  select: typeof SESSION_CONTROL_RECONCILIATION_SELECT;
}>;

async function readSession(sessionId: string) {
  return prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: SESSION_CONTROL_RECONCILIATION_SELECT,
  });
}

export async function reconcileSessionControlAutoTransitions(
  sessionId: string,
  now: Date = new Date(),
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const session = await readSession(sessionId);

    if (buildSessionCloseState(session).isClosed) {
      return session;
    }

    if (shouldAutoFinishPreparation(session, now)) {
      const snapshot = pickSessionControlSnapshot(session);
      const update = await prisma.session.updateMany({
        where: buildSessionControlSnapshotWhere(sessionId, snapshot),
        data: getAutoFinishPreparationUpdateData(session, now),
      });
      if (update.count === 0) {
        continue;
      }
      continue;
    }

    if (shouldAutoFinish(session, now)) {
      await completeSessionCanonical({
        sessionId,
        mode: "ROOM_FACILITATOR_FINISH",
        reason: "AUTO_TIMER_FINISH",
      });
      return readSession(sessionId);
    }

    return session;
  }

  return readSession(sessionId);
}
