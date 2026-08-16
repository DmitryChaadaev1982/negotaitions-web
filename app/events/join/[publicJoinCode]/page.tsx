import { notFound, redirect } from "next/navigation";

import { findEventByPublicJoinCode } from "@/lib/event-auth";
import { privateIndexingMetadata } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";
export const metadata = privateIndexingMetadata;

type PublicJoinPageProps = {
  params: Promise<{ publicJoinCode: string }>;
};

export default async function PublicEventJoinPage({ params }: PublicJoinPageProps) {
  const { publicJoinCode } = await params;

  const event = await findEventByPublicJoinCode(publicJoinCode);

  if (!event) {
    notFound();
  }

  if (event.visibility !== "PUBLIC") {
    notFound();
  }

  redirect(`/events/${event.id}/join`);
}
