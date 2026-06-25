import { notFound } from "next/navigation";

import { JoinPageView } from "@/components/join-page-view";
import { JoinRecoverySync } from "@/components/join-recovery-sync";
import { ParticipantPresenceHeartbeat } from "@/components/participant-presence-heartbeat";
import { ParticipantType } from "@/app/generated/prisma/client";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { sessionRoleBriefingSelect } from "@/lib/session-role";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import { buildSessionCloseState } from "@/lib/session-close-state";
import { getEventLobbyUrl } from "@/lib/config";
import { isSessionActiveForAssignment } from "@/lib/event-active-assignment";

export const dynamic = "force-dynamic";

type JoinPageProps = {
  params: Promise<{ joinToken: string }>;
};

export default async function JoinPage({ params }: JoinPageProps) {
  const { joinToken } = await params;

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: {
      sessionRole: {
        select: sessionRoleBriefingSelect,
      },
      eventParticipant: {
        select: {
          id: true,
          userId: true,
          participantToken: true,
        },
      },
      session: {
        include: {
          recording: {
            select: {
              status: true,
              fileUrl: true,
              updatedAt: true,
              errorMessage: true,
            },
          },
          transcript: {
            select: {
              text: true,
              diarizedText: true,
              updatedAt: true,
            },
          },
          event: {
            select: {
              id: true,
              title: true,
              status: true,
              hostToken: true,
            },
          },
          participants: {
            select: {
              id: true,
              displayName: true,
              type: true,
              joinedAt: true,
              sessionRole: {
                select: sessionRoleBriefingSelect,
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!participant) {
    notFound();
  }

  const currentUser = await getOptionalCurrentUser();
  const currentUserCanBind = Boolean(
    currentUser && (isAdmin(currentUser) || currentUser.status === "ACTIVE"),
  );
  if (currentUserCanBind) {
    const sessionOwnedByAnotherUser =
      participant.userId &&
      participant.userId !== currentUser!.id;
    const eventOwnedByAnotherUser =
      participant.eventParticipant?.userId &&
      participant.eventParticipant.userId !== currentUser!.id;
    if (sessionOwnedByAnotherUser || eventOwnedByAnotherUser) {
      notFound();
    }

    if (!participant.userId || !participant.eventParticipant?.userId) {
      await prisma.$transaction(async (tx) => {
        if (!participant.userId) {
          // Conditional WHERE prevents a concurrent request from overwriting
          // a userId that was just bound by a racing request (TOCTOU guard).
          await tx.sessionParticipant.updateMany({
            where: { id: participant.id, userId: null },
            data: { userId: currentUser!.id },
          });
        }
        if (participant.eventParticipant?.id && !participant.eventParticipant.userId) {
          await tx.eventParticipant.updateMany({
            where: { id: participant.eventParticipant.id, userId: null },
            data: { userId: currentUser!.id },
          });
        }
      });
    }
  }

  const isParticipant = participant.type === ParticipantType.PARTICIPANT;
  const isObserver = participant.type === ParticipantType.OBSERVER;
  const isFacilitator = participant.type === ParticipantType.FACILITATOR;
  const showNotes = isParticipant || isObserver || isFacilitator;

  const { session } = participant;
  const sessionCloseState = buildSessionCloseState({
    negotiationState: session.negotiationState,
    negotiationStartedAt: session.negotiationStartedAt,
    closedByEventAt: session.closedByEventAt,
    closeReason: session.closeReason,
    event: session.eventId
      ? await prisma.trainingEvent.findUnique({
          where: { id: session.eventId },
          select: { status: true },
        })
      : null,
  });
  const displayStatus = resolveSessionDisplayStatus(
    session,
    session.participants,
  );
  const assignedParticipants = session.participants
    .filter((sessionParticipant) => sessionParticipant.sessionRole)
    .map((sessionParticipant) => ({
      id: sessionParticipant.id,
      displayName: sessionParticipant.displayName,
      role: sessionParticipant.sessionRole!,
    }));

  const notesVariant = isParticipant
    ? "preparation"
    : isObserver
      ? "observer"
      : "facilitator";
  const eventSessions = session.eventId
    ? await prisma.sessionParticipant.findMany({
        where: isFacilitator
          ? {
              session: {
                eventId: session.eventId,
                deletedAt: null,
              },
              type: ParticipantType.FACILITATOR,
            }
          : {
              eventParticipantId: participant.eventParticipantId,
              session: {
                eventId: session.eventId,
                deletedAt: null,
              },
            },
        include: {
          sessionRole: {
            select: {
              name: true,
            },
          },
          session: {
            select: {
              id: true,
              title: true,
              roomLabel: true,
              snapshotCaseTitle: true,
              negotiationState: true,
              status: true,
              deletedAt: true,
              closedByEventAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const eventLobbyUrl =
    session.event && session.eventId
      ? getEventLobbyUrl(session.eventId, {
          hostToken: isFacilitator ? session.event.hostToken : undefined,
          participantToken: participant.eventParticipant?.participantToken,
        })
      : null;

  return (
    <>
      <JoinRecoverySync
        joinToken={joinToken}
        sessionId={session.id}
        displayName={participant.displayName}
        eventId={session.eventId}
      />
      <ParticipantPresenceHeartbeat joinToken={joinToken} />
      <JoinPageView
        joinToken={joinToken}
        session={{
          id: session.id,
          title: session.title,
          caseTitle: session.snapshotCaseTitle,
          roomLabel: session.roomLabel,
          preparationDurationMinutes: secondsToDisplayMinutes(
            session.preparationDurationSeconds,
          ),
          negotiationDurationMinutes: secondsToDisplayMinutes(
            session.durationSeconds,
          ),
          displayStatus,
          negotiationState: session.negotiationState,
          isDeleted: session.deletedAt != null,
          closedByEvent: sessionCloseState.isClosed,
          closedBeforeNegotiation: sessionCloseState.closedBeforeNegotiation,
          closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
        }}
        event={
          session.event && eventLobbyUrl
            ? {
                title: session.event.title,
                lobbyUrl: eventLobbyUrl,
              }
            : null
        }
        eventSessions={eventSessions.map((item) => ({
          id: item.session.id,
          roomLabel: item.session.roomLabel,
          title: item.session.title,
          caseTitle: item.session.snapshotCaseTitle,
          roleName: item.sessionRole?.name ?? null,
          status: item.session.status,
          createdAt: item.session.createdAt.toISOString(),
          joinToken: item.joinToken,
          isActive: isSessionActiveForAssignment(item.session),
        }))}
        participant={{
          displayName: participant.displayName,
          type: participant.type,
          notes: participant.notes,
        }}
        negotiationCase={{
          description: session.snapshotBusinessContext,
          publicInstructions: session.snapshotPublicInstructions,
          caseLanguage: session.snapshotCaseLanguage,
        }}
        caseRole={isParticipant ? participant.sessionRole : null}
        assignedParticipants={assignedParticipants}
        showNotes={showNotes}
        notesVariant={notesVariant}
        recording={
          session.recording
            ? {
                status: session.recording.status,
                fileUrl: session.recording.fileUrl,
                updatedAt: session.recording.updatedAt.toISOString(),
                errorMessage: session.recording.errorMessage,
              }
            : null
        }
        transcript={
          session.transcript
            ? {
                text: session.transcript.text,
                diarizedText: session.transcript.diarizedText,
                updatedAt: session.transcript.updatedAt.toISOString(),
              }
            : null
        }
      />
    </>
  );
}
