import VideoRoomPage from "@/components/video-room-page";
import { getServerDictionary } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

type RoomPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ joinToken?: string }>;
};

export default async function RoomPage({
  params,
  searchParams,
}: RoomPageProps) {
  const { sessionId } = await params;
  const { joinToken = "" } = await searchParams;
  const trimmedJoinToken = joinToken.trim();
  const { dictionary } = await getServerDictionary();

  if (!trimmedJoinToken) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 app-gradient-bg px-4 text-center">
        <h1 className="text-lg font-bold text-slate-50">
          {translate(dictionary, "room.missingJoinLink")}
        </h1>
        <p className="max-w-md text-sm text-slate-400">
          {translate(dictionary, "room.missingJoinLinkDescription")}
        </p>
      </div>
    );
  }

  return (
    <VideoRoomPage sessionId={sessionId} joinToken={trimmedJoinToken} />
  );
}
