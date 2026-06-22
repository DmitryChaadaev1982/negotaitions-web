import { notFound } from "next/navigation";

import { JoinEventForm } from "@/components/join-event-form";
import { TrainingEventStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

type JoinEventPageProps = {
  params: Promise<{ id: string }>;
};

export default async function JoinEventPage({ params }: JoinEventPageProps) {
  const { id } = await params;

  const event = await prisma.trainingEvent.findUnique({
    where: { id },
  });

  if (!event) {
    notFound();
  }

  if (
    event.deletedAt ||
    event.status === TrainingEventStatus.CANCELLED ||
    event.status === TrainingEventStatus.COMPLETED
  ) {
    const locale = await getServerLocale();
    const dict = getDictionary(locale);

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#020617] px-4 text-center">
        <h1 className="text-xl font-bold text-slate-50">
          {event.status === TrainingEventStatus.CANCELLED
            ? dict.events.eventCancelled
            : dict.events.eventCompleted}
        </h1>
        <p className="max-w-md text-slate-400">{dict.events.eventUnavailable}</p>
      </div>
    );
  }

  return <JoinEventForm eventId={event.id} eventTitle={event.title} />;
}
