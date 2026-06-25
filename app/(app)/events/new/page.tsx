import { NewEventForm } from "@/components/new-event-form";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  await requireActiveUser("/events/new");
  return <NewEventForm />;
}
