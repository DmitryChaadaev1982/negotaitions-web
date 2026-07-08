import assert from "node:assert/strict";
import test from "node:test";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";
import { isMicAllowed } from "@/lib/negotiation-control";

test("isMicAllowed keeps RUNNING participant-only policy", () => {
  assert.equal(
    isMicAllowed(NegotiationState.RUNNING, ParticipantType.PARTICIPANT),
    true,
  );
  assert.equal(
    isMicAllowed(NegotiationState.RUNNING, ParticipantType.FACILITATOR),
    false,
  );
  assert.equal(
    isMicAllowed(NegotiationState.RUNNING, ParticipantType.OBSERVER),
    false,
  );
});

test("isMicAllowed allows all in-room roles while PAUSED", () => {
  assert.equal(
    isMicAllowed(NegotiationState.PAUSED, ParticipantType.PARTICIPANT),
    true,
  );
  assert.equal(
    isMicAllowed(NegotiationState.PAUSED, ParticipantType.FACILITATOR),
    true,
  );
  assert.equal(
    isMicAllowed(NegotiationState.PAUSED, ParticipantType.OBSERVER),
    true,
  );
});
