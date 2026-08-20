import assert from "node:assert/strict";
import test from "node:test";

import {
  areMaterialNegotiationNotesLockedAfterNegotiation,
  areNotesMaterialToNegotiationAnalysis,
} from "@/lib/ai/material-negotiation-notes";

test("only negotiation PARTICIPANT notes are material to current AI analysis", () => {
  assert.equal(areNotesMaterialToNegotiationAnalysis("PARTICIPANT"), true);
  assert.equal(areNotesMaterialToNegotiationAnalysis("FACILITATOR"), false);
  assert.equal(areNotesMaterialToNegotiationAnalysis("OBSERVER"), false);
  assert.equal(areNotesMaterialToNegotiationAnalysis(null), false);
  assert.equal(areNotesMaterialToNegotiationAnalysis(""), false);
});

test("N05E participant notes stay editable before FINISHED", () => {
  for (const negotiationState of [
    "PREPARATION",
    "PREPARATION_RUNNING",
    "READY_TO_START",
    "RUNNING",
    "PAUSED",
  ]) {
    assert.equal(
      areMaterialNegotiationNotesLockedAfterNegotiation({
        participantType: "PARTICIPANT",
        negotiationState,
      }),
      false,
      negotiationState,
    );
  }
});

test("N05A participant notes lock after FINISHED; facilitator and observer stay open", () => {
  assert.equal(
    areMaterialNegotiationNotesLockedAfterNegotiation({
      participantType: "PARTICIPANT",
      negotiationState: "FINISHED",
    }),
    true,
  );
  assert.equal(
    areMaterialNegotiationNotesLockedAfterNegotiation({
      participantType: "FACILITATOR",
      negotiationState: "FINISHED",
    }),
    false,
  );
  assert.equal(
    areMaterialNegotiationNotesLockedAfterNegotiation({
      participantType: "OBSERVER",
      negotiationState: "FINISHED",
    }),
    false,
  );
});
