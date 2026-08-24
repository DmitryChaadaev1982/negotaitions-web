import assert from "node:assert/strict";
import test from "node:test";

import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import {
  DEFAULT_SESSION_ABANDONED_CLOSE_MS,
  DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
  DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS,
} from "@/lib/config/session-lifecycle-settings";
import {
  evaluateSessionLifecyclePolicy,
  resolveAbandonedReferenceAt,
  resolveLastCurrentGenerationDepartureAt,
  SESSION_AUTO_CLOSE_REASONS,
  type CurrentGenerationConnection,
  type SessionLifecyclePolicyInput,
} from "@/lib/session-lifecycle-policy";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const DURATIONS = {
  debriefEmptyCloseMs: DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
  debriefMaxDurationMs: DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS,
  abandonedCloseMs: DEFAULT_SESSION_ABANDONED_CLOSE_MS,
};

function debriefInput(
  overrides: Partial<SessionLifecyclePolicyInput> = {},
): SessionLifecyclePolicyInput {
  return {
    now: NOW,
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    deletedAt: null,
    createdAt: new Date("2026-08-24T10:00:00.000Z"),
    negotiationEndedAt: new Date("2026-08-24T11:00:00.000Z"),
    negotiationState: NegotiationState.FINISHED,
    closedByEventAt: null,
    occupancyCount: 0,
    lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:00.000Z"),
    parentEvent: null,
    durations: DURATIONS,
    ...overrides,
  };
}

function openInput(
  overrides: Partial<SessionLifecyclePolicyInput> = {},
): SessionLifecyclePolicyInput {
  return {
    now: NOW,
    roomLifecycle: RoomLifecycle.OPEN,
    deletedAt: null,
    createdAt: new Date("2026-08-24T08:00:00.000Z"),
    negotiationEndedAt: null,
    negotiationState: NegotiationState.RUNNING,
    closedByEventAt: null,
    occupancyCount: 0,
    lastCurrentGenerationDepartureAt: new Date("2026-08-24T08:30:00.000Z"),
    parentEvent: null,
    durations: DURATIONS,
    ...overrides,
  };
}

test("S01 Debrief empty 59s remains open", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:01.000Z"),
    }),
  );
  assert.equal(result.decision, "not_due");
  assert.equal(result.currentlyDue, false);
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT);
  assert.equal(result.remainingMs, 1_000);
});

test("S02 Debrief empty >=60s is due for empty timeout", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:00.000Z"),
    }),
  );
  assert.equal(result.decision, "due");
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT);
  assert.equal(result.dueAt?.toISOString(), "2026-08-24T12:00:00.000Z");
});

test("S03 rejoin before deadline cannot close on the obsolete empty dueAt", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 1,
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:58:00.000Z"),
    }),
  );
  assert.equal(result.decision, "occupied");
  assert.equal(result.currentlyDue, false);
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_MAX_DURATION);
});

test("S04 second leave starts a new 60s deadline", () => {
  const firstLeave = evaluateSessionLifecyclePolicy(
    debriefInput({
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:50:00.000Z"),
    }),
  );
  const afterRejoinLeave = evaluateSessionLifecyclePolicy(
    debriefInput({
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:30.000Z"),
    }),
  );
  assert.equal(firstLeave.decision, "due");
  assert.equal(afterRejoinLeave.decision, "not_due");
  assert.equal(
    afterRejoinLeave.dueAt?.toISOString(),
    "2026-08-24T12:00:30.000Z",
  );
});

test("S05 occupied newer generation wins over an obsolete empty evaluator", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 2,
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:00:00.000Z"),
    }),
  );
  assert.equal(result.decision, "occupied");
  assert.equal(result.currentlyDue, false);
});

test("S06 occupied Debrief under 2h remains open", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 1,
      negotiationEndedAt: new Date("2026-08-24T10:01:00.000Z"),
      lastCurrentGenerationDepartureAt: null,
    }),
  );
  assert.equal(result.decision, "occupied");
  assert.equal(result.currentlyDue, false);
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_MAX_DURATION);
});

test("S06b occupied Debrief at/after 2h is due for hard maximum", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 3,
      negotiationEndedAt: new Date("2026-08-24T10:00:00.000Z"),
      lastCurrentGenerationDepartureAt: null,
    }),
  );
  assert.equal(result.decision, "due");
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_MAX_DURATION);
});

test("S07 empty Debrief earliest eligible reason wins", () => {
  const emptyFirst = evaluateSessionLifecyclePolicy(
    debriefInput({
      negotiationEndedAt: new Date("2026-08-24T10:30:00.000Z"),
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:00.000Z"),
    }),
  );
  assert.equal(emptyFirst.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT);
  assert.equal(emptyFirst.decision, "due");

  const hardFirst = evaluateSessionLifecyclePolicy(
    debriefInput({
      negotiationEndedAt: new Date("2026-08-24T10:00:00.000Z"),
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:30.000Z"),
    }),
  );
  assert.equal(hardFirst.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_MAX_DURATION);
  assert.equal(hardFirst.decision, "due");

  const tied = evaluateSessionLifecyclePolicy(
    debriefInput({
      negotiationEndedAt: new Date("2026-08-24T10:00:00.000Z"),
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T09:59:00.000Z"),
    }),
  );
  assert.equal(tied.reason, SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT);
  assert.equal(tied.decision, "due");
});

