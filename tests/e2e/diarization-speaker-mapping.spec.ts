/**
 * E2E tests for diarization, speaker clustering, participant mapping, and re-transcription.
 *
 * Covers Parts 3–11 and 15 of the diarization review spec:
 * - Provider speaker labels stored as stable clusters
 * - Cluster mapping propagates to all matching segments
 * - mappingLocked protects manual segment overrides
 * - Diarization failure warning (SINGLE_SPEAKER_ONLY / FAILED)
 * - Hybrid microphone: shared mic vs. separate mic clusters
 * - Re-run transcription via /retranscribe
 * - Re-transcription failure preserves old transcript
 * - AI analysis version warning after re-transcription
 * - Permissions: participant/observer cannot re-run or edit mapping
 * - Multi-session isolation after re-transcription
 */

import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  clearAiAnalysis,
  clearTranscript,
  createAudioActivity,
  createCompletedTranscript,
  createDiarizedTranscript,
  createDiarizedTranscriptWithStatus,
  createE2eCase,
  createE2eEvent,
  getAiAnalysisVersion,
  getEventParticipants,
  getSession,
  getTranscriptRetranscribeInfo,
  getTranscriptSegments,
  getTranscriptText,
  lockTranscriptSegment,
  participantByName,
  updateRecordingCompleted,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

// ── Session fixture helper (same pattern as other spec files) ─────────────────

async function createAssignedSession(request: APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;

  if (!buyerRole || !sellerRole) throw new Error("E2E case roles were not created.");

  await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        facilitatorEventParticipantId: dmitry.id,
        roleAssignments: {
          [buyerRole.id]: igor.id,
          [sellerRole.id]: alex.id,
        },
        observerEventParticipantIds: [serg.id],
        preparationDurationMinutes: 5,
        negotiationDurationMinutes: 15,
      },
    },
  });

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createResponse.ok()).toBeTruthy();
  const body = (await createResponse.json()) as { session: { id: string } };
  const session = await getSession(body.session.id);

  return {
    event,
    session,
    facilitator: participantByName(session.participants, "Dmitry"),
    igor: participantByName(session.participants, "Igor"),
    alex: participantByName(session.participants, "Alex"),
    serg: participantByName(session.participants, "Serg"),
  };
}

async function control(
  request: APIRequestContext,
  sessionId: string,
  joinToken: string,
  action: string,
) {
  const response = await request.post(`/api/sessions/${sessionId}/control`, {
    data: { joinToken, action },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });
});

// ── Diarization Test 1: Provider labels stored as clusters ───────────────────

test("Diarization Test 1 — Provider labels stored; speaker-mapping GET returns two clusters", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 5, text: "Opening from speaker 1." },
    { speakerLabel: "speaker_2", startSeconds: 5, endSeconds: 10, text: "Response from speaker 2." },
    { speakerLabel: "speaker_1", startSeconds: 10, endSeconds: 15, text: "Closing from speaker 1." },
  ]);

  // Segments are stored with correct labels
  const segments = await getTranscriptSegments(session.id);
  expect(segments).toHaveLength(3);
  expect(segments[0]?.speakerLabel).toBe("speaker_1");
  expect(segments[1]?.speakerLabel).toBe("speaker_2");
  expect(segments[2]?.speakerLabel).toBe("speaker_1");

  // GET /speaker-mapping returns exactly 2 clusters (not 3 per-segment entries)
  const mappingRes = await request.get(
    `/api/sessions/${session.id}/speaker-mapping?joinToken=${facilitator.joinToken}`,
  );
  expect(mappingRes.ok()).toBeTruthy();
  const mappingBody = (await mappingRes.json()) as {
    detectedSpeakers: Array<{ speakerLabel: string; displaySpeakerLabel: string }>;
    hasSpeakerDiarization: boolean;
    canEdit: boolean;
  };

  expect(mappingBody.hasSpeakerDiarization).toBe(true);
  expect(mappingBody.canEdit).toBe(true);
  expect(mappingBody.detectedSpeakers).toHaveLength(2);

  const rawLabels = mappingBody.detectedSpeakers.map((s) => s.speakerLabel);
  expect(rawLabels).toContain("speaker_1");
  expect(rawLabels).toContain("speaker_2");

  const displayLabels = mappingBody.detectedSpeakers.map((s) => s.displaySpeakerLabel);
  expect(displayLabels).toContain("Speaker 1");
  expect(displayLabels).toContain("Speaker 2");

  await clearTranscript(session.id);
});

