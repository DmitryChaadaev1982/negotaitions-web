import { notFound } from "next/navigation";

import { SessionDetailView } from "@/components/session-detail-view";
import { getJoinUrl } from "@/lib/config";
import { canManageSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { autoTranscribeAfterRecording } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import { resolveSessionCaseSnapshot } from "@/lib/session-snapshot";
import {
  getParticipantNotesCount,
  toParticipantNoteEntries,
} from "@/lib/participant-notes-access";
import { requireActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type SessionDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionDetailPage({
  params,
}: SessionDetailPageProps) {
  const { id } = await params;
  const user = await requireActiveUser(`/sessions/${id}`);
  const access = await getCurrentUserSessionAccess(id, user, {});
  if (!access || !canManageSession(access)) {
    notFound();
  }

  const session = await prisma.session.findFirst({
    where: {
      id,
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          status: true,
        },
      },
      negotiationCase: {
        select: {
          deletedAt: true,
          title: true,
          businessContext: true,
          publicInstructions: true,
          caseLanguage: true,
        },
      },
      sessionRoles: {
        orderBy: { sortOrder: "asc" },
      },
      participants: {
        orderBy: { createdAt: "asc" },
        include: {
          sessionRole: true,
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

  const facilitatorParticipant = session.participants.find(
    (participant) => participant.type === "FACILITATOR",
  );
  const displayStatus = resolveSessionDisplayStatus(session, session.participants);
  const caseSnapshot = resolveSessionCaseSnapshot(session);

  return (
    <SessionDetailView
      session={{
        id: session.id,
        title: session.title,
        durationSeconds: session.durationSeconds,
        preparationDurationSeconds: session.preparationDurationSeconds,
        negotiationState: session.negotiationState,
        createdAt: session.createdAt.toISOString(),
        displayStatus,
        isDeleted: session.deletedAt != null,
        caseSnapshot: {
          sourceCaseId: caseSnapshot.sourceCaseId,
          title: caseSnapshot.title,
          caseLanguage: caseSnapshot.caseLanguage,
          sourceCaseDeleted: session.negotiationCase.deletedAt != null,
          businessContext: caseSnapshot.businessContext,
          publicInstructions: caseSnapshot.publicInstructions,
          roles: session.sessionRoles.map((role) => ({
            id: role.id,
            name: role.name,
            privateInstructions: role.privateInstructions,
            objectives: role.objectives,
            constraints: role.constraints,
            hiddenInfo: role.hiddenInfo,
            fallbackPosition: role.fallbackPosition,
          })),
        },
        participants: session.participants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          type: participant.type,
          caseRoleName: participant.sessionRole?.name ?? null,
          joinUrl: getJoinUrl(participant.joinToken),
          joinedAt: participant.joinedAt?.toISOString() ?? null,
          lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
          notesCount: getParticipantNotesCount(participant.notes),
          notes: toParticipantNoteEntries(participant),
        })),
        facilitatorParticipant: facilitatorParticipant
          ? {
              joinToken: facilitatorParticipant.joinToken,
            }
          : null,
        assignableRoles: session.sessionRoles
          .filter((role) => isAssignableCaseRole(role.name))
          .map((role) => ({
            id: role.id,
            name: role.name,
          })),
        assignedRoleIds: session.participants
          .filter(
            (participant) =>
              participant.type === "PARTICIPANT" && participant.sessionRoleId,
          )
          .map((participant) => participant.sessionRoleId!),
        hasFacilitator: session.participants.some(
          (participant) => participant.type === "FACILITATOR",
        ),
        linkedEvent: session.event
          ? {
              id: session.event.id,
              title: session.event.title,
              status: session.event.status,
              lobbyUrl: `/events/${session.event.id}/lobby`,
            }
          : null,
      }}
      autoTranscribeEnabled={autoTranscribeAfterRecording}
    />
  );
}
