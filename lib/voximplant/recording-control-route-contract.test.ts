import assert from "node:assert/strict";
import test from "node:test";

import { ParticipantType } from "@/app/generated/prisma/client";
import { buildRecordingControllerClaims } from "@/lib/voximplant/recording-control-route-contract";

test("buildRecordingControllerClaims uses stable facilitator identity", () => {
  const claims = buildRecordingControllerClaims({
    participantId: "participant-001",
    participantType: ParticipantType.FACILITATOR,
    userId: "user-001",
  });

  assert.deepEqual(claims, {
    participantId: "participant-001",
    controllerUserId: "user-001",
    controllerRole: "facilitator",
    canControlRecording: true,
  });
});

test("buildRecordingControllerClaims falls back to participant identity when userId missing", () => {
  const claims = buildRecordingControllerClaims({
    participantId: "participant-xyz",
    participantType: ParticipantType.FACILITATOR,
    userId: null,
  });
  assert.equal(claims.controllerUserId, "session_participant:participant-xyz");
});

test("buildRecordingControllerClaims rejects non-facilitator direct controls", () => {
  assert.throws(
    () =>
      buildRecordingControllerClaims({
        participantId: "participant-001",
        participantType: ParticipantType.PARTICIPANT,
        userId: "user-001",
      }),
    /Only facilitators/,
  );
});
