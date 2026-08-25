import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { RoomLifecycle } from "@/app/generated/prisma/client";
import {
  applyDashboardListPoll,
  createDashboardPollState,
  readDashboardListSides,
  type AccountDashboardViewModel,
  type DashboardPollState,
} from "@/lib/account-dashboard-view-model";
import type { TrainingEventListItem } from "@/lib/event-overview-shared";
import type { SessionListItem } from "@/lib/session-overview-shared";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const CURRENT_USER_ID = "user-owner";
const ROOT = process.cwd();

function sessionItem(
  overrides: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id: "session-default",
    title: "Default Session",
    visibility: "PRIVATE",
    userRole: "FACILITATOR",
    canManage: true,
    caseTitle: "Case",
    eventId: null,
    eventTitle: null,
    eventStatus: null,
    eventVisibility: null,
    eventLobbyUrl: null,
    status: "PREPARATION",
    sessionStatus: "READY",
    negotiationState: "PREPARATION",
    roomLifecycle: RoomLifecycle.OPEN,
    closedByEventAt: null,
    participantCount: 1,
    onlineParticipantCount: 0,
    durationMinutes: 30,
    createdAt: "2026-08-25T11:00:00.000Z",
    recordingStage: null,
    transcriptStage: null,
    speakerMappingStage: null,
    aiStage: null,
    aiPublicationStatus: null,
    aiVisibility: "FACILITATOR_ONLY",
    roomUrl: "/room/session-default",
    materialsUrl: "/sessions/session-default/materials",
    ownerLabel: "Owner",
    ownerUserId: CURRENT_USER_ID,
    ...overrides,
  };
}

function eventItem(
  overrides: Partial<TrainingEventListItem> = {},
): TrainingEventListItem {
  return {
    id: "event-default",
    title: "Default Event",
    status: "LOBBY_OPEN",
    visibility: "PRIVATE",
    canManage: true,
    scheduledAt: "2026-08-25T11:30:00.000Z",
    timeZone: "UTC",
    estimatedDurationSeconds: 3600,
    publicJoinCode: "join-code",
    primarySessionId: null,
    lobbyParticipantCount: 0,
    sessionCount: 0,
    totalSessions: 0,
    activeSessions: 0,
    finishedSessions: 0,
    participantsInLobby: 0,
    participantsInActiveSessions: 0,
    uniqueParticipantsWithSessions: 0,
    recordingsCount: 0,
    transcriptsCount: 0,
    latestActivityAt: "2026-08-25T11:30:00.000Z",
    activeSessionParticipantCount: 0,
    totalSessionParticipantCount: 0,
    createdAt: "2026-08-25T11:30:00.000Z",
    ownerLabel: "Owner",
    ownerUserId: CURRENT_USER_ID,
    ...overrides,
  };
}

function sessionIds(model: AccountDashboardViewModel): string[] {
  return [
    ...model.standaloneActiveSessions.map((item) => item.id),
    ...model.currentEventGroups.flatMap((group) =>
      group.sessions.map((item) => item.id),
    ),
    ...model.futureEventGroups.flatMap((group) =>
      group.sessions.map((item) => item.id),
    ),
    ...model.archiveStandaloneSessions.map((item) => item.id),
    ...model.archiveEventGroups.flatMap((group) =>
      group.sessions.map((item) => item.id),
    ),
  ];
}

function eventIds(model: AccountDashboardViewModel): string[] {
  return [
    ...model.currentEventGroups.map((group) => group.event.id),
    ...model.futureEventGroups.map((group) => group.event.id),
    ...model.archiveEventGroups.map((group) => group.event.id),
  ];
}

function pollState(
  sessions: SessionListItem[],
  events: TrainingEventListItem[],
): DashboardPollState {
  return createDashboardPollState({
    sessions,
    events,
    currentUserId: CURRENT_USER_ID,
    now: NOW,
  });
}

function apply(
  current: DashboardPollState,
  incoming: {
    sessions: SessionListItem[] | null;
    events: TrainingEventListItem[] | null;
  },
): DashboardPollState {
  return applyDashboardListPoll(current, incoming, CURRENT_USER_ID, NOW);
}

