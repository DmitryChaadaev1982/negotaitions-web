import { ParticipantType } from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import {
  canAccessSession,
  getCurrentUserSessionAccess,
} from "@/lib/access-control";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { buildSessionCloseState } from "@/lib/session-close-state";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import { sessionRoleBriefingSelect } from "@/lib/session-role";

export type AccountMaterialsRole = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

export type AccountMaterialsData = {
  /** Public DB id — not a secret token. Safe to embed in client HTML. */
  participantId: string;
  participantType: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  displayName: string;
  notes: string;
  /** Only set for PARTICIPANT type; null for facilitator/observer. */
  caseRole: AccountMaterialsRole | null;
  session: {
    id: string;
    title: string;
    caseTitle: string;
    roomLabel: string | null;
    preparationDurationMinutes: number;
    negotiationDurationMinutes: number;
    displayStatus: SessionDisplayStatus;
    negotiationState: string;
    isDeleted: boolean;
    closedByEvent: boolean;
    closedBeforeNegotiation: boolean;
    closedByEventAt: string | null;
    businessContext: string;
    publicInstructions: string;
    caseLanguage: string;
  };
  event: { id: string; title: string; lobbyUrl: string } | null;
  assignedParticipants: Array<{
    id: string;
    displayName: string;
    role: AccountMaterialsRole;
  }>;
  recording: {
    status: string;
    fileUrl: string | null;
    updatedAt: string;
    errorMessage: string | null;
  } | null;
  transcript: {
    text: string | null;
    diarizedText: string | null;
    updatedAt: string;
  } | null;
  /** Tokenless room URL — /room/[sessionId] without query params. */
  roomUrl: string;
  notesVariant: "preparation" | "observer" | "facilitator";
};

/**
 * Loads all session materials data for an authenticated account user.
 *
 * Access is checked by userId relation only — no joinToken is read, stored,
 * or returned. This keeps joinToken out of browser URL, HTML, and logs.
 *
 * Guest access continues to use /join/[joinToken] unchanged.
 */
export async function getAccountMaterialsData(
  sessionId: string,
  user: AuthUser,
): Promise<AccountMaterialsData | null> {
  const access = await getCurrentUserSessionAccess(sessionId, user, {});
  if (!access || !canAccessSession(access)) {
    return null;
  }

  const userParticipantId = access.userParticipant?.id ?? null;

  const sessionData = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      status: true,
      snapshotCaseTitle: true,
      roomLabel: true,
      snapshotBusinessContext: true,
      snapshotPublicInstructions: true,
      snapshotCaseLanguage: true,
      preparationDurationSeconds: true,
      durationSeconds: true,
      deletedAt: true,
      negotiationState: true,
      negotiationStartedAt: true,
      closedByEventAt: true,
      closeReason: true,
      event: {
        select: {
          id: true,
          title: true,
          status: true,
        },
      },
      participants: {
        select: {
          id: true,
          displayName: true,
          type: true,
          notes: true,
          joinedAt: true,
          lastSeenAt: true,
          sessionRole: {
            select: sessionRoleBriefingSelect,
          },
        },
        orderBy: { createdAt: "asc" },
      },
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
    },
  });

  if (!sessionData) return null;

  const closeState = buildSessionCloseState(sessionData);
  const displayStatus = resolveSessionDisplayStatus(
    sessionData,
    sessionData.participants,
  );

  // Resolve viewing participant: own participant > admin/host fall-through to facilitator.
  const participant = userParticipantId
    ? (sessionData.participants.find((p) => p.id === userParticipantId) ?? null)
    : null;

  const viewerParticipant =
    participant ??
    (access.isAdmin || access.isEventHostOwner
      ? (sessionData.participants.find((p) => p.type === "FACILITATOR") ??
          sessionData.participants[0] ??
          null)
      : null);

  if (!viewerParticipant) return null;

  const isParticipantType =
    viewerParticipant.type === ParticipantType.PARTICIPANT;
  const isObserverType = viewerParticipant.type === ParticipantType.OBSERVER;

  const assignedParticipants = sessionData.participants
    .filter((p): p is typeof p & { sessionRole: NonNullable<typeof p.sessionRole> } =>
      p.sessionRole !== null,
    )
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.sessionRole,
    }));

  return {
    participantId: viewerParticipant.id,
    participantType: viewerParticipant.type as "FACILITATOR" | "PARTICIPANT" | "OBSERVER",
    displayName: viewerParticipant.displayName,
    notes: viewerParticipant.notes,
    caseRole: isParticipantType ? (viewerParticipant.sessionRole ?? null) : null,
    session: {
      id: sessionData.id,
      title: sessionData.title,
      caseTitle: sessionData.snapshotCaseTitle,
      roomLabel: sessionData.roomLabel,
      preparationDurationMinutes: secondsToDisplayMinutes(
        sessionData.preparationDurationSeconds,
      ),
      negotiationDurationMinutes: secondsToDisplayMinutes(
        sessionData.durationSeconds,
      ),
      displayStatus,
      negotiationState: sessionData.negotiationState,
      isDeleted: sessionData.deletedAt != null,
      closedByEvent: closeState.isClosed,
      closedBeforeNegotiation: closeState.closedBeforeNegotiation,
      closedByEventAt: sessionData.closedByEventAt?.toISOString() ?? null,
      businessContext: sessionData.snapshotBusinessContext,
      publicInstructions: sessionData.snapshotPublicInstructions,
      caseLanguage: sessionData.snapshotCaseLanguage,
    },
    event: sessionData.event
      ? {
          id: sessionData.event.id,
          title: sessionData.event.title,
          lobbyUrl: `/events/${sessionData.event.id}/lobby`,
        }
      : null,
    assignedParticipants,
    recording: sessionData.recording
      ? {
          status: sessionData.recording.status,
          fileUrl: sessionData.recording.fileUrl,
          updatedAt: sessionData.recording.updatedAt.toISOString(),
          errorMessage: sessionData.recording.errorMessage,
        }
      : null,
    transcript: sessionData.transcript
      ? {
          text: sessionData.transcript.text,
          diarizedText: sessionData.transcript.diarizedText,
          updatedAt: sessionData.transcript.updatedAt.toISOString(),
        }
      : null,
    roomUrl: `/room/${sessionData.id}`,
    notesVariant: isParticipantType
      ? "preparation"
      : isObserverType
        ? "observer"
        : "facilitator",
  };
}
