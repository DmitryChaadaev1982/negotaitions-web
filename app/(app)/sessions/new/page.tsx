import { NewSessionPageClient } from "@/components/new-session-page-client";
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
  const user = await requireActiveUser("/sessions/new");
  const { caseId } = await searchParams;

  const cases = await prisma.negotiationCase.findMany({
    where: { facilitatorId: user.id, ...activeCaseWhere },
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
            facilitatorId: user.id,
            deletedAt: { not: null },
          },
          select: { id: true },
        })
      : null;

  const defaultCaseId =
    caseId && cases.some((negotiationCase) => negotiationCase.id === caseId)
      ? caseId
      : cases[0]?.id;

  const activeUsers = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  return (
    <NewSessionPageClient
      cases={cases}
      defaultCaseId={defaultCaseId}
      deletedCaseError={requestedDeletedCase != null}
      currentUserId={user.id}
      activeUsers={activeUsers}
    />
  );
}
