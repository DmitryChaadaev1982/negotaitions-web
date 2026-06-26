import { notFound } from "next/navigation";

import { EventEditForm } from "@/components/event-edit-form";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { canEditEvent, getCurrentUserEventAccess } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type EventEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EventEditPage({ params }: EventEditPageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/events/${id}/edit`);

  const access = await getCurrentUserEventAccess(id, user, {});
  if (!access || !canEditEvent(access)) {
    notFound();
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledAt: true,
      estimatedEventDurationSeconds: true,
      visibility: true,
      facilitatorUserId: true,
      hostUserId: true,
      status: true,
      deletedAt: true,
      invites: {
        select: {
          id: true,
          userId: true,
          invitedEmail: true,
          invitedEmailNormalized: true,
          displayLabel: true,
        },
      },
    },
  });

  if (!event || event.deletedAt) {
    notFound();
  }

  const userIsAdmin = isAdmin(user);

  const invitedUserIds = event.invites
    .filter((inv) => inv.userId)
    .map((inv) => inv.userId as string);

  const [activeUsers, invitedUsers] = await Promise.all([
    prisma.user.findMany({
      where: userIsAdmin
        ? { status: "ACTIVE" }
        : { id: user.id, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    invitedUserIds.length
      ? prisma.user.findMany({
          where: { id: { in: invitedUserIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  const invitedEmails = event.invites
    .filter((inv) => !inv.userId && inv.invitedEmailNormalized)
    .map((inv) => inv.invitedEmailNormalized as string);

  return (
    <EventEditForm
      event={event}
      currentUserId={user.id}
      currentUserEmail={user.email}
      activeUsers={activeUsers}
      canAssignFacilitator={userIsAdmin}
      initialInvitedUsers={invitedUsers}
      initialInvitedEmails={invitedEmails}
    />
  );
}
