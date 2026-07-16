import { notFound, redirect } from "next/navigation";

import VideoRoomPage from "@/components/video-room-page";
import VoximplantNegotiationRoomPage from "@/components/voximplant-negotiation-room-page";
import { getOptionalCurrentUser, requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { getVideoProvider } from "@/lib/env";
import { getServerDictionary } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { prisma } from "@/lib/prisma";
import { ensureAccountRoomParticipant } from "@/lib/room-participant-resolver";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";

type RoomPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{
    joinToken?: string;
    /** Pass ?camera=off to skip initial camera capture (multi-user local testing). */
    camera?: string;
    /** Pass ?mic=off to skip initial microphone capture (multi-user local testing). */
    mic?: string;
    /** Pass ?media=off to skip both camera and microphone on initial join. */
    media?: string;
    /** Pass ?debugAudio=1 to show the audio diagnostics panel. */
    debugAudio?: string;
    /** Pass ?debugRecording=1 to show the recording diagnostics panel (dev-only). */
    debugRecording?: string;
  }>;
};

export default async function RoomPage({
  params,
  searchParams,
}: RoomPageProps) {
  const provider = getVideoProvider();
  const { sessionId } = await params;
  const { joinToken, camera, mic, media, debugAudio, debugRecording } = await searchParams;
  const trimmedJoinToken = (joinToken ?? "").trim();
  const disableInitialCamera = camera === "off" || media === "off";
  const disableInitialMic = mic === "off" || media === "off";
  const showDebugAudio = debugAudio === "1";
  const showDebugRecording = debugRecording === "1";
  const { dictionary } = await getServerDictionary();

  if (!trimmedJoinToken) {
    const optionalUser = await getOptionalCurrentUser();
    if (!optionalUser) {
      redirect(`/login?returnUrl=${encodeURIComponent(`/room/${sessionId}`)}`);
    }

    const user = await requireActiveUser(`/room/${sessionId}`);

    // Resolve/create the caller's own participant row server-side without exposing joinToken.
    const participantResult = await ensureAccountRoomParticipant(sessionId, user);
    if (participantResult.kind === "denied") {
      if (participantResult.redirectTo) {
        redirect(participantResult.redirectTo);
      }
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 app-gradient-bg px-4 text-center">
          <h1 className="text-lg font-bold text-slate-50">
            {translate(dictionary, "dashboard.noSessionAccess")}
          </h1>
        </div>
      );
    }
    const participant = participantResult.participant;

    const decision = decideSessionRoomAccess({
      user: {
        isAuthenticated: true,
        isAuthorizedMember: true,
      },
      session: {
        sessionId,
        negotiationState: participant.session.negotiationState,
        roomLifecycle: participant.session.roomLifecycle ?? null,
        deletedAt: participant.session.deletedAt ?? null,
        closeReason: participant.session.closeReason ?? null,
        closedByEventAt: participant.session.closedByEventAt ?? null,
        eventId: participant.session.eventId ?? null,
        eventStatus: participant.session.event?.status ?? null,
      },
      redirect: {
        sessionId,
        participantJoinToken: participant.joinToken,
        eventId: participant.session.eventId ?? null,
        eventStatus: participant.session.event?.status ?? null,
        preferEventResultsForEventOwner: participant.type === "FACILITATOR",
      },
    });
    if (!isRoomAccessAllowed(decision.output)) {
      if (decision.redirectTo) {
        redirect(decision.redirectTo);
      }
      notFound();
    }

    // Account mode: no joinToken in props; VideoRoomPage authenticates via cookie.
    return provider === "voximplant" ? (
      <VoximplantNegotiationRoomPage
        authMode="account"
        sessionId={sessionId}
        participantId={participant.id}
        disableInitialCamera={disableInitialCamera}
        disableInitialMic={disableInitialMic}
        debugAudio={showDebugAudio}
        debugRecording={showDebugRecording}
      />
    ) : (
      <VideoRoomPage
        authMode="account"
        sessionId={sessionId}
        participantId={participant.id}
      />
    );
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken: trimmedJoinToken },
    select: {
      id: true,
      sessionId: true,
      userId: true,
      eventParticipant: {
        select: {
          id: true,
          userId: true,
        },
      },
      session: {
        select: { deletedAt: true },
      },
    },
  });

  if (!participant || participant.sessionId !== sessionId || participant.session.deletedAt) {
    notFound();
  }

  const optionalUser = await getOptionalCurrentUser();
  if (!optionalUser) {
    const returnUrl = encodeURIComponent(
      `/room/${sessionId}?joinToken=${trimmedJoinToken}`,
    );
    redirect(`/login?returnUrl=${returnUrl}`);
  }

  if (!isAdmin(optionalUser) && optionalUser.status !== "ACTIVE") {
    if (optionalUser.status === "PENDING_APPROVAL") redirect("/pending-approval");
    if (optionalUser.status === "REJECTED") redirect("/account/rejected");
    if (optionalUser.status === "BLOCKED") redirect("/account/blocked");
    notFound();
  }

  const sessionOwnedByAnotherUser =
    participant.userId && participant.userId !== optionalUser.id;
  const eventOwnedByAnotherUser =
    participant.eventParticipant?.userId &&
    participant.eventParticipant.userId !== optionalUser.id;
  if (sessionOwnedByAnotherUser || eventOwnedByAnotherUser) {
    notFound();
  }

  const existingUserParticipant = await prisma.sessionParticipant.findFirst({
    where: { sessionId, userId: optionalUser.id },
    select: { id: true },
  });

  if (!existingUserParticipant) {
    await prisma.$transaction(async (tx) => {
      await tx.sessionParticipant.updateMany({
        where: { id: participant.id, userId: null },
        data: { userId: optionalUser.id },
      });

      if (participant.eventParticipant?.id) {
        await tx.eventParticipant.updateMany({
          where: { id: participant.eventParticipant.id, userId: null },
          data: { userId: optionalUser.id },
        });
      }
    });
  }

  redirect(`/room/${sessionId}`);
}