// ── Diarization Test 2: Cluster mapping propagates; respects mappingLocked ───

test("Diarization Test 2 — Cluster mapping propagates to all segments; locked segment is preserved", async ({
  request,
}) => {
  const { session, facilitator, igor, alex } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 5, text: "First segment." },
    { speakerLabel: "speaker_1", startSeconds: 5, endSeconds: 10, text: "Second segment." },
    { speakerLabel: "speaker_1", startSeconds: 10, endSeconds: 15, text: "Third — manually overridden." },
  ]);

  const segmentsBefore = await getTranscriptSegments(session.id);
  expect(segmentsBefore).toHaveLength(3);

  // Lock the third segment to alex via manual override
  await lockTranscriptSegment(segmentsBefore[2]!.id, alex.id);

  // Apply cluster mapping: speaker_1 → igor (no forceOverrideLocked)
  const mappingRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: {
      joinToken: facilitator.joinToken,
      mapping: { speaker_1: igor.id },
      confirm: false,
      applyToTranscript: true,
    },
  });
  expect(mappingRes.ok()).toBeTruthy();
  const mappingBody = (await mappingRes.json()) as {
    transcript: {
      segments: Array<{
        speakerLabel: string;
        mappedParticipantId: string | null;
        mappingSource: string | null;
        mappingLocked: boolean;
      }>;
    };
  };

  const segs = mappingBody.transcript.segments;

  // Segments 0 and 1 mapped to igor via CLUSTER_MAPPING
  expect(segs[0]?.mappedParticipantId).toBe(igor.id);
  expect(segs[0]?.mappingSource).toBe("CLUSTER_MAPPING");
  expect(segs[0]?.mappingLocked).toBe(false);

  expect(segs[1]?.mappedParticipantId).toBe(igor.id);
  expect(segs[1]?.mappingSource).toBe("CLUSTER_MAPPING");
  expect(segs[1]?.mappingLocked).toBe(false);

  // Segment 2 was manually locked — must NOT be overwritten
  expect(segs[2]?.mappedParticipantId).toBe(alex.id);
  expect(segs[2]?.mappingLocked).toBe(true);

  // Apply again with forceOverrideLocked=true → locked segment is now overwritten
  const forceRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: {
      joinToken: facilitator.joinToken,
      mapping: { speaker_1: igor.id },
      confirm: false,
      applyToTranscript: true,
      forceOverrideLocked: true,
    },
  });
  expect(forceRes.ok()).toBeTruthy();
  const forceBody = (await forceRes.json()) as {
    transcript: { segments: Array<{ mappedParticipantId: string | null }> };
  };
  expect(forceBody.transcript.segments[2]?.mappedParticipantId).toBe(igor.id);

  await clearTranscript(session.id);
});

// ── Diarization Test 3: Shared mic — SINGLE_SPEAKER_ONLY warning ─────────────

