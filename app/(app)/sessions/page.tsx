import { SessionsListView } from "@/components/sessions-list-view";
import { getSessionsForList } from "@/lib/session-overview-stats";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const user = await requireActiveUser("/sessions");

  // Non-admin users see an empty list until Session.facilitatorId is linked to
  // a real User.id (Phase C), allowing per-user ownership scoping.
  const sessions = isAdmin(user) ? await getSessionsForList() : [];

  return <SessionsListView sessions={sessions} />;
}