test("S08 active negotiation empty 60s is not closed", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T11:59:00.000Z"),
    }),
  );
  assert.equal(result.currentlyDue, false);
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT);
});

test("S09 active/non-Debrief Session empty >=3h is due", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T09:00:00.000Z"),
    }),
  );
  assert.equal(result.decision, "due");
  assert.equal(result.reason, SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT);
});

test("S10 never-entered standalone created +3h is due", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      createdAt: new Date("2026-08-24T09:00:00.000Z"),
      lastCurrentGenerationDepartureAt: null,
      negotiationState: NegotiationState.PREPARATION,
    }),
  );
  assert.equal(result.decision, "due");
  assert.equal(
    result.referenceAt?.toISOString(),
    "2026-08-24T09:00:00.000Z",
  );
});

test("S11 future Event child created early is not closed before scheduledAt+3h", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      createdAt: new Date("2026-08-23T09:00:00.000Z"),
      lastCurrentGenerationDepartureAt: null,
      parentEvent: {
        scheduledAt: new Date("2026-08-25T12:00:00.000Z"),
        status: TrainingEventStatus.SESSION_CREATED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "not_due");
  assert.equal(
    result.dueAt?.toISOString(),
    "2026-08-25T15:00:00.000Z",
  );
});

test("S11b early facilitator setup leave is still floored by Event.scheduledAt", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      lastCurrentGenerationDepartureAt: new Date("2026-08-21T09:00:00.000Z"),
      parentEvent: {
        scheduledAt: new Date("2026-08-25T12:00:00.000Z"),
        status: TrainingEventStatus.SESSION_CREATED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "not_due");
  assert.equal(
    result.referenceAt?.toISOString(),
    "2026-08-25T12:00:00.000Z",
  );
  assert.equal(result.dueAt?.toISOString(), "2026-08-25T15:00:00.000Z");
});

test("S12 unused Event child closes at scheduledAt+3h after the Event time passes", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      now: new Date("2026-08-24T15:00:00.000Z"),
      createdAt: new Date("2026-08-23T09:00:00.000Z"),
      lastCurrentGenerationDepartureAt: null,
      parentEvent: {
        scheduledAt: new Date("2026-08-24T12:00:00.000Z"),
        status: TrainingEventStatus.SESSION_CREATED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "due");
  assert.equal(
    result.referenceAt?.toISOString(),
    "2026-08-24T12:00:00.000Z",
  );
});

test("S12b lastLeave after scheduledAt uses lastLeave+3h", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      now: new Date("2026-08-24T16:00:00.000Z"),
      createdAt: new Date("2026-08-23T09:00:00.000Z"),
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T14:00:00.000Z"),
      parentEvent: {
        scheduledAt: new Date("2026-08-24T12:00:00.000Z"),
        status: TrainingEventStatus.SESSION_CREATED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "not_due");
  assert.equal(
    result.referenceAt?.toISOString(),
    "2026-08-24T14:00:00.000Z",
  );
  assert.equal(result.dueAt?.toISOString(), "2026-08-24T17:00:00.000Z");
});

test("S13/S14 facilitator-only and observer-only Debrief are occupied", () => {
  for (const occupancyCount of [1, 1]) {
    const result = evaluateSessionLifecyclePolicy(
      debriefInput({ occupancyCount }),
    );
    assert.equal(result.decision, "occupied");
    assert.equal(result.occupancyClassification, "occupied");
  }
});

test("S15 Event lobby occupancy is not an input and a child Session stays empty", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 0,
      parentEvent: {
        scheduledAt: new Date("2026-08-24T11:00:00.000Z"),
        status: TrainingEventStatus.SESSION_CREATED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.occupancyClassification, "empty");
  assert.equal(result.decision, "due");
});

test("S16 superseded generation timestamps are ignored", () => {
  const now = NOW;
  const connections: CurrentGenerationConnection[] = [
    {
      userId: "user-a",
      leaseVersion: 1,
      createdAt: new Date("2026-08-24T11:00:00.000Z"),
      supersededAt: new Date("2026-08-24T11:50:00.000Z"),
      disconnectedAt: new Date("2026-08-24T11:40:00.000Z"),
      disconnectedReason: "EXPLICIT_LEAVE",
      revokedAt: null,
      expiresAt: new Date("2026-08-24T12:10:00.000Z"),
    },
    {
      userId: "user-a",
      leaseVersion: 2,
      createdAt: new Date("2026-08-24T11:50:00.000Z"),
      supersededAt: null,
      disconnectedAt: new Date("2026-08-24T11:59:30.000Z"),
      disconnectedReason: "EXPLICIT_LEAVE",
      revokedAt: null,
      expiresAt: new Date("2026-08-24T12:10:00.000Z"),
    },
  ];
  const departedAt = resolveLastCurrentGenerationDepartureAt(connections, now);
  assert.equal(departedAt?.toISOString(), "2026-08-24T11:59:30.000Z");
});