test("T01 Dashboard receives initial Session data", () => {
  const initial = sessionItem({
    id: "session-initial",
    title: "Initial Session",
    roomUrl: "/room/session-initial",
    materialsUrl: "/sessions/session-initial/materials",
  });

  const { model } = pollState([initial], []);

  assert.deepEqual(
    model.standaloneActiveSessions.map((item) => item.id),
    ["session-initial"],
  );
  assert.equal(model.standaloneActiveSessions[0]?.title, "Initial Session");
  assert.equal(model.continueItem?.title, "Initial Session");
});

test("T02 after a polling cycle a newly created Session appears without remount", () => {
  const existing = sessionItem({
    id: "session-existing",
    title: "Existing Session",
    createdAt: "2026-08-25T10:00:00.000Z",
    roomUrl: "/room/session-existing",
    materialsUrl: "/sessions/session-existing/materials",
  });
  let state = pollState([existing], []);
  const created = sessionItem({
    id: "session-created",
    title: "Created Session",
    createdAt: "2026-08-25T11:50:00.000Z",
    roomUrl: "/room/session-created",
    materialsUrl: "/sessions/session-created/materials",
  });

  state = apply(state, { events: [], sessions: [existing, created] });

  assert.equal(
    state.model.standaloneActiveSessions.some((item) => item.id === "session-created"),
    true,
  );
  assert.equal(
    state.model.standaloneActiveSessions.some((item) => item.id === "session-existing"),
    true,
  );
});

test("T03 after a polling cycle a newly created Event appears without remount", () => {
  const existing = eventItem({
    id: "event-existing",
    title: "Existing Event",
  });
  let state = pollState([], [existing]);
  const created = eventItem({
    id: "event-created",
    title: "Created Event",
    createdAt: "2026-08-25T11:55:00.000Z",
    scheduledAt: "2026-08-25T11:55:00.000Z",
  });

  state = apply(state, { events: [existing, created], sessions: [] });

  assert.equal(eventIds(state.model).includes("event-created"), true);
  assert.equal(eventIds(state.model).includes("event-existing"), true);
});

test("T04 repeated Session polls do not duplicate rows", () => {
  const created = sessionItem({
    id: "session-once",
    title: "Once Session",
    roomUrl: "/room/session-once",
    materialsUrl: "/sessions/session-once/materials",
  });
  let state = pollState([created], []);

  state = apply(state, { events: [], sessions: [created] });
  state = apply(state, { events: [], sessions: [created] });

  assert.deepEqual(
    sessionIds(state.model).filter((id) => id === "session-once"),
    ["session-once"],
  );
});

test("T05 repeated Event polls do not duplicate rows", () => {
  const created = eventItem({
    id: "event-once",
    title: "Once Event",
  });
  let state = pollState([], [created]);

  state = apply(state, { events: [created], sessions: [] });
  state = apply(state, { events: [created], sessions: [] });

  assert.deepEqual(
    eventIds(state.model).filter((id) => id === "event-once"),
    ["event-once"],
  );
});

test("T06 transient polling failure preserves last good Dashboard data", () => {
  const existing = sessionItem({
    id: "session-keep",
    title: "Keep Session",
    roomUrl: "/room/session-keep",
    materialsUrl: "/sessions/session-keep/materials",
  });
  const state = pollState([existing], []);

  const afterFailure = apply(state, { sessions: null, events: null });

  assert.equal(afterFailure, state);
  assert.deepEqual(
    afterFailure.model.standaloneActiveSessions.map((item) => item.id),
    ["session-keep"],
  );
});

test("T07 a later successful poll recovers after a transient failure", () => {
  const existing = sessionItem({
    id: "session-keep",
    title: "Keep Session",
    roomUrl: "/room/session-keep",
    materialsUrl: "/sessions/session-keep/materials",
  });
  let state = pollState([existing], []);
  state = apply(state, { sessions: null, events: null });
  const createdEvent = eventItem({
    id: "event-recovered",
    title: "Recovered Event",
  });

  state = apply(state, { events: [createdEvent], sessions: [existing] });

  assert.equal(sessionIds(state.model).includes("session-keep"), true);
  assert.equal(eventIds(state.model).includes("event-recovered"), true);
});

