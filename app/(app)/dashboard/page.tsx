import { DashboardView } from "@/components/dashboard-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import { activeCaseWhere, activeSessionWhere } from "@/lib/soft-delete";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const facilitator = await getDemoFacilitator();

  const [caseCount, sessionCount, recentCases, recentSessions] =
    await Promise.all([
      prisma.negotiationCase.count({
        where: { facilitatorId: facilitator.id, ...activeCaseWhere },
      }),
      prisma.session.count({
        where: { facilitatorId: facilitator.id, ...activeSessionWhere },
      }),
      prisma.negotiationCase.findMany({
        where: { facilitatorId: facilitator.id, ...activeCaseWhere },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          _count: { select: { roles: true } },
        },
      }),
      prisma.session.findMany({
        where: { facilitatorId: facilitator.id, ...activeSessionWhere },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          participants: {
            select: { type: true, joinedAt: true },
          },
        },
      }),
    ]);

  return (
    <DashboardView
      caseCount={caseCount}
      sessionCount={sessionCount}
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
        caseTitle: session.snapshotCaseTitle,
        status: resolveSessionDisplayStatus(session, session.participants),
        createdAt: session.createdAt.toISOString(),
      }))}
    />
  );
}
