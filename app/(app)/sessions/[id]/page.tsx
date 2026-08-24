import { notFound } from "next/navigation";

import { SessionDetailView } from "@/components/session-detail-view";
import { buildAccountSessionRoomPath, getPublicAppUrl } from "@/lib/config";
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
import {
  collectCurrentSessionRoomUserIds,
  isSessionOperableForCurrentRoomPresence,
  liveSessionRoomConnectionWhere,
} from "@/lib/session-current-presence";

export const dynamic = "force-dynamic";

type SessionDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionDetailPage({
  params,
}: SessionDetailPageProps) {
  const { id } = await params;
  // Computed once per request so parent/child SSR presence classifications agree.
  const presenceSnapshotAt = new Date().toISOString();
  const user = await requireActiveUser(`/sessions/${id}`);
  const access = await getCurrentUserSessionAccess(id, user, {});
  if (!access || !canManageSession(access)) {
    notFound();
  }

  const presenceNow = new Date(presenceSnapshotAt);
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
      // Phase 6.11B: load facilitator user for owner display.
      facilitator: {
        select: { id: true, name: true, email: true },
      },
      roomConnections: {
        where: liveSessionRoomConnectionWhere(presenceNow),
        select: {
          userId: true,
          sessionId: true,
          disconnectedAt: true,
          revokedAt: true,
          supersededAt: true,
          expiresAt: true,
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

  const sessionInvitePath = buildAccountSessionRoomPath(id);
  const sessionUrl = `${getPublicAppUrl()}${sessionInvitePath}`;
  const existingParticipantUserIds = session.participants
    .filter((p) => p.userId != null)
    .map((p) => p.userId!);
  const currentRoomUserIds = isSessionOperableForCurrentRoomPresence(session)
    ? collectCurrentSessionRoomUserIds(
        session.roomConnections,
        presenceNow,
        session,
      )
    : new Set<string>();

  return (
    <SessionDetailView
      presenceSnapshotAt={presenceSnapshotAt}
      session={{
        id: session.id,
        title: session.title,
        visibility: (session.visibility ?? "PRIVATE") as "PUBLIC" | "PRIVATE",
        // Phase 6.11B: facilitatorId = owner. Show for facilitator/owner display on detail page.
        facilitatorLabel: session.facilitator?.name ?? session.facilitator?.email ?? null,
        durationSeconds: session.durationSeconds,
        preparationDurationSeconds: session.preparationDurationSeconds,
        sessionStatus: session.status,
        negotiationState: session.negotiationState,
        roomLifecycle: session.roomLifecycle,
        closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
        createdAt: session.createdAt.toISOString(),
        displayStatus,
        isDeleted: session.deletedAt != null,
        sessionUrl,
        sessionInvitePath,
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
          userId: participant.userId,
          caseRoleName: participant.sessionRole?.name ?? null,
          // Phase 6.11B: expose sessionRoleId for role management panel.
          sessionRoleId: participant.sessionRoleId,
          joinedAt: participant.joinedAt?.toISOString() ?? null,
          lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
          isCurrentlyInRoom: Boolean(
            participant.userId && currentRoomUserIds.has(participant.userId),
          ),
          notesCount: getParticipantNotesCount(participant.notes),
          notes: toParticipantNoteEntries(participant),
        })),
        facilitatorParticipant: facilitatorParticipant
          ? {
              id: facilitatorParticipant.id,
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
        existingParticipantUserIds,
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
