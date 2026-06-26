import { NewEventForm } from "@/components/new-event-form";
import { requireActiveUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const user = await requireActiveUser("/events/new");

  const activeUsers = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  return <NewEventForm currentUserId={user.id} activeUsers={activeUsers} />;
}
