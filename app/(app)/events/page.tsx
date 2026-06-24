import { EventsListView } from "@/components/events-list-view";
import { getTrainingEventsForList } from "@/lib/event-overview-stats";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getTrainingEventsForList();

  return <EventsListView events={events} />;
}
