import test from "node:test";
import assert from "node:assert/strict";

import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import {
  deriveBackfillLifecycle,
  deriveRoomLifecycleBackfillUpdate,
  isRelayDeliveringTimeoutCandidate,
  nextRetryAtFromAttempt,
} from "@/lib/stage-3-10-maintenance-utils";

// Stage 3.10 traceability:
// ST310-MIGRATION-005, ST310-MIGRATION-006, ST310-MIGRATION-007, ST310-RACE-001

test("nextRetryAtFromAttempt increases delay with capped growth", () => {
  const now = Date.now();
  const first = nextRetryAtFromAttempt(1).getTime();
  const fourth = nextRetryAtFromAttempt(4).getTime();
  const tenth = nextRetryAtFromAttempt(10).getTime();

  assert.ok(first > now);
  assert.ok(fourth > first);
  // attempt > 8 is capped, so 10 and 8 are nearly equal
  const capped = nextRetryAtFromAttempt(8).getTime();
  assert.ok(Math.abs(tenth - capped) < 2000);
});

test("deriveBackfillLifecycle marks unfinished rows as OPEN", () => {
  const lifecycle = deriveBackfillLifecycle({
    deletedAt: null,
    closedByEventAt: null,
    negotiationState: NegotiationState.RUNNING,
    eventStatus: null,
  });
  assert.equal(lifecycle, RoomLifecycle.OPEN);
});

test("deriveBackfillLifecycle marks finished rows as CLOSED", () => {
  const lifecycle = deriveBackfillLifecycle({
    deletedAt: null,
    closedByEventAt: null,
    negotiationState: NegotiationState.FINISHED,
    eventStatus: null,
  });
  assert.equal(lifecycle, RoomLifecycle.CLOSED);
});

test("room lifecycle backfill atomically synchronizes FINISHED terminal status", () => {
  const input = {
    roomLifecycle: null,
    deletedAt: null,
    closedByEventAt: null,
    negotiationState: NegotiationState.FINISHED,
    eventStatus: null,
  };

  assert.deepEqual(deriveRoomLifecycleBackfillUpdate(input), {
    roomLifecycle: RoomLifecycle.CLOSED,
    status: "COMPLETED",
  });
  assert.deepEqual(
    deriveRoomLifecycleBackfillUpdate(input),
    deriveRoomLifecycleBackfillUpdate(input),
    "repeated derivation is idempotent",
  );
});

test("room lifecycle backfill leaves explicit Debrief and CLOSED rows untouched", () => {
  for (const roomLifecycle of [
    RoomLifecycle.DEBRIEF_OPEN,
    RoomLifecycle.CLOSED,
  ]) {
    assert.equal(
      deriveRoomLifecycleBackfillUpdate({
        roomLifecycle,
        deletedAt: null,
        closedByEventAt: null,
        negotiationState: NegotiationState.FINISHED,
        eventStatus: null,
      }),
      null,
      roomLifecycle,
    );
  }
});

test("deriveBackfillLifecycle keeps completed events CLOSED", () => {
  const lifecycle = deriveBackfillLifecycle({
    deletedAt: null,
    closedByEventAt: null,
    negotiationState: NegotiationState.RUNNING,
    eventStatus: TrainingEventStatus.COMPLETED,
  });
  assert.equal(lifecycle, RoomLifecycle.CLOSED);
});

test("relay delivering timeout candidate detects stale browser relay claim", () => {
  const cutoff = new Date("2026-07-21T09:00:00.000Z");
  const stale = isRelayDeliveringTimeoutCandidate(
    {
      state: "DELIVERING",
      lastDeliveryTransport: "voximplant_browser_relay_claim",
      transportAcceptedAt: null,
      commandAcceptedAt: null,
      providerTerminalAt: null,
      lastAttemptAt: new Date("2026-07-21T08:59:59.000Z"),
    },
    cutoff,
  );
  assert.equal(stale, true);
});

test("relay delivering timeout candidate ignores active or accepted deliveries", () => {
  const cutoff = new Date("2026-07-21T09:00:00.000Z");
  const withTransportAccepted = isRelayDeliveringTimeoutCandidate(
    {
      state: "DELIVERING",
      lastDeliveryTransport: "voximplant_browser_relay_claim",
      transportAcceptedAt: new Date("2026-07-21T08:59:00.000Z"),
      commandAcceptedAt: null,
      providerTerminalAt: null,
      lastAttemptAt: new Date("2026-07-21T08:58:00.000Z"),
    },
    cutoff,
  );
  assert.equal(withTransportAccepted, false);

  const recentRelayClaim = isRelayDeliveringTimeoutCandidate(
    {
      state: "DELIVERING",
      lastDeliveryTransport: "voximplant_browser_relay_claim",
      transportAcceptedAt: null,
      commandAcceptedAt: null,
      providerTerminalAt: null,
      lastAttemptAt: new Date("2026-07-21T09:00:01.000Z"),
    },
    cutoff,
  );
  assert.equal(recentRelayClaim, false);

  const staleRelayAck = isRelayDeliveringTimeoutCandidate(
    {
      state: "DELIVERING",
      lastDeliveryTransport: "voximplant_browser_relay_ack",
      transportAcceptedAt: null,
      commandAcceptedAt: null,
      providerTerminalAt: null,
      lastAttemptAt: new Date("2026-07-21T08:58:00.000Z"),
    },
    cutoff,
  );
  assert.equal(staleRelayAck, true);
});
