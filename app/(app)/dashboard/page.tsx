import { AccountDashboardView } from "@/components/account-dashboard-view";
import {
  groupDashboardArchiveHierarchy,
  groupDashboardEventSessionHierarchy,
  isFutureDashboardEvent,
  partitionDashboardEventsByLane,
  selectDashboardActivity,
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
  type EventRoleKey =
    | "dashboard.roleHost"
    | "dashboard.roleFacilitator"
    | "dashboard.roleParticipant"
    | "dashboard.roleObserver";
  const user = await requireActiveUser("/dashboard");
  const isAdminUser = isAdmin(user);

  const [allEvents, allSessions] = await Promise.all([
    getEventsForUser(user),
    getSessionsForUser(user),
  ]);
  const selectionClock = new Date();
  const { activeEvents, archivedEvents } = partitionDashboardEventsByLane({
    events: allEvents,
    sessions: allSessions,
    now: selectionClock,
  });
  const activeSessions = sortDashboardSessions(allSessions);
  const activeHierarchy = groupDashboardEventSessionHierarchy({
    events: activeEvents,
    sessions: activeSessions,
  });
  const eventGroupHasCurrentActivity = (
    group: (typeof activeHierarchy.eventGroups)[number],
  ) =>
    group.sessions.length > 0 || (group.event.participantsInLobby ?? 0) > 0;
  const activeCurrentEventGroups = activeHierarchy.eventGroups.filter(
    (group) =>
      eventGroupHasCurrentActivity(group) ||
      !isFutureDashboardEvent(group.event, selectionClock),
  );
  const activeFutureEventGroups = activeHierarchy.eventGroups.filter(
    (group) =>
      !eventGroupHasCurrentActivity(group) &&
      isFutureDashboardEvent(group.event, selectionClock),
  );
  const completedSessions = allSessions.filter(
    (session) => isCompletedSessionDisplayStatus(session.status),
  );
  const archiveHierarchy = groupDashboardArchiveHierarchy({
    events: archivedEvents,
    sessions: completedSessions,
  });
  const selectedActivity = selectDashboardActivity({
    sessions: activeSessions,
    events: activeEvents,
    now: selectionClock,
  });
  const toRoleKey = (
    role: "HOST" | "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | null,
  ): EventRoleKey =>
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
  const toSessionItem = (session: (typeof allSessions)[number]) => ({
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
    ownerLabel: session.ownerLabel ?? null,
    isOwnedByCurrentUser: session.ownerUserId === user.id,
    openRoomHref: session.roomUrl,
    openMaterialsHref: session.materialsUrl,
    eventLobbyHref: session.eventId ? `/events/${session.eventId}/lobby` : null,
  });

  const toEventItem = (event: (typeof allEvents)[number]) => ({
    id: event.id,
    title: event.title,
    visibility: event.visibility,
    status: event.status,
    roleKey: (event.canManage
      ? "dashboard.roleHost"
      : "dashboard.roleParticipant") as EventRoleKey,
    scheduledAt: event.scheduledAt,
    timeZone: event.timeZone,
    estimatedDurationSeconds: event.estimatedDurationSeconds,
    totalSessions: event.totalSessions,
    activeSessions: event.activeSessions,
    finishedSessions: event.finishedSessions,
    ownerLabel: event.ownerLabel ?? null,
    isOwnedByCurrentUser: event.ownerUserId === user.id,
    primaryAction: {
      href: `/events/${event.id}/lobby`,
      labelKey: "dashboard.openLobby" as ActionLabelKey,
    },
  });

  return (
    <AccountDashboardView
      continueItem={continueItem}
      currentEventGroups={activeCurrentEventGroups.map((group) => ({
        event: toEventItem(group.event),
        sessions: group.sessions.map(toSessionItem),
      }))}
      futureEventGroups={activeFutureEventGroups.map((group) => ({
        event: toEventItem(group.event),
        sessions: group.sessions.map(toSessionItem),
      }))}
      standaloneActiveSessions={activeHierarchy.standaloneSessions.map(
        toSessionItem,
      )}
      archiveEventGroups={archiveHierarchy.eventGroups.map((group) => ({
        event: toEventItem(group.event),
        sessions: group.sessions.map(toSessionItem),
      }))}
      archiveStandaloneSessions={archiveHierarchy.standaloneSessions.map(
        toSessionItem,
      )}
      isAdmin={isAdminUser}
    />
  );
}
