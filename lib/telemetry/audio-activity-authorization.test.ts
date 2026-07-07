import assert from "node:assert/strict";
import test from "node:test";

import { authorizeAudioActivitySubmission } from "@/lib/telemetry/audio-activity-authorization";
import {
  VOXIMPLANT_MIC_ACTIVITY_SOURCE,
  VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
} from "@/lib/telemetry/audio-activity-sources";

const targetParticipant = {
  id: "sp_target",
  sessionId: "cmr-session",
  type: "PARTICIPANT" as const,
};

test("local mic self-report remains accepted", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_self",
    callerParticipantType: "PARTICIPANT",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_self",
    findSessionParticipantById: async () => targetParticipant,
  });
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.targetSessionParticipantId, "sp_self");
  }
});

test("local mic report for another participant is rejected", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_self",
    callerParticipantType: "PARTICIPANT",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_other",
    findSessionParticipantById: async () => targetParticipant,
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "invalid_session_participant_id");
  }
});

test("facilitator local mic self-report is rejected", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_fac",
    callerParticipantType: "FACILITATOR",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_fac",
    findSessionParticipantById: async () => targetParticipant,
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "local_source_target_must_be_participant");
  }
});

test("observer local mic self-report is rejected", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_obs",
    callerParticipantType: "OBSERVER",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_obs",
    findSessionParticipantById: async () => targetParticipant,
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "local_source_target_must_be_participant");
  }
});

test("facilitator can report remote source for participant in same session", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_fac",
    callerParticipantType: "FACILITATOR",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_target",
    findSessionParticipantById: async () => targetParticipant,
  });
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.targetSessionParticipantId, "sp_target");
  }
});

test("non-facilitator cannot report remote source for another participant", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_self",
    callerParticipantType: "PARTICIPANT",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_target",
    findSessionParticipantById: async () => targetParticipant,
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "remote_source_requires_facilitator");
  }
});

test("remote source rejects participants outside the session", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_fac",
    callerParticipantType: "FACILITATOR",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_target",
    findSessionParticipantById: async () => ({
      ...targetParticipant,
      sessionId: "another-session",
    }),
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "remote_source_participant_outside_session");
  }
});

test("remote source rejects facilitator target", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_fac",
    callerParticipantType: "FACILITATOR",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_target",
    findSessionParticipantById: async () => ({
      id: "sp_target",
      sessionId: "cmr-session",
      type: "FACILITATOR",
    }),
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "remote_source_target_must_be_participant");
  }
});

test("remote source rejects observer target", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_fac",
    callerParticipantType: "FACILITATOR",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_target",
    findSessionParticipantById: async () => ({
      id: "sp_target",
      sessionId: "cmr-session",
      type: "OBSERVER",
    }),
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "remote_source_target_must_be_participant");
  }
});

test("remote source rejects self-target reporter", async () => {
  const result = await authorizeAudioActivitySubmission({
    source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    callerSessionParticipantId: "sp_fac",
    callerParticipantType: "FACILITATOR",
    sessionId: "cmr-session",
    requestedSessionParticipantId: "sp_fac",
    findSessionParticipantById: async () => ({
      id: "sp_fac",
      sessionId: "cmr-session",
      type: "PARTICIPANT",
    }),
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.httpStatus, 403);
    assert.equal(result.reason, "remote_source_target_must_not_be_reporter");
  }
});
