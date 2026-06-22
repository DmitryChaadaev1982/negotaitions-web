import { EventsListView } from "@/components/events-list-view";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await prisma.trainingEvent.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      participants: {
        where: { isHost: true },
        take: 1,
        select: { participantToken: true },
      },
      _count: {
        select: {
          participants: true,
          sessions: true,
        },
      },
    },
  });

  return (
    <EventsListView
      events={events.map((event) => ({
        id: event.id,
        title: event.title,
        status: event.status,
        scheduledAt: event.scheduledAt?.toISOString() ?? null,
        participantCount: event._count.participants,
        sessionCount: event._count.sessions,
        hostToken: event.hostToken,
        hostParticipantToken: event.participants[0]?.participantToken ?? null,
        publicJoinCode: event.publicJoinCode,
      }))}
    />
  );
}
