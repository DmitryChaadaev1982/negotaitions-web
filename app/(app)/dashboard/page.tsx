import { AccountDashboardView } from "@/components/account-dashboard-view";
import { getEventsForUser } from "@/lib/event-overview-stats";
import { getSessionsForUser } from "@/lib/session-overview-stats";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  type ActionLabelKey =
    | "dashboard.openLobby"
    | "dashboard.continueSession"
    | "dashboard.openRoom"
    | "dashboard.openMaterials";
  type ContinueItem = {
    title: string;
    subtitle: string;
    action: { href: string; labelKey: ActionLabelKey };
  };
  const user = await requireActiveUser("/dashboard");
  const isAdminUser = isAdmin(user);

  const [allEvents, allSessions] = await Promise.all([
    getEventsForUser(user),
    getSessionsForUser(user),
  ]);
  const activeEvents = allEvents.filter(
    (event) => event.status !== "COMPLETED" && event.status !== "CANCELLED",
  );
  const activeSessions = allSessions.filter(
    (session) => session.negotiationState !== "FINISHED" && !session.closedByEventAt,
  );
  const completedSessions = allSessions.filter(
    (session) => session.negotiationState === "FINISHED" || Boolean(session.closedByEventAt),
  );
  const hostedEvents = allEvents.filter((event) => event.canManage);
  const toRoleKey = (role: "HOST" | "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | null) =>
    role === "HOST"
      ? "dashboard.roleHost"
      : role === "FACILITATOR"
        ? "dashboard.roleFacilitator"
        : role === "OBSERVER"
          ? "dashboard.roleObserver"
          : "dashboard.roleParticipant";

  const continueItem: ContinueItem | null =
    activeSessions[0]
      ? {
          title: activeSessions[0].title,
          subtitle: activeSessions[0].eventTitle ?? "",
          action: { href: activeSessions[0].roomUrl, labelKey: "dashboard.openRoom" },
        }
      : activeEvents[0]
        ? {
            title: activeEvents[0].title,
            subtitle: "",
            action: { href: `/events/${activeEvents[0].id}/lobby`, labelKey: "dashboard.openLobby" },
          }
        : completedSessions[0]
          ? {
              title: completedSessions[0].title,
              subtitle: completedSessions[0].eventTitle ?? "",
              action: { href: completedSessions[0].materialsUrl, labelKey: "dashboard.openMaterials" },
            }
          : null;

  return (
    <AccountDashboardView
      continueItem={continueItem}
      activeEvents={activeEvents.map((event) => ({
        id: event.id,
        title: event.title,
        visibility: event.visibility,
        status: event.status,
        roleKey: event.canManage ? "dashboard.roleHost" : "dashboard.roleParticipant",
        scheduledAt: event.scheduledAt,
        timeZone: event.timeZone,
        estimatedDurationSeconds: event.estimatedDurationSeconds,
        totalSessions: event.totalSessions,
        activeSessions: event.activeSessions,
        finishedSessions: event.finishedSessions,
        primaryAction: {
          href:
            event.activeSessions > 0 && event.primarySessionId
              ? `/room/${event.primarySessionId}`
              : `/events/${event.id}/lobby`,
          labelKey:
            event.activeSessions > 0
              ? "dashboard.continueSession"
              : "dashboard.openLobby",
        },
      }))}
      activeSessions={activeSessions.map((session) => ({
        id: session.id,
        title: session.title,
        visibility: session.visibility,
        eventTitle: session.eventTitle,
        status: session.status,
        roleKey: toRoleKey(session.userRole),
        recordingStage: session.recordingStage,
        transcriptStage: session.transcriptStage,
        speakerMappingStage: session.speakerMappingStage,
        aiStage: session.aiStage,
        openRoomHref: session.roomUrl,
        openMaterialsHref: session.materialsUrl,
        eventLobbyHref: session.eventId ? `/events/${session.eventId}/lobby` : null,
      }))}
      completedSessions={completedSessions.map((session) => ({
        id: session.id,
        title: session.title,
        visibility: session.visibility,
        eventTitle: session.eventTitle,
        status: session.status,
        roleKey: toRoleKey(session.userRole),
        recordingStage: session.recordingStage,
        transcriptStage: session.transcriptStage,
        speakerMappingStage: session.speakerMappingStage,
        aiStage: session.aiStage,
        openRoomHref: session.roomUrl,
        openMaterialsHref: session.materialsUrl,
        eventLobbyHref: session.eventId ? `/events/${session.eventId}/lobby` : null,
      }))}
      hostedEvents={hostedEvents.map((event) => ({
        id: event.id,
        title: event.title,
        visibility: event.visibility,
        status: event.status,
        roleKey: "dashboard.roleHost",
        scheduledAt: event.scheduledAt,
        timeZone: event.timeZone,
        estimatedDurationSeconds: event.estimatedDurationSeconds,
        totalSessions: event.totalSessions,
        activeSessions: event.activeSessions,
        finishedSessions: event.finishedSessions,
        primaryAction: {
          href: `/events/${event.id}/lobby`,
          labelKey: "dashboard.openLobby",
        },
      }))}
      isAdmin={isAdminUser}
    />
  );
}
