import { SessionsListView } from "@/components/sessions-list-view";
import { getSessionsForUser } from "@/lib/session-overview-stats";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const user = await requireActiveUser("/sessions");
  const sessions = await getSessionsForUser(user);

  return <SessionsListView sessions={sessions} />;
}
