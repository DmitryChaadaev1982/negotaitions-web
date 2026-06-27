import { redirect } from "next/navigation";

import { EventLobbyView } from "@/components/event-lobby-view";
import { getOptionalCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type EventLobbyPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    hostToken?: string;
    participantToken?: string;
  }>;
};

export default async function EventLobbyPage({
  params,
  searchParams,
}: EventLobbyPageProps) {
  const { id } = await params;
  const { hostToken, participantToken } = await searchParams;
  const user = await getOptionalCurrentUser();

  if (!hostToken && !participantToken && !user) {
    // Redirect unauthenticated users to login so they can return here after signing in.
    redirect(`/login?returnUrl=${encodeURIComponent(`/events/${id}/lobby`)}`);
  }

  // Privacy hardening: account-mode lobby must never serialize token field names
  // into HTML/Flight payloads. Keep token access server-side and pass it only for
  // legacy token-based flows under neutral key names.
  if (user) {
    return <EventLobbyView eventId={id} />;
  }

  return <EventLobbyView eventId={id} tokenAccess={{ h: hostToken, p: participantToken }} />;
}
