import {
  groupDashboardArchiveHierarchy,
  groupDashboardEventSessionHierarchy,
  isFutureDashboardEvent,
  partitionDashboardEventsByLane,
  selectDashboardActivity,
  sortDashboardSessions,
} from "@/lib/dashboard-activity-selection";
import type { TrainingEventListItem } from "@/lib/event-overview-shared";
import type { SessionListItem } from "@/lib/session-overview-shared";
import {
  isCompletedSessionDisplayStatus,
  type SessionDisplayStatus,
} from "@/lib/session-display-status";

export type DashboardActionLabelKey =
  | "dashboard.openLobby"
  | "dashboard.continueSession"
  | "dashboard.openRoom"
  | "dashboard.openMaterials";

export type DashboardEventRoleKey =
  | "dashboard.roleHost"
  | "dashboard.roleFacilitator"
  | "dashboard.roleParticipant"
  | "dashboard.roleObserver";

export type DashboardAction = {
  href: string;
  labelKey: DashboardActionLabelKey;
};

export type DashboardEventItem = {
  id: string;
  title: string;
  visibility: "PUBLIC" | "PRIVATE";
  status: string;
  scheduledAt: string | null;
  timeZone: string;
  estimatedDurationSeconds: number | null;
  roleKey: DashboardEventRoleKey;
  totalSessions: number;
  activeSessions: number;
  finishedSessions: number;
  ownerLabel: string | null;
  isOwnedByCurrentUser: boolean;
  primaryAction: DashboardAction | null;
};

export type DashboardSessionItem = {
  id: string;
  title: string;
  visibility: "PUBLIC" | "PRIVATE";
  eventTitle: string | null;
  status: SessionDisplayStatus;
  roleKey: DashboardEventRoleKey;
  recordingStage: string | null;
  transcriptStage: string | null;
  speakerMappingStage: string | null;
  aiStage: string | null;
  openRoomHref: string;
  openMaterialsHref: string;
  eventLobbyHref: string | null;
  ownerLabel: string | null;
  isOwnedByCurrentUser: boolean;
};

export type DashboardEventGroupItem = {
  event: DashboardEventItem;
  sessions: DashboardSessionItem[];
};

export type DashboardContinueItem = {
  title: string;
  subtitle: string;
  action: DashboardAction;
};

export type AccountDashboardViewModel = {
  continueItem: DashboardContinueItem | null;
  currentEventGroups: DashboardEventGroupItem[];
  futureEventGroups: DashboardEventGroupItem[];
  standaloneActiveSessions: DashboardSessionItem[];
  archiveEventGroups: DashboardEventGroupItem[];
  archiveStandaloneSessions: DashboardSessionItem[];
};

function toRoleKey(
  role: "HOST" | "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | null,
): DashboardEventRoleKey {
  return role === "HOST"
    ? "dashboard.roleHost"
    : role === "FACILITATOR"
      ? "dashboard.roleFacilitator"
      : role === "OBSERVER"
        ? "dashboard.roleObserver"
        : "dashboard.roleParticipant";
}

function toSessionItem(
  session: SessionListItem,
  currentUserId: string,
): DashboardSessionItem {
  return {
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
    isOwnedByCurrentUser: session.ownerUserId === currentUserId,
    openRoomHref: session.roomUrl,
    openMaterialsHref: session.materialsUrl,
    eventLobbyHref: session.eventId ? `/events/${session.eventId}/lobby` : null,
  };
}

function toEventItem(
  event: TrainingEventListItem,
  currentUserId: string,
): DashboardEventItem {
  return {
    id: event.id,
    title: event.title,
    visibility: event.visibility,
    status: event.status,
    roleKey: (event.canManage
      ? "dashboard.roleHost"
      : "dashboard.roleParticipant") as DashboardEventRoleKey,
    scheduledAt: event.scheduledAt,
    timeZone: event.timeZone,
    estimatedDurationSeconds: event.estimatedDurationSeconds,
    totalSessions: event.totalSessions,
    activeSessions: event.activeSessions,
    finishedSessions: event.finishedSessions,
    ownerLabel: event.ownerLabel ?? null,
    isOwnedByCurrentUser: event.ownerUserId === currentUserId,
    primaryAction: {
      href: `/events/${event.id}/lobby`,
      labelKey: "dashboard.openLobby",
    },
  };
}