test("T12 sessions success with events failure still shows the new Session", () => {
  const existingSession = sessionItem({
    id: "session-old",
    title: "Old Session",
    roomUrl: "/room/session-old",
    materialsUrl: "/sessions/session-old/materials",
  });
  const existingEvent = eventItem({
    id: "event-old",
    title: "Old Event",
  });
  const createdSession = sessionItem({
    id: "session-new",
    title: "New Session",
    createdAt: "2026-08-25T11:50:00.000Z",
    roomUrl: "/room/session-new",
    materialsUrl: "/sessions/session-new/materials",
  });
  let state = pollState([existingSession], [existingEvent]);

  state = apply(state, {
    sessions: [existingSession, createdSession],
    events: null,
  });

  assert.equal(sessionIds(state.model).includes("session-new"), true);
  assert.equal(eventIds(state.model).includes("event-old"), true);
  assert.equal(eventIds(state.model).includes("event-new"), false);
});

test("T13 events success with sessions failure still shows the new Event", () => {
  const existingSession = sessionItem({
    id: "session-old",
    title: "Old Session",
    roomUrl: "/room/session-old",
    materialsUrl: "/sessions/session-old/materials",
  });
  const existingEvent = eventItem({
    id: "event-old",
    title: "Old Event",
  });
  const createdEvent = eventItem({
    id: "event-new",
    title: "New Event",
    createdAt: "2026-08-25T11:55:00.000Z",
    scheduledAt: "2026-08-25T11:55:00.000Z",
  });
  let state = pollState([existingSession], [existingEvent]);

  state = apply(state, {
    sessions: null,
    events: [existingEvent, createdEvent],
  });

  assert.equal(eventIds(state.model).includes("event-new"), true);
  assert.equal(sessionIds(state.model).includes("session-old"), true);
  assert.equal(sessionIds(state.model).includes("session-new"), false);
});

test("T14 one failed side recovers on a later successful poll", () => {
  const existingSession = sessionItem({
    id: "session-old",
    title: "Old Session",
    roomUrl: "/room/session-old",
    materialsUrl: "/sessions/session-old/materials",
  });
  const existingEvent = eventItem({
    id: "event-old",
    title: "Old Event",
  });
  const createdSession = sessionItem({
    id: "session-recovered",
    title: "Recovered Session",
    createdAt: "2026-08-25T11:58:00.000Z",
    roomUrl: "/room/session-recovered",
    materialsUrl: "/sessions/session-recovered/materials",
  });
  let state = pollState([existingSession], [existingEvent]);
  state = apply(state, { sessions: null, events: [existingEvent] });
  assert.equal(sessionIds(state.model).includes("session-old"), true);

  state = apply(state, {
    sessions: [existingSession, createdSession],
    events: [existingEvent],
  });

  assert.equal(sessionIds(state.model).includes("session-recovered"), true);
  assert.equal(eventIds(state.model).includes("event-old"), true);
});

test("T15 repeated successful polls still do not duplicate either entity type", () => {
  const session = sessionItem({
    id: "session-once",
    title: "Once Session",
    roomUrl: "/room/session-once",
    materialsUrl: "/sessions/session-once/materials",
  });
  const event = eventItem({
    id: "event-once",
    title: "Once Event",
  });
  let state = pollState([session], [event]);

  state = apply(state, { sessions: [session], events: [event] });
  state = apply(state, { sessions: [session], events: [event] });
  state = apply(state, { sessions: [session], events: [event] });

  assert.deepEqual(
    sessionIds(state.model).filter((id) => id === "session-once"),
    ["session-once"],
  );
  assert.deepEqual(
    eventIds(state.model).filter((id) => id === "event-once"),
    ["event-once"],
  );
});

test("readDashboardListSides applies a successful side even when the other fails", async () => {
  const originalFetch = globalThis.fetch;
  const created = sessionItem({ id: "session-fetch" });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/sessions/list")) {
      return new Response(JSON.stringify({ sessions: [created] }), {
        status: 200,
      });
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  try {
    const sides = await readDashboardListSides(new AbortController().signal);
    assert.equal(sides.sessions?.[0]?.id, "session-fetch");
    assert.equal(sides.events, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Dashboard client uses the shared list poll and independent last-good apply", () => {
  const view = readFileSync(
    join(ROOT, "components/account-dashboard-view.tsx"),
    "utf8",
  );
  const page = readFileSync(join(ROOT, "app/(app)/dashboard/page.tsx"), "utf8");

  assert.match(view, /useVisibleListPoll/);
  assert.match(view, /readDashboardListSides/);
  assert.match(view, /applyDashboardListPoll/);
  assert.doesNotMatch(view, /setInterval/);
  assert.match(page, /initialSessions/);
  assert.match(page, /initialEvents/);
});
