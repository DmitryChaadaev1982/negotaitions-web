import test from "node:test";
import assert from "node:assert/strict";

import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import { deriveEffectiveRoomLifecycle } from "@/lib/session-room-lifecycle";

// Stage 3.10 traceability:
// ST310-MIGRATION-001, ST310-MIGRATION-002, ST310-MIGRATION-003, ST310-MIGRATION-004

test("deriveEffectiveRoomLifecycle keeps explicit lifecycle", () => {
  const lifecycle = deriveEffectiveRoomLifecycle({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    negotiationState: NegotiationState.FINISHED,
  });
  assert.equal(lifecycle, RoomLifecycle.DEBRIEF_OPEN);
});

test("deriveEffectiveRoomLifecycle maps unfinished legacy row to OPEN", () => {
  const lifecycle = deriveEffectiveRoomLifecycle({
    roomLifecycle: null,
    negotiationState: NegotiationState.RUNNING,
  });
  assert.equal(lifecycle, RoomLifecycle.OPEN);
});

test("deriveEffectiveRoomLifecycle maps finished legacy row to CLOSED", () => {
  const lifecycle = deriveEffectiveRoomLifecycle({
    roomLifecycle: null,
    negotiationState: NegotiationState.FINISHED,
  });
  assert.equal(lifecycle, RoomLifecycle.CLOSED);
});

test("deriveEffectiveRoomLifecycle maps completed event to CLOSED", () => {
  const lifecycle = deriveEffectiveRoomLifecycle({
    roomLifecycle: null,
    negotiationState: NegotiationState.RUNNING,
    eventStatus: TrainingEventStatus.COMPLETED,
  });
  assert.equal(lifecycle, RoomLifecycle.CLOSED);
});
