import { SessionsListView } from "@/components/sessions-list-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import { activeSessionWhere } from "@/lib/soft-delete";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const facilitator = await getDemoFacilitator();

  const sessions = await prisma.session.findMany({
    where: { facilitatorId: facilitator.id, ...activeSessionWhere },
    orderBy: { createdAt: "desc" },
    include: {
      participants: {
        select: { type: true, joinedAt: true },
      },
      _count: { select: { participants: true } },
    },
  });

  return (
    <SessionsListView
      sessions={sessions.map((session) => ({
        id: session.id,
        title: session.title,
        caseTitle: session.snapshotCaseTitle,
        status: resolveSessionDisplayStatus(session, session.participants),
        participantCount: session._count.participants,
        durationMinutes: secondsToDisplayMinutes(session.durationSeconds),
        createdAt: session.createdAt.toISOString(),
      }))}
    />
  );
}
