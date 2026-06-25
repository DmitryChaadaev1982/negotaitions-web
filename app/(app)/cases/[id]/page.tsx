import { notFound, redirect } from "next/navigation";

import { CaseDetailView } from "@/components/case-detail-view";
import { getDemoFacilitator } from "@/lib/demo-user";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

type CaseDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/cases/${id}`);

  // /cases/[id] is an authoring page that exposes private role instructions.
  // Until a real case ownership relation exists (Phase C / Phase E), only
  // admins may view the full case detail. Non-admin users are redirected to
  // the cases list which shows public summaries only.
  if (!isAdmin(user)) {
    redirect("/cases");
  }

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
        defaultPreparationDurationMinutes: secondsToDisplayMinutes(
          negotiationCase.defaultPreparationDurationSeconds,
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
