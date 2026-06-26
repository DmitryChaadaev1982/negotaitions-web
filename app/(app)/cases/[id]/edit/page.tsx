import { notFound } from "next/navigation";

import { EditCasePageView } from "@/components/edit-case-page-view";
import { canManageCase } from "@/lib/case-access";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

type EditCasePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCasePage({ params }: EditCasePageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/cases/${id}/edit`);
  const adminViewer = isAdmin(user);

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id,
      ...activeCaseWhere,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!negotiationCase) {
    notFound();
  }

  if (!canManageCase(user, negotiationCase, adminViewer)) {
    notFound();
  }

  return (
    <EditCasePageView
      caseId={negotiationCase.id}
      initialValues={{
        title: negotiationCase.title,
        businessContext: negotiationCase.businessContext,
        publicInstructions: negotiationCase.publicInstructions,
        difficulty: negotiationCase.difficulty,
        caseLanguage: negotiationCase.caseLanguage,
        visibility: negotiationCase.visibility,
        defaultDurationMinutes: secondsToDisplayMinutes(
          negotiationCase.defaultDurationSeconds,
        ),
        defaultPreparationDurationMinutes: secondsToDisplayMinutes(
          negotiationCase.defaultPreparationDurationSeconds,
        ),
        roles: negotiationCase.roles.map((role) => ({
          name: role.name,
          privateInstructions: role.privateInstructions,
        })),
      }}
    />
  );
}
