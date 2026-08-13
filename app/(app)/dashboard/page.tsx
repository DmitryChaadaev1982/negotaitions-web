import { AccountDashboardView } from "@/components/account-dashboard-view";
import {
  selectDashboardActivity,
  selectDashboardSessionForEvent,
  sortDashboardEvents,
  sortDashboardSessions,
} from "@/lib/dashboard-activity-selection";
import { getEventsForUser } from "@/lib/event-overview-stats";
import { getSessionsForUser } from "@/lib/session-overview-stats";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { isCompletedSessionDisplayStatus } from "@/lib/session-display-status";

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
  const selectionClock = new Date();
  const activeEvents = sortDashboardEvents(allEvents, selectionClock);
  const activeSessions = sortDashboardSessions(allSessions);
  const completedSessions = allSessions.filter(
    (session) => isCompletedSessionDisplayStatus(session.status),
  );
  const selectedActivity = selectDashboardActivity({
    sessions: activeSessions,
    events: activeEvents,
    now: selectionClock,
  });
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
    selectedActivity?.kind === "session"
      ? {
          title: selectedActivity.item.title,
          subtitle: selectedActivity.item.eventTitle ?? "",
          action: {
            href: selectedActivity.item.roomUrl,
            labelKey: "dashboard.openRoom",
          },
        }
      : selectedActivity?.kind === "event"
        ? {
            title: selectedActivity.item.title,
            subtitle: "",
            action: {
              href: `/events/${selectedActivity.item.id}/lobby`,
              labelKey: "dashboard.openLobby",
            },
          }
        : null;

  return (
    <AccountDashboardView
      continueItem={continueItem}
      activeEvents={activeEvents.map((event) => {
        const relevantSession = selectDashboardSessionForEvent(
          activeSessions,
          event.id,
        );
        return {
          id: event.id,
          title: event.title,
          visibility: event.visibility,
          status: event.status,
          roleKey: event.canManage
            ? "dashboard.roleHost"
            : "dashboard.roleParticipant",
          scheduledAt: event.scheduledAt,
          timeZone: event.timeZone,
          estimatedDurationSeconds: event.estimatedDurationSeconds,
          totalSessions: event.totalSessions,
          activeSessions: event.activeSessions,
          finishedSessions: event.finishedSessions,
          primaryAction: {
            href: relevantSession
              ? relevantSession.roomUrl
              : `/events/${event.id}/lobby`,
            labelKey: relevantSession
              ? "dashboard.continueSession"
              : "dashboard.openLobby",
          },
        };
      })}
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
