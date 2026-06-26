import { CasesListView } from "@/components/cases-list-view";
import { isAdmin } from "@/lib/auth/admin";
import { caseVisibilityWhereForUser } from "@/lib/case-access";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { toPublicCaseView } from "@/lib/privacy/serializers";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const user = await requireActiveUser("/cases");
  const adminViewer = isAdmin(user);

  const cases = await prisma.negotiationCase.findMany({
    where: {
      ...activeCaseWhere,
      ...(adminViewer ? {} : caseVisibilityWhereForUser(user.id)),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { roles: true } },
      roles: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true },
      },
      createdByUser: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return (
    <CasesListView
      cases={cases.map((negotiationCase) => {
        const publicCase = toPublicCaseView(negotiationCase);
        return {
          id: publicCase.id,
          title: publicCase.title,
          businessContext: publicCase.businessContext,
          difficulty: publicCase.difficulty as "EASY" | "MEDIUM" | "HARD",
          caseLanguage: publicCase.caseLanguage as "RU" | "EN",
          visibility: negotiationCase.visibility,
          createdByUserId: negotiationCase.createdByUserId,
          createdByLabel:
            negotiationCase.createdByUser?.name ??
            negotiationCase.createdByUser?.email ??
            null,
          isMyCase:
            negotiationCase.createdByUserId === user.id ||
            (negotiationCase.createdByUserId == null &&
              negotiationCase.facilitatorId === user.id),
          roleCount: negotiationCase._count.roles,
          defaultDurationMinutes: secondsToDisplayMinutes(
            publicCase.defaultDurationSeconds,
          ),
          defaultPreparationDurationMinutes: secondsToDisplayMinutes(
            publicCase.defaultPreparationDurationSeconds,
          ),
          createdAt: negotiationCase.createdAt.toISOString(),
        };
      })}
      isAdminViewer={adminViewer}
    />
  );
}
