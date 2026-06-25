import { EventsListView } from "@/components/events-list-view";
import { getTrainingEventsForList } from "@/lib/event-overview-stats";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const user = await requireActiveUser("/events");

  // Non-admin users see an empty list until TrainingEvent.hostUserId is
  // implemented (Phase C) and each event can be owner-scoped to the viewer.
  const events = isAdmin(user) ? await getTrainingEventsForList() : [];

  return <EventsListView events={events} />;
}
