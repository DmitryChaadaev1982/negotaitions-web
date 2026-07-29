import { CasesListView } from "@/components/cases-list-view";
import { requireActiveUser } from "@/lib/auth";
import { getCasesForUser } from "@/lib/case-overview";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const user = await requireActiveUser("/cases");
  const { cases, isAdminViewer } = await getCasesForUser(user);

  return (
    <CasesListView
      cases={cases}
      isAdminViewer={isAdminViewer}
    />
  );
}
