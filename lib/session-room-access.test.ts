import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import {
  canCreateLateObserverParticipant,
  decideSessionRoomAccess,
  resolveSessionClosedRedirectPath,
} from "@/lib/session-room-access";

const baseInput = {
  user: {
    isAuthenticated: true,
    isAuthorizedMember: true,
  },
  session: {
    sessionId: "session-1",
    negotiationState: NegotiationState.RUNNING,
    roomLifecycle: RoomLifecycle.OPEN,
    deletedAt: null,
    closeReason: null,
    closedByEventAt: null,
    eventId: null,
    eventStatus: null,
  },
  redirect: {
    sessionId: "session-1",
    participantJoinToken: "join-token-1",
    eventId: null,
    eventStatus: null,
    preferEventResultsForEventOwner: false,
  },
} as const;

describe("decideSessionRoomAccess", () => {
  it("allows OPEN lifecycle room access", () => {
    const decision = decideSessionRoomAccess(baseInput);
    assert.equal(decision.output, "ALLOW_ACTIVE_ROOM");
  });

  it("allows FINISHED + DEBRIEF_OPEN access", () => {
    const decision = decideSessionRoomAccess({
      ...baseInput,
      session: {
        ...baseInput.session,
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
      },
    });
    assert.equal(decision.output, "ALLOW_DEBRIEF");
    assert.equal(decision.isDebrief, true);
  });

  it("redirects CLOSED room to materials", () => {
    const decision = decideSessionRoomAccess({
      ...baseInput,
      session: {
        ...baseInput.session,
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: RoomLifecycle.CLOSED,
      },
    });
    assert.equal(decision.output, "REDIRECT_MATERIALS");
    assert.equal(decision.redirectTo, "/join/join-token-1");
  });

  it("returns EVENT_CLOSED for completed event-linked session", () => {
    const decision = decideSessionRoomAccess({
      ...baseInput,
      session: {
        ...baseInput.session,
        roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
        eventId: "event-1",
        eventStatus: TrainingEventStatus.COMPLETED,
      },
      redirect: {
        ...baseInput.redirect,
        eventId: "event-1",
        eventStatus: TrainingEventStatus.COMPLETED,
      },
    });
    assert.equal(decision.output, "EVENT_CLOSED");
    assert.equal(decision.redirectTo, "/join/join-token-1");
  });

  it("treats legacy null lifecycle + finished as closed redirect", () => {
    const decision = decideSessionRoomAccess({
      ...baseInput,
      session: {
        ...baseInput.session,
        roomLifecycle: null,
        negotiationState: NegotiationState.FINISHED,
      },
    });
    assert.equal(decision.output, "REDIRECT_MATERIALS");
  });

  it("denies deleted session", () => {
    const decision = decideSessionRoomAccess({
      ...baseInput,
      session: {
        ...baseInput.session,
        deletedAt: new Date(),
      },
    });
    assert.equal(decision.output, "DENY_DELETED");
  });
});

describe("resolveSessionClosedRedirectPath", () => {
  it("prefers event lobby results for event owners when requested", () => {
    const path = resolveSessionClosedRedirectPath({
      sessionId: "session-1",
      eventId: "event-1",
      eventStatus: TrainingEventStatus.COMPLETED,
      participantJoinToken: "join-token-1",
      preferEventResultsForEventOwner: true,
    });
    assert.equal(path, "/events/event-1/lobby");
  });
});

describe("canCreateLateObserverParticipant", () => {
  const base = {
    event: {
      status: TrainingEventStatus.SESSION_CREATED,
    },
    user: {
      isAuthenticated: true,
      isAuthorizedMember: true,
    },
    session: {
      sessionId: "session-1",
      eventId: "event-1",
      status: "READY",
      negotiationState: NegotiationState.RUNNING,
      roomLifecycle: RoomLifecycle.OPEN,
      deletedAt: null,
      closeReason: null,
      closedByEventAt: null,
      eventStatus: TrainingEventStatus.SESSION_CREATED,
    },
    existingSessionParticipant: false,
  } as const;

  it("allows first observer creation for OPEN rooms", () => {
    const decision = canCreateLateObserverParticipant(base);
    assert.equal(decision.allowed, true);
  });

  it("allows first observer creation for legacy active null lifecycle", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      session: {
        ...base.session,
        roomLifecycle: null,
        negotiationState: NegotiationState.PREPARATION,
      },
    });
    assert.equal(decision.allowed, true);
  });

  it("allows DEBRIEF_OPEN first observer creation", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      session: {
        ...base.session,
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
      },
    });
    assert.equal(decision.allowed, true);
    if (!decision.allowed) {
      return;
    }
    assert.equal(decision.accessDecision.output, "ALLOW_DEBRIEF");
  });

  it("allows DEBRIEF_OPEN first observer creation when Session.status is COMPLETED", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      session: {
        ...base.session,
        status: "COMPLETED",
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
      },
    });
    assert.equal(decision.allowed, true);
    if (!decision.allowed) {
      return;
    }
    assert.equal(decision.accessDecision.output, "ALLOW_DEBRIEF");
  });

  it("denies FINISHED recovery-fence rooms that are not DEBRIEF_OPEN", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      session: {
        ...base.session,
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: RoomLifecycle.OPEN,
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "NEGOTIATION_FINISHED");
  });

  it("denies first observer creation for closed rooms", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      session: {
        ...base.session,
        roomLifecycle: RoomLifecycle.CLOSED,
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ROOM_POLICY_DENIED");
  });

  it("denies first observer creation for completed events", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      event: { status: TrainingEventStatus.COMPLETED },
      session: {
        ...base.session,
        eventStatus: TrainingEventStatus.COMPLETED,
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "EVENT_COMPLETED");
  });

  it("denies when the user already has a session participant", () => {
    const decision = canCreateLateObserverParticipant({
      ...base,
      existingSessionParticipant: true,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "EXISTING_SESSION_PARTICIPANT");
  });
});
