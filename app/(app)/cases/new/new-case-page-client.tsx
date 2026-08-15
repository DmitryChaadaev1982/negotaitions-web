"use client";

import { PageHeader } from "@/components/page-header";
import { NewCaseForm } from "@/components/new-case-form";
import { ObjectPictogram } from "@/components/object-pictogram";
import { useI18n } from "@/lib/i18n/useI18n";

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};

type NewCasePageProps = {
  currentUserId: string;
  currentUserEmail: string;
  activeUsers: UserOption[];
  canAssignOwner: boolean;
};

export function NewCasePage({
  currentUserId,
  currentUserEmail,
  activeUsers,
  canAssignOwner,
}: NewCasePageProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("cases.newCase")}
        description={t("cases.newCasePageDescription")}
        pictogram={
          <ObjectPictogram
            objectType="case"
            size={64}
            className="h-16 w-16 shrink-0"
            data-object-type="case"
          />
        }
      />
      <NewCaseForm
        currentUserId={currentUserId}
        currentUserEmail={currentUserEmail}
        activeUsers={activeUsers}
        canAssignOwner={canAssignOwner}
      />
    </div>
  );
}