test("S17 live expiresAt is not an empty-since timestamp", () => {
  const departedAt = resolveLastCurrentGenerationDepartureAt(
    [
      {
        userId: "user-a",
        leaseVersion: 1,
        createdAt: new Date("2026-08-24T11:50:00.000Z"),
        supersededAt: null,
        disconnectedAt: null,
        disconnectedReason: null,
        revokedAt: null,
        expiresAt: new Date("2026-08-24T12:02:00.000Z"),
      },
    ],
    NOW,
  );
  assert.equal(departedAt, null);
});

test("FINISHED+OPEN recoverable finish fence is not abandoned-closed", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      negotiationState: NegotiationState.FINISHED,
      roomLifecycle: RoomLifecycle.OPEN,
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T08:00:00.000Z"),
    }),
  );
  assert.equal(result.decision, "ineligible");
  assert.equal(result.whyNotDue, "recoverable_finish_fence");
  assert.equal(result.reason, null);
});

test("S20/S21 historical terminal and deleted Sessions are no-ops", () => {
  assert.equal(
    evaluateSessionLifecyclePolicy(
      debriefInput({
        roomLifecycle: RoomLifecycle.CLOSED,
        occupancyCount: 0,
      }),
    ).decision,
    "already_terminal",
  );
  assert.equal(
    evaluateSessionLifecyclePolicy(
      openInput({
        deletedAt: new Date("2026-08-24T11:00:00.000Z"),
      }),
    ).decision,
    "already_terminal",
  );
  assert.equal(
    evaluateSessionLifecyclePolicy(
      openInput({
        roomLifecycle: null,
        negotiationState: NegotiationState.FINISHED,
        createdAt: new Date("2026-08-24T08:00:00.000Z"),
        lastCurrentGenerationDepartureAt: null,
      }),
    ).decision,
    "already_terminal",
  );
});

test("parent Event completed/cancelled does not create an Event auto-close reason", () => {
  const result = evaluateSessionLifecyclePolicy(
    openInput({
      parentEvent: {
        scheduledAt: new Date("2026-08-20T12:00:00.000Z"),
        status: TrainingEventStatus.COMPLETED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "ineligible");
  assert.equal(result.reason, null);
  assert.equal(result.whyNotDue, "parent_event_non_operable");
});

test("H1 Event COMPLETED + child DEBRIEF_OPEN is ineligible with no automatic reason", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 0,
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T10:00:00.000Z"),
      parentEvent: {
        scheduledAt: new Date("2026-08-20T12:00:00.000Z"),
        status: TrainingEventStatus.COMPLETED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "ineligible");
  assert.equal(result.currentlyDue, false);
  assert.equal(result.reason, null);
  assert.equal(result.whyNotDue, "parent_event_non_operable");
});

test("H2 Event CANCELLED + child DEBRIEF_OPEN is ineligible with no automatic reason", () => {
  const result = evaluateSessionLifecyclePolicy(
    debriefInput({
      occupancyCount: 0,
      lastCurrentGenerationDepartureAt: new Date("2026-08-24T10:00:00.000Z"),
      parentEvent: {
        scheduledAt: new Date("2026-08-20T12:00:00.000Z"),
        status: TrainingEventStatus.CANCELLED,
        deletedAt: null,
      },
    }),
  );
  assert.equal(result.decision, "ineligible");
  assert.equal(result.currentlyDue, false);
  assert.equal(result.reason, null);
  assert.equal(result.whyNotDue, "parent_event_non_operable");
});

test("S318A-D-001 floors both never-entered and early-occupied child Sessions", () => {
  const scheduledAt = new Date("2026-08-25T12:00:00.000Z");
  const neverEntered = resolveAbandonedReferenceAt({
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    lastCurrentGenerationDepartureAt: null,
    parentEventScheduledAt: scheduledAt,
  });
  const earlyOccupied = resolveAbandonedReferenceAt({
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    lastCurrentGenerationDepartureAt: new Date("2026-08-21T09:00:00.000Z"),
    parentEventScheduledAt: scheduledAt,
  });
  assert.equal(neverEntered.toISOString(), scheduledAt.toISOString());
  assert.equal(earlyOccupied.toISOString(), scheduledAt.toISOString());
});

test("passive expiry uses expiresAt only after the lease is no longer valid", () => {
  const departedAt = resolveLastCurrentGenerationDepartureAt(
    [
      {
        userId: "user-a",
        leaseVersion: 1,
        createdAt: new Date("2026-08-24T11:50:00.000Z"),
        supersededAt: null,
        disconnectedAt: null,
        disconnectedReason: null,
        revokedAt: null,
        expiresAt: new Date("2026-08-24T11:59:00.000Z"),
      },
    ],
    NOW,
  );
  assert.equal(departedAt?.toISOString(), "2026-08-24T11:59:00.000Z");
});
