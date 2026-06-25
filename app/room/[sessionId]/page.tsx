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

    // KNOWN REMAINING EXPOSURE (Phase 4.1 doc): accountJoinToken is server-resolved
    // from userId relation and never appears in the browser URL. However, VideoRoomPage
    // is a "use client" component that receives joinToken as a prop, so it will be
    // present in Next.js serialized page HTML (__NEXT_DATA__). A full elimination
    // requires refactoring VideoRoomPage and all LiveKit/control/presence APIs to
    // use account-based auth rather than joinToken. Planned for Phase 5.
    // Improvement vs pre-Phase-4: URL is tokenless; token is one indirection from DB.
    return <VideoRoomPage sessionId={sessionId} joinToken={accountJoinToken} />;
  }

  return (
    <VideoRoomPage sessionId={sessionId} joinToken={trimmedJoinToken} />
  );
}
