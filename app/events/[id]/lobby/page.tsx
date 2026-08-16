import { redirect } from "next/navigation";

import { EventLobbyView } from "@/components/event-lobby-view";
import { getOptionalCurrentUser } from "@/lib/auth";
import { getVideoProvider } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getVoxProviderFaultMode } from "@/lib/test-mode";
import { privateIndexingMetadata } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";
export const metadata = privateIndexingMetadata;

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
  const videoProvider = getVideoProvider();

  const event = await prisma.trainingEvent.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!event) {
    redirect("/events");
  }

  if (!hostToken && !participantToken && !user) {
    // Redirect unauthenticated users to login so they can return here after signing in.
    redirect(`/login?returnUrl=${encodeURIComponent(`/events/${id}/lobby`)}`);
  }

  // Privacy hardening: account-mode lobby must never serialize token field names
  // into HTML/Flight payloads. Keep token access server-side and pass it only for
  // legacy token-based flows under neutral key names.
  // Always "off" unless the server runs with EXTERNAL_SERVICES_MODE=mock, which
  // only the E2E web server sets. See lib/voximplant/provider-fault-simulation.
  const providerFaultSimulation = getVoxProviderFaultMode();

  if (user) {
    return (
      <EventLobbyView
        eventId={id}
        videoProvider={videoProvider}
        providerFaultSimulation={providerFaultSimulation}
      />
    );
  }

  return (
    <EventLobbyView
      eventId={id}
      videoProvider={videoProvider}
      providerFaultSimulation={providerFaultSimulation}
      tokenAccess={{ h: hostToken, p: participantToken }}
    />
  );
}