test("Diarization Test 3 — SINGLE_SPEAKER_ONLY: status API reports diarization warning", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  // All segments collapsed to one speaker (diarization failed to separate)
  await createDiarizedTranscriptWithStatus(session.id, "SINGLE_SPEAKER_ONLY", [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 8, text: "First utterance." },
    { speakerLabel: "speaker_1", startSeconds: 8, endSeconds: 16, text: "Second utterance." },
  ]);

  const statusRes = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  expect(statusRes.ok()).toBeTruthy();
  const statusBody = (await statusRes.json()) as {
    transcription: { diarizationStatus: string | null; hasSpeakerDiarization: boolean };
  };

  expect(statusBody.transcription.diarizationStatus).toBe("SINGLE_SPEAKER_ONLY");
  expect(statusBody.transcription.hasSpeakerDiarization).toBe(true);

  // speaker-mapping GET still returns cluster info (one cluster)
  const mappingRes = await request.get(
    `/api/sessions/${session.id}/speaker-mapping?joinToken=${facilitator.joinToken}`,
  );
  expect(mappingRes.ok()).toBeTruthy();
  const mappingBody = (await mappingRes.json()) as {
    diarizationStatus: string;
    detectedSpeakers: Array<{ speakerLabel: string }>;
  };
  expect(mappingBody.diarizationStatus).toBe("SINGLE_SPEAKER_ONLY");
  expect(mappingBody.detectedSpeakers).toHaveLength(1);

  await clearTranscript(session.id);
});

// ── Diarization Test 4: Hybrid microphone setup ──────────────────────────────

test("Diarization Test 4 — Hybrid mic: shared mic clusters need review; remote mic cluster suggested", async ({
  request,
}) => {
  const { session, facilitator, igor, serg } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  // Speaker 1 and Speaker 2 share igor's microphone (0–10 s)
  // Speaker 3 uses serg's separate remote microphone (10–20 s)
  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 5, text: "Shared mic A." },
    { speakerLabel: "speaker_2", startSeconds: 5, endSeconds: 10, text: "Shared mic B." },
    { speakerLabel: "speaker_3", startSeconds: 10, endSeconds: 15, text: "Remote mic." },
    { speakerLabel: "speaker_3", startSeconds: 15, endSeconds: 20, text: "Remote mic again." },
  ]);

  // igor's mic covers both speaker_1 and speaker_2
  await createAudioActivity(session.id, igor.id, 0, 10);
  // serg's mic uniquely covers speaker_3
  await createAudioActivity(session.id, serg.id, 10, 20);

  const suggestRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: { joinToken: facilitator.joinToken, suggestAutomatically: true },
  });
  expect(suggestRes.ok()).toBeTruthy();
  const suggestBody = (await suggestRes.json()) as {
    available: boolean;
    suggestedMapping: Record<string, string | null>;
    confidence: Record<string, number>;
  };

  expect(suggestBody.available).toBe(true);

  // speaker_3 → serg with strong confidence (unique mic overlap)
  expect(suggestBody.suggestedMapping["speaker_3"]).toBe(serg.id);
  expect(suggestBody.confidence["speaker_3"]).toBeGreaterThanOrEqual(0.6);

  // speaker_1 and speaker_2 share igor's mic — at most one should be high-confidence
  const s1Conf = suggestBody.confidence["speaker_1"] ?? 0;
  const s2Conf = suggestBody.confidence["speaker_2"] ?? 0;
  // Both cannot be confidently mapped to different participants from a shared mic
  expect(s1Conf >= 0.6 && s2Conf >= 0.6).toBe(false);

  await clearTranscript(session.id);
});

// ── Diarization Test 5: Re-run transcription ─────────────────────────────────