export function buildAccountDashboardViewModel(params: {
  events: readonly TrainingEventListItem[];
  sessions: readonly SessionListItem[];
  currentUserId: string;
  now?: Date;
}): AccountDashboardViewModel {
  const selectionClock = params.now ?? new Date();
  const allEvents = [...params.events];
  const allSessions = [...params.sessions];
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
  const completedSessions = allSessions.filter((session) =>
    isCompletedSessionDisplayStatus(session.status),
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

  const continueItem: DashboardContinueItem | null =
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

  return {
    continueItem,
    currentEventGroups: activeCurrentEventGroups.map((group) => ({
      event: toEventItem(group.event, params.currentUserId),
      sessions: group.sessions.map((session) =>
        toSessionItem(session, params.currentUserId),
      ),
    })),
    futureEventGroups: activeFutureEventGroups.map((group) => ({
      event: toEventItem(group.event, params.currentUserId),
      sessions: group.sessions.map((session) =>
        toSessionItem(session, params.currentUserId),
      ),
    })),
    standaloneActiveSessions: activeHierarchy.standaloneSessions.map((session) =>
      toSessionItem(session, params.currentUserId),
    ),
    archiveEventGroups: archiveHierarchy.eventGroups.map((group) => ({
      event: toEventItem(group.event, params.currentUserId),
      sessions: group.sessions.map((session) =>
        toSessionItem(session, params.currentUserId),
      ),
    })),
    archiveStandaloneSessions: archiveHierarchy.standaloneSessions.map(
      (session) => toSessionItem(session, params.currentUserId),
    ),
  };
}

export type DashboardLastGoodLists = {
  sessions: readonly SessionListItem[];
  events: readonly TrainingEventListItem[];
};

export type DashboardListPollSides = {
  sessions: readonly SessionListItem[] | null;
  events: readonly TrainingEventListItem[] | null;
};

export type DashboardPollState = {
  lists: DashboardLastGoodLists;
  model: AccountDashboardViewModel;
};

export function createDashboardPollState(params: {
  sessions: readonly SessionListItem[];
  events: readonly TrainingEventListItem[];
  currentUserId: string;
  now?: Date;
}): DashboardPollState {
  return {
    lists: {
      sessions: params.sessions,
      events: params.events,
    },
    model: buildAccountDashboardViewModel(params),
  };
}

export function reduceDashboardListPoll(
  lastGood: DashboardLastGoodLists,
  incoming: DashboardListPollSides,
): DashboardLastGoodLists {
  if (incoming.sessions == null && incoming.events == null) {
    return lastGood;
  }

  return {
    sessions: incoming.sessions ?? lastGood.sessions,
    events: incoming.events ?? lastGood.events,
  };
}

export function applyDashboardListPoll(
  current: DashboardPollState,
  incoming: DashboardListPollSides,
  currentUserId: string,
  now?: Date,
): DashboardPollState {
  const lists = reduceDashboardListPoll(current.lists, incoming);
  if (lists === current.lists) {
    return current;
  }

  return {
    lists,
    model: buildAccountDashboardViewModel({
      sessions: lists.sessions,
      events: lists.events,
      currentUserId,
      now,
    }),
  };
}

async function readDashboardListSide<T>(
  url: string,
  key: "sessions" | "events",
  signal: AbortSignal,
): Promise<T[] | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal,
    });
    if (!response.ok || signal.aborted) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const value = data[key];
    if (signal.aborted || !Array.isArray(value)) {
      return null;
    }

    return value as T[];
  } catch {
    return null;
  }
}

export async function readDashboardListSides(
  signal: AbortSignal,
): Promise<DashboardListPollSides> {
  const [sessions, events] = await Promise.all([
    readDashboardListSide<SessionListItem>(
      "/api/sessions/list",
      "sessions",
      signal,
    ),
    readDashboardListSide<TrainingEventListItem>(
      "/api/events/list",
      "events",
      signal,
    ),
  ]);

  if (signal.aborted) {
    return { sessions: null, events: null };
  }

  return { sessions, events };
}
