import { EventsListView } from "@/components/events-list-view";
import { getEventsForUser } from "@/lib/event-overview-stats";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const user = await requireActiveUser("/events");
  const events = await getEventsForUser(user);

  return <EventsListView events={events} />;
}
