import { NewSessionPageClient } from "@/components/new-session-page-client";
import { caseVisibilityWhereForUser } from "@/lib/case-access";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

type NewSessionPageProps = {
  searchParams: Promise<{ caseId?: string }>;
};

export default async function NewSessionPage({
  searchParams,
}: NewSessionPageProps) {
  const user = await requireActiveUser("/sessions/new");
  const { caseId } = await searchParams;
  const userIsAdmin = isAdmin(user);

  const caseWhere = userIsAdmin
    ? { ...activeCaseWhere }
    : { ...activeCaseWhere, ...caseVisibilityWhereForUser(user.id) };

  const cases = await prisma.negotiationCase.findMany({
    where: caseWhere,
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      caseLanguage: true,
      visibility: true,
      createdByUserId: true,
      defaultDurationSeconds: true,
      defaultPreparationDurationSeconds: true,
      createdByUser: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const activeUsers = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  const requestedDeletedCase =
    caseId != null
      ? await prisma.negotiationCase.findFirst({
          where: userIsAdmin
            ? { id: caseId, deletedAt: { not: null } }
            : { id: caseId, ...caseVisibilityWhereForUser(user.id), deletedAt: { not: null } },
          select: { id: true },
        })
      : null;

  const defaultCaseId =
    caseId && cases.some((negotiationCase) => negotiationCase.id === caseId)
      ? caseId
      : cases[0]?.id;

  return (
    <NewSessionPageClient
      cases={cases.map((c) => ({
        id: c.id,
        title: c.title,
        caseLanguage: c.caseLanguage,
        visibility: c.visibility,
        defaultDurationSeconds: c.defaultDurationSeconds,
        defaultPreparationDurationSeconds: c.defaultPreparationDurationSeconds,
        ownerLabel: c.createdByUser?.name ?? c.createdByUser?.email ?? null,
      }))}
      defaultCaseId={defaultCaseId}
      deletedCaseError={requestedDeletedCase != null}
      currentUserId={user.id}
      currentUserEmail={user.email}
      activeUsers={activeUsers}
      canAssignFacilitator={userIsAdmin}
    />
  );
}
