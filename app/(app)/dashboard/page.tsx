import { AccountDashboardView } from "@/components/account-dashboard-view";
import { getEventsForUser } from "@/lib/event-overview-stats";
import { getSessionsForUser } from "@/lib/session-overview-stats";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireActiveUser("/dashboard");
  const isAdminUser = isAdmin(user);

  const [allEvents, allSessions] = await Promise.all([
    getEventsForUser(user),
    getSessionsForUser(user),
  ]);

  return (
    <AccountDashboardView
      initialSessions={allSessions}
      initialEvents={allEvents}
      currentUserId={user.id}
      isAdmin={isAdminUser}
    />
  );
}
