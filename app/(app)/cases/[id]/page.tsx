import { notFound } from "next/navigation";

import { CaseDetailView } from "@/components/case-detail-view";
import {
  canViewCaseSafePreview,
  canViewFullCase,
  isCaseOwner,
} from "@/lib/case-access";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { toAdminCaseView, toPublicCaseView } from "@/lib/privacy/serializers";
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
  const adminViewer = isAdmin(user);

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
      createdByUser: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!negotiationCase) {
    notFound();
  }

  const owner = isCaseOwner(user, negotiationCase);
  const fullAccess = canViewFullCase(user, negotiationCase, adminViewer);
  const safePreviewAccess = canViewCaseSafePreview(
    user,
    negotiationCase,
    adminViewer,
  );

  if (!safePreviewAccess) {
    notFound();
  }

  if (!fullAccess) {
    const publicCase = toPublicCaseView(negotiationCase);
    return (
      <CaseDetailView
        negotiationCase={{
          id: publicCase.id,
          title: publicCase.title,
          businessContext: publicCase.businessContext,
          publicInstructions: publicCase.publicInstructions,
          targetSkills: publicCase.targetSkills || null,
          difficulty: publicCase.difficulty as "EASY" | "MEDIUM" | "HARD",
          caseLanguage: publicCase.caseLanguage as "RU" | "EN",
          visibility: negotiationCase.visibility,
          createdByLabel:
            negotiationCase.createdByUser?.name ??
            negotiationCase.createdByUser?.email ??
            null,
          createdAt: negotiationCase.createdAt.toISOString(),
          isDeleted: negotiationCase.deletedAt != null,
          defaultDurationMinutes: secondsToDisplayMinutes(
            negotiationCase.defaultDurationSeconds,
          ),
          defaultPreparationDurationMinutes: secondsToDisplayMinutes(
            negotiationCase.defaultPreparationDurationSeconds,
          ),
          mode: "safe-preview",
          isOwner: owner,
          isAdminViewer: false,
          showAdminWarning: false,
          roles: publicCase.roles.map((role) => ({
            id: role.id,
            name: role.name,
            privateInstructions: null,
          })),
        }}
      />
    );
  }

  const fullCase = adminViewer ? toAdminCaseView(negotiationCase) : negotiationCase;

  return (
    <CaseDetailView
      negotiationCase={{
        id: fullCase.id,
        title: fullCase.title,
        businessContext: fullCase.businessContext,
        publicInstructions: fullCase.publicInstructions,
        targetSkills: fullCase.targetSkills || null,
        difficulty: fullCase.difficulty,
        caseLanguage: fullCase.caseLanguage,
        visibility: fullCase.visibility,
        createdByLabel:
          fullCase.createdByUser?.name ?? fullCase.createdByUser?.email ?? null,
        defaultDurationMinutes: secondsToDisplayMinutes(
          fullCase.defaultDurationSeconds,
        ),
        defaultPreparationDurationMinutes: secondsToDisplayMinutes(
          fullCase.defaultPreparationDurationSeconds,
        ),
        createdAt: fullCase.createdAt.toISOString(),
        isDeleted: fullCase.deletedAt != null,
        mode: "full",
        isOwner: owner,
        isAdminViewer: adminViewer,
        showAdminWarning: adminViewer,
        roles: fullCase.roles.map((role) => ({
          id: role.id,
          name: role.name,
          privateInstructions: role.privateInstructions,
        })),
      }}
    />
  );
}
