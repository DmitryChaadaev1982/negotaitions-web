import { NewSessionPageClient } from "@/components/new-session-page-client";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type NewSessionPageProps = {
  searchParams: Promise<{ caseId?: string }>;
};

export default async function NewSessionPage({
  searchParams,
}: NewSessionPageProps) {
  await requireActiveUser("/sessions/new");
  const { caseId } = await searchParams;
  const facilitator = await getDemoFacilitator();

  const cases = await prisma.negotiationCase.findMany({
    where: { facilitatorId: facilitator.id, ...activeCaseWhere },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      caseLanguage: true,
      defaultDurationSeconds: true,
      defaultPreparationDurationSeconds: true,
    },
  });

  const requestedDeletedCase =
    caseId != null
      ? await prisma.negotiationCase.findFirst({
          where: {
            id: caseId,
            facilitatorId: facilitator.id,
            deletedAt: { not: null },
          },
          select: { id: true },
        })
      : null;

  const defaultCaseId =
    caseId && cases.some((negotiationCase) => negotiationCase.id === caseId)
      ? caseId
      : cases[0]?.id;

  return (
    <NewSessionPageClient
      cases={cases}
      defaultCaseId={defaultCaseId}
      deletedCaseError={requestedDeletedCase != null}
    />
  );
}
