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
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] px-4 text-slate-400">
        Invalid access link.
      </div>
    );
  }

  return (
    <EventLobbyView
      eventId={id}
      hostToken={hostToken}
      participantToken={participantToken}
    />
  );
}
