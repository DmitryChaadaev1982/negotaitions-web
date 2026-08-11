import assert from "node:assert/strict";
import test from "node:test";

import { NegotiationState } from "@/app/generated/prisma/client";
import {
  canUseFinishLinePresentation,
  coalesceFinishLineDeadlineMs,
  computeFinishLineClientDeadlineMs,
  computeFinishLineRemainingMs,
  deriveLiveSessionPresentationState,
} from "@/lib/live-session-presentation";

test("maps preparation states to approved presentation aliases", () => {
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.PREPARATION,
      remainingSeconds: 600,
      finishLineActive: false,
    }),
    "ROOM_READY",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.PREPARATION_RUNNING,
      remainingSeconds: 600,
      finishLineActive: false,
    }),
    "PREPARATION_RUNNING",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.PREPARATION_PAUSED,
      remainingSeconds: 600,
      finishLineActive: false,
    }),
    "PREPARATION_PAUSED",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.READY_TO_START,
      remainingSeconds: 600,
      finishLineActive: false,
    }),
    "WAITING_FOR_NEGOTIATION_START",
  );
});

test("maps running states with warning precedence", () => {
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.RUNNING,
      remainingSeconds: 120,
      finishLineActive: false,
    }),
    "NEGOTIATION_RUNNING",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.RUNNING,
      remainingSeconds: 60,
      finishLineActive: false,
    }),
    "FINAL_MINUTE",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.RUNNING,
      remainingSeconds: 10,
      finishLineActive: false,
    }),
    "FINAL_10_SECONDS",
  );
});

test("paused state takes precedence over running warning windows", () => {
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.PAUSED,
      remainingSeconds: 9,
      finishLineActive: false,
    }),
    "NEGOTIATION_PAUSED",
  );
});

test("maps finished finish-line variants and debrief fallback", () => {
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.FINISHED,
      remainingSeconds: 0,
      finishLineActive: true,
    }),
    "FINISH_LINE_TIMER_EXPIRED",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.FINISHED,
      remainingSeconds: 245,
      finishLineActive: true,
    }),
    "FINISH_LINE_MANUAL_FINISH",
  );
  assert.equal(
    deriveLiveSessionPresentationState({
      negotiationState: NegotiationState.FINISHED,
      remainingSeconds: 0,
      finishLineActive: false,
    }),
    "DEBRIEF",
  );
});

test("hard-close message keys disable finish-line eligibility", () => {
  assert.equal(
    canUseFinishLinePresentation({
      negotiationState: NegotiationState.FINISHED,
      closeMessageKey: "join.sessionFinishedMessage",
    }),
    true,
  );
  assert.equal(
    canUseFinishLinePresentation({
      negotiationState: NegotiationState.FINISHED,
      closeMessageKey: "events.sessionClosedByEvent",
    }),
    false,
  );
  assert.equal(
    canUseFinishLinePresentation({
      negotiationState: NegotiationState.FINISHED,
      closeMessageKey: "events.sessionClosedBeforeNegotiation",
    }),
    false,
  );
});

test("finish-line deadline aligns to authoritative serverNow offset", () => {
  const deadline = computeFinishLineClientDeadlineMs({
    negotiationEndedAt: "2026-08-11T10:00:00.000Z",
    serverNow: "2026-08-11T10:00:01.000Z",
    clientNowMs: 50_000,
  });
  assert.equal(deadline, 51_500);
});

test("finish-line client deadline returns null after authoritative window", () => {
  const deadline = computeFinishLineClientDeadlineMs({
    negotiationEndedAt: "2026-08-11T10:00:00.000Z",
    serverNow: "2026-08-11T10:00:03.000Z",
    clientNowMs: 1_000,
  });
  assert.equal(deadline, null);
});

test("repeated polls can shorten deadline but never extend it", () => {
  const initialDeadline = 5_000;
  const extendedCandidate = 6_000;
  const shortenedCandidate = 4_200;

  assert.equal(
    coalesceFinishLineDeadlineMs(initialDeadline, extendedCandidate),
    initialDeadline,
  );
  assert.equal(
    coalesceFinishLineDeadlineMs(initialDeadline, shortenedCandidate),
    shortenedCandidate,
  );
});

test("remount/reconnect uses remaining authoritative finish-line time", () => {
  const firstObservation = computeFinishLineClientDeadlineMs({
    negotiationEndedAt: "2026-08-11T10:00:00.000Z",
    serverNow: "2026-08-11T10:00:00.200Z",
    clientNowMs: 1_000,
  });
  const reconnectObservation = computeFinishLineClientDeadlineMs({
    negotiationEndedAt: "2026-08-11T10:00:00.000Z",
    serverNow: "2026-08-11T10:00:01.700Z",
    clientNowMs: 1_200,
  });
  assert.equal(firstObservation, 3_300);
  assert.equal(reconnectObservation, 2_000);
});

test("remaining-ms helper clamps invalid skew and expiry bounds", () => {
  assert.equal(
    computeFinishLineRemainingMs({
      negotiationEndedAt: "2026-08-11T10:00:00.000Z",
      serverNow: "2026-08-11T09:59:59.500Z",
    }),
    2_500,
  );
  assert.equal(
    computeFinishLineRemainingMs({
      negotiationEndedAt: "2026-08-11T10:00:00.000Z",
      serverNow: "2026-08-11T10:00:04.000Z",
    }),
    0,
  );
});