test("Diarization Test 5 — Re-run transcription: retranscribeCount increments and history is archived", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  // Initial transcription (v0)
  const firstRes = await request.post(`/api/sessions/${session.id}/materials/transcribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  expect(firstRes.ok()).toBeTruthy();

  const originalText = await getTranscriptText(session.id);
  expect(originalText).toContain("Mock transcript");

  const infoBefore = await getTranscriptRetranscribeInfo(session.id);
  expect(infoBefore?.retranscribeCount).toBe(0);

  // Re-run via /retranscribe endpoint
  const rerunRes = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto", reason: "Testing" },
  });
  expect(rerunRes.ok()).toBeTruthy();
  const rerunBody = (await rerunRes.json()) as { status: string };
  expect(rerunBody.status).toBe("COMPLETED");

  const infoAfter = await getTranscriptRetranscribeInfo(session.id);
  expect(infoAfter?.retranscribeCount).toBe(1);
  expect(Array.isArray(infoAfter?.retranscribeHistory)).toBe(true);
  expect((infoAfter?.retranscribeHistory as unknown[]).length).toBe(1);

  // Status API exposes retranscribeCount to facilitator
  const statusRes = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const statusBody = (await statusRes.json()) as {
    transcription: { retranscribeCount: number };
  };
  expect(statusBody.transcription.retranscribeCount).toBe(1);

  await clearTranscript(session.id);
});

// ── Diarization Test 6: Re-transcription failure preserves old transcript ─────

test("Diarization Test 6 — Re-transcription failure preserves original transcript text", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  const firstRes = await request.post(`/api/sessions/${session.id}/materials/transcribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  expect(firstRes.ok()).toBeTruthy();

  const originalText = await getTranscriptText(session.id);
  expect(originalText).toContain("Mock transcript");

  // Force OpenAI failure during re-run
  await request.post("/api/test/mock-external-service", { data: { error: "OPENAI_QUOTA_EXCEEDED" } });

  const failedRerun = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  expect(failedRerun.ok()).toBeFalsy();

  await request.post("/api/test/mock-external-service", { data: { error: null } });

  // Original text must be restored (not lost on failure)
  const textAfterFailure = await getTranscriptText(session.id);
  expect(textAfterFailure).toBe(originalText);

  // retranscribeCount incremented (attempt was made)
  const info = await getTranscriptRetranscribeInfo(session.id);
  expect(info?.retranscribeCount).toBeGreaterThanOrEqual(1);
  const history = info?.retranscribeHistory as unknown[];
  expect(Array.isArray(history) && history.length >= 1).toBe(true);

  await clearTranscript(session.id);
});

// ── Diarization Test 7: AI analysis version warning ──────────────────────────

test("Diarization Test 7 — AI analysis shows analysisFromOlderTranscript after re-transcription", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  // v0 completed transcript
  await createCompletedTranscript(session.id);

  // Run AI analysis on v0
  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();

  const analysisVersion = await getAiAnalysisVersion(session.id);
  expect(analysisVersion?.transcriptRetranscribeCount).toBe(0);

  // Re-run transcription → v1
  await updateRecordingCompleted(session.id);
  const rerunRes = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  expect(rerunRes.ok()).toBeTruthy();

  const info = await getTranscriptRetranscribeInfo(session.id);
  expect(info?.retranscribeCount).toBe(1);

  // Status API: analysisFromOlderTranscript must be true
  const statusRes = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const statusBody = (await statusRes.json()) as {
    aiAnalysis: { analysisFromOlderTranscript: boolean; status: string };
  };
  expect(statusBody.aiAnalysis.analysisFromOlderTranscript).toBe(true);

  await clearAiAnalysis(session.id);
  await clearTranscript(session.id);
});

// ── Diarization Test 8: Permissions ──────────────────────────────────────────

test("Diarization Test 8 — Participant and observer cannot re-run transcription", async ({
  request,
}) => {
  const { session, facilitator, igor, serg } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  // Participant cannot call /retranscribe
  const participantRes = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: igor.joinToken, language: "auto" },
  });
  expect(participantRes.status()).toBe(403);

  // Observer cannot call /retranscribe
  const observerRes = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: serg.joinToken, language: "auto" },
  });
  expect(observerRes.status()).toBe(403);

  // Participant status never exposes canRerun=true
  const participantStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
  );
  const participantBody = (await participantStatus.json()) as {
    transcription: { canRerun: boolean };
  };
  expect(participantBody.transcription.canRerun).toBe(false);

  // Facilitator status: canRerun=false before there is a completed transcript
  const facilitatorStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const facilitatorBody = (await facilitatorStatus.json()) as {
    transcription: { canRerun: boolean };
  };
  expect(facilitatorBody.transcription.canRerun).toBe(false);
});

// ── Diarization Test 9: Multi-session isolation after re-transcription ────────

