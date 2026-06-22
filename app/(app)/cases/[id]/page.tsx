import { notFound } from "next/navigation";

import { CaseDetailView } from "@/components/case-detail-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type CaseDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { id } = await params;
  const facilitator = await getDemoFacilitator();

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id,
      facilitatorId: facilitator.id,
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
    <CaseDetailView
      negotiationCase={{
        id: negotiationCase.id,
        title: negotiationCase.title,
        businessContext: negotiationCase.businessContext,
        publicInstructions: negotiationCase.publicInstructions,
        targetSkills: negotiationCase.targetSkills || null,
        difficulty: negotiationCase.difficulty,
        caseLanguage: negotiationCase.caseLanguage,
        defaultDurationMinutes: secondsToDisplayMinutes(
          negotiationCase.defaultDurationSeconds,
        ),
        createdAt: negotiationCase.createdAt.toISOString(),
        isDeleted: negotiationCase.deletedAt != null,
        roles: negotiationCase.roles.map((role) => ({
          id: role.id,
          name: role.name,
          privateInstructions: role.privateInstructions,
        })),
      }}
    />
  );
}
