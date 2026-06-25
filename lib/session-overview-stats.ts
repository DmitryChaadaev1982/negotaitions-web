import type { AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { ParticipantType } from "@/app/generated/prisma/client";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { PRESENCE_ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import {
  isSessionActiveForPresence,
  type SessionListItem,
  type SessionOverviewStats,
} from "@/lib/session-overview-shared";
import { activeSessionWhere } from "@/lib/soft-delete";

export type SessionAiStatus = {
  recordingStage: string | null;
  transcriptStage: string | null;
  aiStage: string | null;
  aiVisibility: string;
};

export type { SessionListItem, SessionOverviewStats } from "@/lib/session-overview-shared";
export {
  applySessionOverviewStats,
  isSessionActiveForPresence,
} from "@/lib/session-overview-shared";

function isOnline(lastSeenAt: Date | null, onlineThreshold: Date) {
  return lastSeenAt != null && lastSeenAt >= onlineThreshold;
}

export async function getSessionsForList(): Promise<SessionListItem[]> {
  return getSessionsForUser(null);
}

export async function getSessionsForUser(user: AuthUser | null): Promise<SessionListItem[]> {
  const onlineThreshold = new Date(Date.now() - PRESENCE_ONLINE_THRESHOLD_MS);
  const where =
    user && !isAdmin(user)
      ? {
          ...activeSessionWhere,
          OR: [
            { event: { hostUserId: user.id } },
            { participants: { some: { userId: user.id } } },
            {
              participants: {
                some: {
                  userId: user.id,
                  type: ParticipantType.FACILITATOR,
                },
              },
            },
          ],
        }
      : activeSessionWhere;

  const sessions = await prisma.session.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      snapshotCaseTitle: true,
      status: true,
      negotiationState: true,
      closedByEventAt: true,
      durationSeconds: true,
      createdAt: true,
      event: {
        select: {
          id: true,
          title: true,
          hostUserId: true,
          status: true,
          // hostToken and participantToken intentionally omitted — do not expose in list data.
        },
      },
      participants: {
        select: {
          userId: true,
          type: true,
          joinedAt: true,
          lastSeenAt: true,
          // joinToken intentionally omitted — must not appear in list data.
        },
      },
      _count: {
        select: { participants: true },
      },
      recording: {
        select: { status: true },
      },
      transcript: {
        select: { status: true, hasSpeakerDiarization: true, speakerMappingStatus: true },
      },
      aiAnalysis: {
        select: { status: true, visibility: true },
      },
    },
  });

  return sessions.map((session) => {
    const presenceActive = isSessionActiveForPresence(session);

    // Derive pipeline stages for sessions-page display
    const recStatus = session.recording?.status ?? null;
    const txStatus = session.transcript?.status ?? null;
    const aiStatus = session.aiAnalysis?.status ?? null;

    const recordingStage = recStatus
      ? recStatus === "COMPLETED"
        ? "ready"
        : recStatus === "FAILED"
          ? "failed"
          : ["STARTING", "RECORDING", "PAUSED"].includes(recStatus)
            ? "in_progress"
            : recStatus === "STOPPED" || recStatus === "PROCESSING"
              ? "processing"
              : "not_available"
      : null;

    const transcriptStage = txStatus
      ? txStatus === "COMPLETED"
        ? "ready"
        : txStatus === "FAILED"
          ? "failed"
          : "in_progress"
      : null;

    const speakerMappingStage: string | null = (() => {
      if (!session.transcript?.hasSpeakerDiarization) return null;
      const mappingStatus = session.transcript.speakerMappingStatus ?? "NOT_REQUIRED";
      if (mappingStatus === "CONFIRMED") return "confirmed";
      if (mappingStatus === "NOT_REQUIRED") return null;
      return "required";
    })();

    const aiStage = aiStatus
      ? aiStatus === "COMPLETED"
        ? "ready"
        : aiStatus === "FAILED"
          ? "failed"
          : "in_progress"
      : null;

    return {
      id: session.id,
      title: session.title,
      canManage: Boolean(
        user &&
          (isAdmin(user) ||
            session.event?.hostUserId === user.id ||
            session.participants.some(
              (participant) =>
                participant.userId === user.id &&
                participant.type === "FACILITATOR",
            )),
      ),
      caseTitle: session.snapshotCaseTitle,
      eventId: session.event?.id ?? null,
      eventTitle: session.event?.title ?? null,
      eventStatus: session.event?.status ?? null,
      // eventLobbyUrl: tokens omitted from list data. Use /events/[id]/join for lobby access.
      eventLobbyUrl: session.event
        ? `/events/${session.event.id}/join`
        : null,
      status: resolveSessionDisplayStatus(session, session.participants),
      negotiationState: session.negotiationState,
      closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
      participantCount: session._count.participants,
      onlineParticipantCount: presenceActive
        ? session.participants.filter((participant) =>
            isOnline(participant.lastSeenAt, onlineThreshold),
          ).length
        : 0,
      durationMinutes: secondsToDisplayMinutes(session.durationSeconds),
      createdAt: session.createdAt.toISOString(),
      recordingStage,
      transcriptStage,
      speakerMappingStage,
      aiStage: aiStage === "ready" && session.aiAnalysis?.visibility === "SHARED_WITH_SESSION"
        ? "shared"
        : aiStage,
      aiVisibility: session.aiAnalysis?.visibility ?? "FACILITATOR_ONLY",
    };
  });
}

export async function getSessionOverviewStats(): Promise<SessionOverviewStats[]> {
  return getSessionOverviewStatsForUser(null);
}

export async function getSessionOverviewStatsForUser(
  user: AuthUser | null,
): Promise<SessionOverviewStats[]> {
  const sessions = await getSessionsForUser(user);

  return sessions.map((session) => ({
    id: session.id,
    onlineParticipantCount: session.onlineParticipantCount,
  }));
}
