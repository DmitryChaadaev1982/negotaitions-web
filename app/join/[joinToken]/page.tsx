import { notFound } from "next/navigation";

import { JoinPageView } from "@/components/join-page-view";
import { ParticipantPresenceHeartbeat } from "@/components/participant-presence-heartbeat";
import { ParticipantType } from "@/app/generated/prisma/client";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { sessionRoleBriefingSelect } from "@/lib/session-role";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";

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
      session: {
        include: {
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

  const isParticipant = participant.type === ParticipantType.PARTICIPANT;
  const isObserver = participant.type === ParticipantType.OBSERVER;
  const isFacilitator = participant.type === ParticipantType.FACILITATOR;
  const showNotes = isParticipant || isObserver || isFacilitator;

  const { session } = participant;
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

  return (
    <>
      <ParticipantPresenceHeartbeat joinToken={joinToken} />
      <JoinPageView
        joinToken={joinToken}
        session={{
          id: session.id,
          title: session.title,
          durationMinutes: secondsToDisplayMinutes(session.durationSeconds),
          displayStatus,
          isDeleted: session.deletedAt != null,
        }}
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
      />
    </>
  );
}