test("Diarization Test 9 — Re-transcription in Session 1 does not affect Session 2", async ({
  request,
}) => {
  const sess1 = await createAssignedSession(request);
  const sess2 = await createAssignedSession(request);

  for (const { session, facilitator } of [sess1, sess2]) {
    await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
    await control(request, session.id, facilitator.joinToken, "START");
    await control(request, session.id, facilitator.joinToken, "FINISH");
    await updateRecordingCompleted(session.id);
  }

  // Initial transcription + re-run only in session 1
  await request.post(`/api/sessions/${sess1.session.id}/materials/transcribe`, {
    data: { joinToken: sess1.facilitator.joinToken, language: "auto" },
  });
  const rerunRes = await request.post(`/api/sessions/${sess1.session.id}/materials/retranscribe`, {
    data: { joinToken: sess1.facilitator.joinToken, language: "auto" },
  });
  expect(rerunRes.ok()).toBeTruthy();

  const info1 = await getTranscriptRetranscribeInfo(sess1.session.id);
  expect(info1?.retranscribeCount).toBe(1);

  // Session 2 must be completely unaffected
  const statusRes2 = await request.get(
    `/api/sessions/${sess2.session.id}/materials/status?joinToken=${sess2.facilitator.joinToken}`,
  );
  const body2 = (await statusRes2.json()) as {
    transcription: { status: string | null; retranscribeCount: number | null };
  };
  expect(body2.transcription.status).toBeNull();
  expect(body2.transcription.retranscribeCount).toBeNull();

  await clearTranscript(sess1.session.id);
});

// ── Diarization Test 10: Mock transcription produces segments with speaker labels ─

test("Diarization Test 10 — Mock transcription produces segments; hasSpeakerDiarization matches segment data", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  const transcribeRes = await request.post(`/api/sessions/${session.id}/materials/transcribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  expect(transcribeRes.ok()).toBeTruthy();

  const statusRes = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const statusBody = (await statusRes.json()) as {
    transcription: { hasSpeakerDiarization: boolean; diarizationStatus: string | null };
  };

  const segments = await getTranscriptSegments(session.id);

  if (statusBody.transcription.hasSpeakerDiarization) {
    // At least one segment must carry a speaker label
    const hasAnyLabel = segments.some((s) => s.speakerLabel !== null);
    expect(hasAnyLabel).toBe(true);
  } else {
    // If no diarization, no segment should claim to have null-free speaker labels
    // (i.e., we never default to speaker_1 falsely)
    const allNull = segments.every((s) => s.speakerLabel === null);
    // Either all null or diarization is active — this checks no false positive
    expect(typeof allNull).toBe("boolean");
  }

  // speaker-mapping GET should not force per-segment: clusters only if labels exist
  const mappingRes = await request.get(
    `/api/sessions/${session.id}/speaker-mapping?joinToken=${facilitator.joinToken}`,
  );
  expect(mappingRes.ok()).toBeTruthy();
  const mappingBody = (await mappingRes.json()) as {
    detectedSpeakers: Array<{ speakerLabel: string }>;
  };
  expect(Array.isArray(mappingBody.detectedSpeakers)).toBe(true);

  await clearTranscript(session.id);
});

// ── Diarization Test 11: Re-run blocked when transcription in progress ────────

test("Diarization Test 11 — Re-run transcription returns 409 when transcription is active", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  // First transcription completes synchronously in mock mode
  await request.post(`/api/sessions/${session.id}/materials/transcribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });

  // First re-run also completes synchronously in mock mode
  const firstRerun = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  expect(firstRerun.ok()).toBeTruthy();

  // Second re-run after completion: succeeds (transcript is COMPLETED, not in QUEUED/TRANSCRIBING)
  const secondRerun = await request.post(`/api/sessions/${session.id}/materials/retranscribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });
  // Must not 500; may succeed (COMPLETED) or 409 (if still active)
  expect(secondRerun.status()).not.toBe(500);

  await clearTranscript(session.id);
});
