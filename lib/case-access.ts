import type { VisibilityLevel } from "@/app/generated/prisma/client";

type CaseOwnerShape = {
  createdByUserId: string | null;
  facilitatorId: string;
};

type CaseViewerShape = {
  id: string;
};

type CaseVisibilityShape = CaseOwnerShape & {
  visibility: VisibilityLevel;
};

export function isCaseOwner(
  viewer: CaseViewerShape,
  negotiationCase: CaseOwnerShape,
): boolean {
  // Legacy compatibility: older rows may not have createdByUserId populated yet.
  return (
    negotiationCase.createdByUserId === viewer.id ||
    (!negotiationCase.createdByUserId &&
      negotiationCase.facilitatorId === viewer.id)
  );
}

export function canViewFullCase(
  viewer: CaseViewerShape,
  negotiationCase: CaseOwnerShape,
  isAdminViewer: boolean,
): boolean {
  return isAdminViewer || isCaseOwner(viewer, negotiationCase);
}

export function canViewCaseSafePreview(
  viewer: CaseViewerShape,
  negotiationCase: CaseVisibilityShape,
  isAdminViewer: boolean,
): boolean {
  if (isAdminViewer) {
    return true;
  }

  if (negotiationCase.visibility === "PUBLIC") {
    return true;
  }

  return isCaseOwner(viewer, negotiationCase);
}

export function caseVisibilityWhereForUser(userId: string) {
  return {
    OR: [
      { visibility: "PUBLIC" as const },
      { createdByUserId: userId },
      // Legacy compatibility path.
      { createdByUserId: null, facilitatorId: userId },
    ],
  };
}
