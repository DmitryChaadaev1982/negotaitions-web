import { SessionsListView } from "@/components/sessions-list-view";
import { getSessionsForList } from "@/lib/session-overview-stats";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await getSessionsForList();

  return <SessionsListView sessions={sessions} />;
}
