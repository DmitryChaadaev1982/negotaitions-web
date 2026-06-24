import { DashboardView } from "@/components/dashboard-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { getTrainingEventsForList } from "@/lib/event-overview-stats";
import { prisma } from "@/lib/prisma";
import { getSessionsForList } from "@/lib/session-overview-stats";
import { activeCaseWhere, activeSessionWhere } from "@/lib/soft-delete";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const facilitator = await getDemoFacilitator();

  const [caseCount, sessionCount, eventCount, recentCases, allSessions, recentEvents] =
    await Promise.all([
      prisma.negotiationCase.count({
        where: { facilitatorId: facilitator.id, ...activeCaseWhere },
      }),
      prisma.session.count({
        where: { facilitatorId: facilitator.id, ...activeSessionWhere },
      }),
      prisma.trainingEvent.count({
        where: { deletedAt: null },
      }),
      prisma.negotiationCase.findMany({
        where: { facilitatorId: facilitator.id, ...activeCaseWhere },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          _count: { select: { roles: true } },
        },
      }),
      getSessionsForList(),
      getTrainingEventsForList(5),
    ]);

  const recentSessions = allSessions.slice(0, 5);

  return (
    <DashboardView
      caseCount={caseCount}
      sessionCount={sessionCount}
      eventCount={eventCount}
      recentCases={recentCases.map((negotiationCase) => ({
        id: negotiationCase.id,
        title: negotiationCase.title,
        difficulty: negotiationCase.difficulty,
        caseLanguage: negotiationCase.caseLanguage,
        roleCount: negotiationCase._count.roles,
        createdAt: negotiationCase.createdAt.toISOString(),
      }))}
      recentSessions={recentSessions.map((session) => ({
        id: session.id,
        title: session.title,
        caseTitle: session.caseTitle,
        status: session.status,
        createdAt: session.createdAt,
      }))}
      recentEvents={recentEvents.map((event) => ({
        id: event.id,
        title: event.title,
        status: event.status,
        lobbyParticipantCount: event.lobbyParticipantCount,
        sessionCount: event.sessionCount,
        activeSessionParticipantCount: event.activeSessionParticipantCount,
        totalSessionParticipantCount: event.totalSessionParticipantCount,
        createdAt: event.createdAt ?? new Date().toISOString(),
        hostToken: event.hostToken,
        hostParticipantToken: event.hostParticipantToken,
      }))}
    />
  );
}
