import { NewEventForm } from "@/components/new-event-form";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const user = await requireActiveUser("/events/new");
  const canAssignFacilitator = isAdmin(user);

  const activeUsers = await prisma.user.findMany({
    where: canAssignFacilitator
      ? { status: "ACTIVE" }
      : { id: user.id, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  return (
    <NewEventForm
      currentUserId={user.id}
      currentUserEmail={user.email}
      activeUsers={activeUsers}
      canAssignFacilitator={canAssignFacilitator}
    />
  );
}
