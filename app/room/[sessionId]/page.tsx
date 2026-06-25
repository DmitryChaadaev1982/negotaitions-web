import VideoRoomPage from "@/components/video-room-page";
import { getOptionalCurrentUser, requireActiveUser } from "@/lib/auth";
import { resolveJoinTokenForAccountSession } from "@/lib/account-session-access";
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
  const { joinToken } = await searchParams;
  const trimmedJoinToken = (joinToken ?? "").trim();
  const { dictionary } = await getServerDictionary();

  if (!trimmedJoinToken) {
    const optionalUser = await getOptionalCurrentUser();
    if (!optionalUser) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 app-gradient-bg px-4 text-center">
          <h1 className="text-lg font-bold text-slate-50">
            {translate(dictionary, "room.missingJoinLink")}
          </h1>
          <p className="max-w-md text-sm text-slate-400">
            {translate(dictionary, "auth.login")}
          </p>
        </div>
      );
    }

    const user = await requireActiveUser(`/room/${sessionId}`);
    const accountJoinToken = await resolveJoinTokenForAccountSession(sessionId, user);
    if (!accountJoinToken) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 app-gradient-bg px-4 text-center">
          <h1 className="text-lg font-bold text-slate-50">
            {translate(dictionary, "dashboard.noSessionAccess")}
          </h1>
        </div>
      );
    }

    return <VideoRoomPage sessionId={sessionId} joinToken={accountJoinToken} />;
  }

  return (
    <VideoRoomPage sessionId={sessionId} joinToken={trimmedJoinToken} />
  );
}
