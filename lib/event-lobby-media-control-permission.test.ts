import assert from "node:assert/strict";
import test from "node:test";

import { resolveLobbyMediaControlPermission } from "@/lib/event-lobby-media-control-permission";
import type { EventParticipantPresenceState } from "@/lib/event-participant-presence";

function resolve(params: {
  actorId?: string | null;
  isEventOwner?: boolean;
  targetId?: string;
  state: EventParticipantPresenceState;
}) {
  return resolveLobbyMediaControlPermission({
    actor: {
      participantId: params.actorId ?? "actor",
      isEventOwner: Boolean(params.isEventOwner),
    },
    target: {
      participantId: params.targetId ?? "target",
    },
    targetPresence: {
      state: params.state,
    },
    device: "mic",
  });
}

test("target IN_LOBBY actor self is allowed", () => {
  assert.deepEqual(
    resolve({ actorId: "target", targetId: "target", state: "IN_LOBBY" }),
    { allowed: true, controlKind: "self" },
  );
});

test("target IN_LOBBY Event owner remote action is allowed", () => {
  assert.deepEqual(
    resolve({ isEventOwner: true, state: "IN_LOBBY" }),
    { allowed: true, controlKind: "remote" },
  );
});

test("target IN_LOBBY unrelated participant is forbidden", () => {
  assert.deepEqual(resolve({ state: "IN_LOBBY" }), {
    allowed: false,
    reason: "ACTOR_NOT_AUTHORIZED",
  });
});

test("non-lobby target states are rejected for every actor", () => {
  for (const state of [
    "IN_SESSION",
    "TEMPORARILY_AWAY",
    "OFFLINE",
    "INVITED_NOT_CONNECTED",
  ] as const) {
    assert.deepEqual(resolve({ isEventOwner: true, state }), {
      allowed: false,
      reason: "TARGET_NOT_IN_LOBBY",
    });
    assert.deepEqual(resolve({ actorId: "target", targetId: "target", state }), {
      allowed: false,
      reason: "TARGET_NOT_IN_LOBBY",
    });
  }
});

test("return to lobby restores eligibility", () => {
  assert.equal(resolve({ isEventOwner: true, state: "IN_SESSION" }).allowed, false);
  assert.deepEqual(resolve({ isEventOwner: true, state: "IN_LOBBY" }), {
    allowed: true,
    controlKind: "remote",
  });
});
