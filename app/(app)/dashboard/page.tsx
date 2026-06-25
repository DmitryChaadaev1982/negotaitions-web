import { DashboardView } from "@/components/dashboard-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { getEventsForUser } from "@/lib/event-overview-stats";
import { prisma } from "@/lib/prisma";
import { getSessionsForUser } from "@/lib/session-overview-stats";
import { activeCaseWhere } from "@/lib/soft-delete";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireActiveUser("/dashboard");
  const isAdminUser = isAdmin(user);

  const [allEvents, allSessions] = await Promise.all([
    getEventsForUser(user),
    getSessionsForUser(user),
  ]);
  const recentEvents = allEvents.slice(0, 5);

  const [caseCount, recentCases] = isAdminUser
    ? await (async () => {
        const facilitator = await getDemoFacilitator();
        const [count, cases] = await Promise.all([
          prisma.negotiationCase.count({
            where: { facilitatorId: facilitator.id, ...activeCaseWhere },
          }),
          prisma.negotiationCase.findMany({
            where: { facilitatorId: facilitator.id, ...activeCaseWhere },
            orderBy: { createdAt: "desc" },
            take: 5,
            include: {
              _count: { select: { roles: true } },
            },
          }),
        ]);
        return [count, cases] as const;
      })()
    : ([0, []] as const);

  const sessionCount = allSessions.length;
  const eventCount = allEvents.length;

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
        canManage: event.canManage,
        lobbyParticipantCount: event.lobbyParticipantCount,
        sessionCount: event.sessionCount,
        totalSessions: event.totalSessions,
        activeSessions: event.activeSessions,
        finishedSessions: event.finishedSessions,
        participantsInLobby: event.participantsInLobby,
        participantsInActiveSessions: event.participantsInActiveSessions,
        uniqueParticipantsWithSessions: event.uniqueParticipantsWithSessions,
        latestActivityAt: event.latestActivityAt,
        activeSessionParticipantCount: event.activeSessionParticipantCount,
        totalSessionParticipantCount: event.totalSessionParticipantCount,
        createdAt: event.createdAt ?? new Date().toISOString(),
      }))}
    />
  );
}
