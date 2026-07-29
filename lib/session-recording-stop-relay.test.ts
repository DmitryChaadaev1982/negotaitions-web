import assert from "node:assert/strict";
import test from "node:test";

import {
  NegotiationState,
  ParticipantType,
  RecordingStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import {
  isBrowserStopRelayEnabledForMode,
  isRelayEligibleParticipantType,
  isRelayStoppableRecordingStatus,
  isRelayTerminalRecordingStatus,
  isRelayWindowOpenForSessionState,
} from "@/lib/session-recording-stop-relay-policy";

// Stage 3.10 traceability:
// ST310-VOX-001..ST310-VOX-004, ST310-RECORDING-006..ST310-RECORDING-009

test("relay eligibility allows facilitator, participant, observer", () => {
  assert.equal(isRelayEligibleParticipantType(ParticipantType.FACILITATOR), true);
  assert.equal(isRelayEligibleParticipantType(ParticipantType.PARTICIPANT), true);
  assert.equal(isRelayEligibleParticipantType(ParticipantType.OBSERVER), true);
});

test("browser stop relay follows configured server-stop mode", () => {
  assert.equal(isBrowserStopRelayEnabledForMode("disabled"), true);
  assert.equal(
    isBrowserStopRelayEnabledForMode("prefer_server_with_relay_fallback"),
    true,
  );
  assert.equal(
    isBrowserStopRelayEnabledForMode("prefer_server_no_relay_fallback"),
    false,
  );
});

test("relay stoppable statuses include starting policy", () => {
  assert.equal(isRelayStoppableRecordingStatus(RecordingStatus.STARTING), true);
  assert.equal(isRelayStoppableRecordingStatus(RecordingStatus.RECORDING), true);
  assert.equal(isRelayStoppableRecordingStatus(RecordingStatus.PAUSED), true);
  assert.equal(isRelayStoppableRecordingStatus(RecordingStatus.NOT_STARTED), false);
});

test("relay terminal statuses block additional stop relay", () => {
  assert.equal(isRelayTerminalRecordingStatus(RecordingStatus.PROCESSING), true);
  assert.equal(isRelayTerminalRecordingStatus(RecordingStatus.STOPPED), true);
  assert.equal(isRelayTerminalRecordingStatus(RecordingStatus.COMPLETED), true);
  assert.equal(isRelayTerminalRecordingStatus(RecordingStatus.FAILED), true);
  assert.equal(isRelayTerminalRecordingStatus(RecordingStatus.RECORDING), false);
});

test("relay window opens for FINISHED and event completion", () => {
  assert.equal(
    isRelayWindowOpenForSessionState({
      negotiationState: NegotiationState.FINISHED,
      closedByEventAt: null,
      closeReason: null,
      eventStatus: null,
    }),
    true,
  );
  assert.equal(
    isRelayWindowOpenForSessionState({
      negotiationState: NegotiationState.RUNNING,
      closedByEventAt: null,
      closeReason: "EVENT_COMPLETED",
      eventStatus: null,
    }),
    true,
  );
  assert.equal(
    isRelayWindowOpenForSessionState({
      negotiationState: NegotiationState.RUNNING,
      closedByEventAt: null,
      closeReason: null,
      eventStatus: TrainingEventStatus.COMPLETED,
    }),
    true,
  );
  assert.equal(
    isRelayWindowOpenForSessionState({
      negotiationState: NegotiationState.RUNNING,
      closedByEventAt: null,
      closeReason: null,
      eventStatus: TrainingEventStatus.SESSION_CREATED,
    }),
    false,
  );
});
