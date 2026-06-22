import { notFound, redirect } from "next/navigation";

import { findEventByPublicJoinCode } from "@/lib/event-auth";

export const dynamic = "force-dynamic";

type PublicJoinPageProps = {
  params: Promise<{ publicJoinCode: string }>;
};

export default async function PublicEventJoinPage({ params }: PublicJoinPageProps) {
  const { publicJoinCode } = await params;

  const event = await findEventByPublicJoinCode(publicJoinCode);

  if (!event) {
    notFound();
  }

  redirect(`/events/${event.id}/join`);
}
