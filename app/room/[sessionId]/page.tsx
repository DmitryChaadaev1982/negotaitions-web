import VideoRoomPage from "@/components/video-room-page";

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

  if (!trimmedJoinToken) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <h1 className="text-lg font-semibold text-slate-900">
          Missing join link
        </h1>
        <p className="max-w-md text-sm text-slate-600">
          Open the video room from your session join page so your access token
          is included.
        </p>
      </div>
    );
  }

  return (
    <VideoRoomPage sessionId={sessionId} joinToken={trimmedJoinToken} />
  );
}
