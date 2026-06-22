import { CasesListView } from "@/components/cases-list-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const facilitator = await getDemoFacilitator();

  const cases = await prisma.negotiationCase.findMany({
    where: { facilitatorId: facilitator.id, ...activeCaseWhere },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { roles: true } },
    },
  });

  return (
    <CasesListView
      cases={cases.map((negotiationCase) => ({
        id: negotiationCase.id,
        title: negotiationCase.title,
        businessContext: negotiationCase.businessContext,
        difficulty: negotiationCase.difficulty,
        caseLanguage: negotiationCase.caseLanguage,
        roleCount: negotiationCase._count.roles,
        defaultDurationMinutes: secondsToDisplayMinutes(
          negotiationCase.defaultDurationSeconds,
        ),
        defaultPreparationDurationMinutes: secondsToDisplayMinutes(
          negotiationCase.defaultPreparationDurationSeconds,
        ),
        createdAt: negotiationCase.createdAt.toISOString(),
      }))}
    />
  );
}
