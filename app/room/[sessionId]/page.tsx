import VideoRoomPage from "@/components/video-room-page";
import { getOptionalCurrentUser, requireActiveUser } from "@/lib/auth";
import { canAccessSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { getServerDictionary } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { prisma } from "@/lib/prisma";

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

    // Phase 5 ROOM-1 fix: resolve participantId server-side without exposing joinToken.
    // participantId is a non-secret DB UUID; auth comes from the httpOnly session cookie.
    // The joinToken is never passed to the client component or serialized into __NEXT_DATA__.
    const access = await getCurrentUserSessionAccess(sessionId, user, {});
    if (!access || !canAccessSession(access)) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 app-gradient-bg px-4 text-center">
          <h1 className="text-lg font-bold text-slate-50">
            {translate(dictionary, "dashboard.noSessionAccess")}
          </h1>
        </div>
      );
    }

    // Find the user's own participant record, or fall back to event host/admin.
    let participantId: string | null = access.userParticipant?.id ?? null;
    if (!participantId && (access.isAdmin || access.isEventHostOwner)) {
      const facilitator = await prisma.sessionParticipant.findFirst({
        where: { sessionId, type: "FACILITATOR" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      participantId = facilitator?.id ?? null;
    }

    if (!participantId) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 app-gradient-bg px-4 text-center">
          <h1 className="text-lg font-bold text-slate-50">
            {translate(dictionary, "dashboard.noSessionAccess")}
          </h1>
        </div>
      );
    }

    // Account mode: no joinToken in props; VideoRoomPage authenticates via cookie.
    return (
      <VideoRoomPage
        authMode="account"
        sessionId={sessionId}
        participantId={participantId}
      />
    );
  }

  // Guest mode: joinToken flow unchanged.
  return (
    <VideoRoomPage sessionId={sessionId} joinToken={trimmedJoinToken} />
  );
}
