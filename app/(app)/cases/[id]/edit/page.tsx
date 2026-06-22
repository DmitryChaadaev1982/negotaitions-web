import { notFound } from "next/navigation";

import { EditCasePageView } from "@/components/edit-case-page-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";

export const dynamic = "force-dynamic";

type EditCasePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCasePage({ params }: EditCasePageProps) {
  const { id } = await params;
  const facilitator = await getDemoFacilitator();

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id,
      facilitatorId: facilitator.id,
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

  return (
    <EditCasePageView
      caseId={negotiationCase.id}
      initialValues={{
        title: negotiationCase.title,
        businessContext: negotiationCase.businessContext,
        publicInstructions: negotiationCase.publicInstructions,
        caseLanguage: negotiationCase.caseLanguage,
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
