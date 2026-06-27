"use client";

import { PageHeader } from "@/components/page-header";
import {
  NewCaseForm,
  type CaseFormInitialValues,
} from "@/components/new-case-form";
import { useI18n } from "@/lib/i18n/useI18n";

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};

type EditCasePageViewProps = {
  caseId: string;
  currentUserId: string;
  currentUserEmail: string;
  activeUsers: UserOption[];
  canAssignOwner: boolean;
  currentOwnerUserId: string;
  initialValues: CaseFormInitialValues;
};

export function EditCasePageView({
  caseId,
  currentUserId,
  currentUserEmail,
  activeUsers,
  canAssignOwner,
  currentOwnerUserId,
  initialValues,
}: EditCasePageViewProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("cases.editCase")}
        description={t("cases.editCasePageDescription")}
      />
      <NewCaseForm
        caseId={caseId}
        currentUserId={currentUserId}
        currentUserEmail={currentUserEmail}
        activeUsers={activeUsers}
        canAssignOwner={canAssignOwner}
        currentOwnerUserId={currentOwnerUserId}
        initialValues={initialValues}
      />
    </div>
  );
}
