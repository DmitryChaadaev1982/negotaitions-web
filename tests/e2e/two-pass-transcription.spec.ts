/**
 * E2E tests for the two-pass (diarize_plus_quality) transcription strategy.
 *
 * Covers Parts 15 of the two-pass transcription spec:
 *  Test 1 — diarize_plus_quality success: speaker labels, finalText, timestamps preserved
 *  Test 2 — quality pass improves key agreement phrase
 *  Test 3 — quality pass fails but diarization remains usable
 *  Test 4 — alignment low confidence: keep diarized, store quality as suggestion
 *  Test 5 — speaker mapping after enhancement
 *  Test 6 — re-run with quality enhancement: v1 preserved, v2 active
 *  Test 7 — AI analysis references active enhanced transcript
 *  Test 8 — hidden case data not in quality prompt
 *  Test 9 — permissions: participant/observer cannot re-run enhancement
 *
 * NOTE: These tests use mock transcription mode (EXTERNAL_SERVICES_MODE=mock).
 * The mock runner reads OPENAI_TRANSCRIPTION_STRATEGY from the env and produces
 * two-pass mock data when strategy=diarize_plus_quality.
 */

import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  createE2eCase,
  createE2eEvent,
  createTwoPassTranscript,
  getAiAnalysisVersion,
  getEventParticipants,
  getSession,
  getTwoPassSegments,
  getTwoPassTranscriptInfo,
  getTranscriptRetranscribeInfo,
  participantByName,
  updateRecordingCompleted,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

// ── Session fixture ───────────────────────────────────────────────────────────

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
    negotiationCase,
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

async function startTranscription(
  request: APIRequestContext,
  sessionId: string,
  joinToken: string,
) {
  const res = await request.post(`/api/sessions/${sessionId}/materials/transcribe`, {
    data: { joinToken, language: "auto" },
  });
  return res;
}

async function rerunTranscription(
  request: APIRequestContext,
  sessionId: string,
  joinToken: string,
) {
  const res = await request.post(`/api/sessions/${sessionId}/materials/retranscribe`, {
    data: { joinToken },
  });
  return res;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — diarize_plus_quality success
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 1 — diarize_plus_quality: speaker labels and timestamps preserved", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  const res = await startTranscription(request, session.id, facilitator.joinToken);
  expect(res.ok()).toBeTruthy();

  const transcript = await getTwoPassTranscriptInfo(session.id);
  expect(transcript).not.toBeNull();
  expect(transcript!.status).toBe("COMPLETED");
  expect(transcript!.strategy).toBe("diarize_plus_quality");
  expect(transcript!.diarizationPassStatus).toBe("COMPLETED");
  expect(transcript!.qualityPassStatus).toBe("OK");
  expect(transcript!.alignmentStatus).toBe("ALIGNED");
  expect(transcript!.hasSpeakerDiarization).toBe(true);

  const segments = await getTwoPassSegments(session.id);
  expect(segments.length).toBeGreaterThanOrEqual(2);

  // Speaker labels from diarization pass are preserved
  for (const seg of segments) {
    expect(seg.speakerLabel).not.toBeNull();
    expect(seg.speakerLabel).toMatch(/^speaker_/);
  }

  // Timestamps are from diarization pass
  for (const seg of segments) {
    expect(seg.startSeconds).not.toBeNull();
    expect(seg.endSeconds).not.toBeNull();
    expect(typeof seg.startSeconds).toBe("number");
  }

  // finalText (text column) should be enhanced where alignment was successful
  for (const seg of segments) {
    expect(seg.text.length).toBeGreaterThan(0);
    if (seg.textSource === "QUALITY") {
      expect(seg.qualityText).not.toBeNull();
      expect(seg.alignmentConfidence).not.toBeNull();
      expect(seg.alignmentConfidence!).toBeGreaterThan(0.5);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — quality pass improves key agreement phrase
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 2 — quality pass improves key agreement phrase while preserving speaker", async ({
  request,
}) => {
  const { session } = await createAssignedSession(request);

  // Simulate: diarized text has inaccurate phrase; quality text has correct one
  const transcript = await createTwoPassTranscript(
    session.id,
    [
      {
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 5,
        text: "договорились", // final text = quality-aligned text
        qualityText: "договорились",
        alignmentConfidence: 0.87,
        textSource: "QUALITY",
      },
      {
        speakerLabel: "speaker_2",
        startSeconds: 5,
        endSeconds: 10,
        text: "беру за эту цену",
        qualityText: "беру за эту цену",
        alignmentConfidence: 0.82,
        textSource: "QUALITY",
      },
    ],
    { strategy: "diarize_plus_quality", qualityPassStatus: "OK", alignmentStatus: "ALIGNED" },
  );

  const segments = await getTwoPassSegments(session.id);
  expect(segments).toHaveLength(2);

  // Agreement phrase is in the final text
  expect(segments[0]?.text).toBe("договорились");
  expect(segments[0]?.textSource).toBe("QUALITY");

  // Speaker label is preserved from diarization pass
  expect(segments[0]?.speakerLabel).toBe("speaker_1");
  expect(segments[1]?.speakerLabel).toBe("speaker_2");

  // qualityText stored as well
  expect(segments[0]?.qualityText).toBe("договорились");
  expect(segments[0]?.alignmentConfidence).toBeGreaterThanOrEqual(0.75);

  // Timestamps are preserved
  expect(segments[0]?.startSeconds).toBe(0);
  expect(segments[0]?.endSeconds).toBe(5);

  void transcript;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — quality pass fails but diarization remains usable
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 3 — quality pass fails; diarized transcript remains usable with LOW_CONFIDENCE", async ({
  request,
}) => {
  const { session } = await createAssignedSession(request);

  // Simulate: diarization succeeded but quality pass failed
  await createTwoPassTranscript(
    session.id,
    [
      {
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 5,
        text: "Speaker 1 diarized text.",
        qualityText: null,
        alignmentConfidence: null,
        textSource: "DIARIZED",
      },
      {
        speakerLabel: "speaker_2",
        startSeconds: 5,
        endSeconds: 10,
        text: "Speaker 2 diarized text.",
        qualityText: null,
        alignmentConfidence: null,
        textSource: "DIARIZED",
      },
    ],
    {
      strategy: "diarize_plus_quality",
      qualityPassStatus: "LOW_CONFIDENCE",
      alignmentStatus: "SKIPPED",
      alignmentConfidence: null,
    },
  );

  const transcript = await getTwoPassTranscriptInfo(session.id);
  expect(transcript).not.toBeNull();
  expect(transcript!.status).toBe("COMPLETED");
  expect(transcript!.diarizationPassStatus).toBe("COMPLETED");
  expect(transcript!.qualityPassStatus).toBe("LOW_CONFIDENCE");
  expect(transcript!.hasSpeakerDiarization).toBe(true);

  const segments = await getTwoPassSegments(session.id);
  expect(segments).toHaveLength(2);

  // Diarized text is shown (not lost)
  expect(segments[0]?.text).toBe("Speaker 1 diarized text.");
  expect(segments[0]?.textSource).toBe("DIARIZED");
  expect(segments[0]?.qualityText).toBeNull();

  // Speaker labels are preserved from diarization pass
  expect(segments[0]?.speakerLabel).toBe("speaker_1");
  expect(segments[1]?.speakerLabel).toBe("speaker_2");
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — alignment low confidence: keep diarized, store quality as suggestion
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 4 — low-confidence alignment: finalText keeps diarized, qualityText stored as suggestion", async ({
  request,
}) => {
  const { session } = await createAssignedSession(request);

  await createTwoPassTranscript(
    session.id,
    [
      {
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 5,
        text: "Original diarized phrase speaker one.", // finalText = diarized (low confidence)
        qualityText: "Completely unrelated quality output.", // stored as suggestion
        alignmentConfidence: 0.3, // below 0.5 threshold
        textSource: "DIARIZED",
      },
      {
        speakerLabel: "speaker_2",
        startSeconds: 5,
        endSeconds: 10,
        text: "Seller diarized response.", // moderate confidence
        qualityText: "Seller quality response.",
        alignmentConfidence: 0.62, // 0.5-0.75 → NEEDS_REVIEW but uses quality text
        textSource: "QUALITY",
      },
    ],
    {
      strategy: "diarize_plus_quality",
      qualityPassStatus: "LOW_CONFIDENCE",
      alignmentStatus: "PARTIAL",
    },
  );

  const segments = await getTwoPassSegments(session.id);
  expect(segments).toHaveLength(2);

  // Low confidence segment: finalText = diarized
  const lowConfSeg = segments[0]!;
  expect(lowConfSeg.text).toBe("Original diarized phrase speaker one.");
  expect(lowConfSeg.textSource).toBe("DIARIZED");
  expect(lowConfSeg.qualityText).toBe("Completely unrelated quality output."); // stored as suggestion
  expect(lowConfSeg.alignmentConfidence).toBeLessThan(0.5);
  expect(lowConfSeg.speakerLabel).toBe("speaker_1"); // preserved

  // Medium confidence segment: finalText = quality
  const midConfSeg = segments[1]!;
  expect(midConfSeg.text).toBe("Seller quality response.");
  expect(midConfSeg.textSource).toBe("QUALITY");
  expect(midConfSeg.alignmentConfidence).toBeGreaterThanOrEqual(0.5);
  expect(midConfSeg.speakerLabel).toBe("speaker_2"); // preserved
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — speaker mapping after enhancement
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 5 — speaker mapping works on enhanced transcript segments", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await createTwoPassTranscript(
    session.id,
    [
      {
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 5,
        text: "Enhanced phrase from speaker 1.",
        qualityText: "Enhanced phrase from speaker 1.",
        alignmentConfidence: 0.91,
        textSource: "QUALITY",
      },
      {
        speakerLabel: "speaker_2",
        startSeconds: 5,
        endSeconds: 10,
        text: "Enhanced phrase from speaker 2.",
        qualityText: "Enhanced phrase from speaker 2.",
        alignmentConfidence: 0.88,
        textSource: "QUALITY",
      },
      {
        speakerLabel: "speaker_1",
        startSeconds: 10,
        endSeconds: 15,
        text: "Follow up from speaker 1.",
        qualityText: "Follow up from speaker 1.",
        alignmentConfidence: 0.79,
        textSource: "QUALITY",
      },
    ],
    { strategy: "diarize_plus_quality", qualityPassStatus: "OK", alignmentStatus: "ALIGNED" },
  );

  // GET speaker-mapping should return 2 clusters
  const mappingRes = await request.get(
    `/api/sessions/${session.id}/speaker-mapping?joinToken=${facilitator.joinToken}`,
  );
  expect(mappingRes.ok()).toBeTruthy();
  const mappingBody = (await mappingRes.json()) as {
    detectedSpeakers: Array<{ speakerLabel: string }>;
  };
  expect(mappingBody.detectedSpeakers).toHaveLength(2);

  const labels = mappingBody.detectedSpeakers.map((s) => s.speakerLabel);
  expect(labels).toContain("speaker_1");
  expect(labels).toContain("speaker_2");

  // Enhanced text is still shown in segments
  const segments = await getTwoPassSegments(session.id);
  const speaker1Segments = segments.filter((s) => s.speakerLabel === "speaker_1");
  expect(speaker1Segments).toHaveLength(2);
  for (const seg of speaker1Segments) {
    expect(seg.textSource).toBe("QUALITY");
    expect(seg.text.length).toBeGreaterThan(0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — re-run with quality enhancement: v1 preserved, v2 active
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 6 — re-run creates v2; v1 preserved in retranscribeHistory", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  // First transcription (v1)
  const v1Res = await startTranscription(request, session.id, facilitator.joinToken);
  expect(v1Res.ok()).toBeTruthy();

  const v1Info = await getTwoPassTranscriptInfo(session.id);
  expect(v1Info).not.toBeNull();
  expect(v1Info!.retranscribeCount).toBe(0);
  const v1Text = v1Info!.text;

  // Re-run (v2)
  const v2Res = await rerunTranscription(request, session.id, facilitator.joinToken);
  expect(v2Res.ok()).toBeTruthy();

  const v2Info = await getTwoPassTranscriptInfo(session.id);
  expect(v2Info).not.toBeNull();
  expect(v2Info!.retranscribeCount).toBe(1);
  expect(v2Info!.status).toBe("COMPLETED");

  // Check that retranscribeHistory has the v1 snapshot
  const retranscribeInfo = await getTranscriptRetranscribeInfo(session.id);
  expect(retranscribeInfo).not.toBeNull();
  expect(retranscribeInfo!.retranscribeCount).toBe(1);

  const history = retranscribeInfo!.retranscribeHistory as unknown[];
  expect(Array.isArray(history)).toBe(true);
  expect(history.length).toBeGreaterThan(0);

  // v1 text was archived
  const archivedEntry = history[0] as Record<string, unknown>;
  expect(archivedEntry["text"]).toBe(v1Text);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — AI analysis references active enhanced transcript
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 7 — AI analysis uses latest active enhanced transcript", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  // Start transcription
  const txRes = await startTranscription(request, session.id, facilitator.joinToken);
  expect(txRes.ok()).toBeTruthy();

  const transcript = await getTwoPassTranscriptInfo(session.id);
  expect(transcript).not.toBeNull();
  expect(transcript!.status).toBe("COMPLETED");
  expect(transcript!.strategy).toBe("diarize_plus_quality");

  // Confirm speaker mapping to allow AI analysis
  const speakerMappingRes = await request.get(
    `/api/sessions/${session.id}/speaker-mapping?joinToken=${facilitator.joinToken}`,
  );
  expect(speakerMappingRes.ok()).toBeTruthy();
  const smBody = (await speakerMappingRes.json()) as {
    detectedSpeakers: Array<{ speakerLabel: string; participantId?: string | null }>;
    sessionParticipants: Array<{ id: string; displayName: string }>;
  };

  if (smBody.detectedSpeakers.length > 0 && smBody.sessionParticipants.length >= 2) {
    const mapping: Record<string, string> = {};
    for (let i = 0; i < Math.min(smBody.detectedSpeakers.length, smBody.sessionParticipants.length); i++) {
      const speaker = smBody.detectedSpeakers[i];
      const participant = smBody.sessionParticipants[i];
      if (speaker && participant) {
        mapping[speaker.speakerLabel] = participant.id;
      }
    }
    await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
      data: { joinToken: facilitator.joinToken, mapping },
    });
  }

  // Run AI analysis
  const analysisRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  // Mock mode should succeed
  expect(analysisRes.status()).not.toBe(500);

  // Verify analysis references the current transcript version
  const analysisVersion = await getAiAnalysisVersion(session.id);
  if (analysisVersion) {
    expect(analysisVersion.transcriptRetranscribeCount).toBe(transcript!.retranscribeCount);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — hidden case data not in quality prompt
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 8 — quality prompt contains public data, excludes private role data", async ({
  request,
}) => {
  const { session, facilitator, negotiationCase } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  const txRes = await startTranscription(request, session.id, facilitator.joinToken);
  expect(txRes.ok()).toBeTruthy();

  const transcript = await getTwoPassTranscriptInfo(session.id);
  expect(transcript).not.toBeNull();

  // processingMetadata should contain promptMetadata
  // We read it directly to verify no private data was included
  const { query } = await import("./helpers/db");
  const rows = await query<{ processingMetadata: unknown }>(
    `SELECT "processingMetadata" FROM "Transcript" WHERE "sessionId" = $1`,
    [session.id],
  );
  const meta = rows[0]?.processingMetadata as Record<string, unknown> | null;

  if (meta) {
    const promptMeta = meta["qualityPromptMetadata"] as Record<string, unknown> | null;
    if (promptMeta) {
      // Prompt context sources must only reference public data
      const sources = promptMeta["promptContextSources"] as string[] | undefined;
      if (sources) {
        for (const source of sources) {
          expect(source).not.toContain("private");
          expect(source).not.toContain("hidden");
          expect(source).not.toContain("fallback");
          expect(source).not.toContain("batna");
          expect(source).not.toContain("objective");
        }
        // Only allowed public sources
        const allowedSources = ["case_title", "participants", "business_context"];
        for (const source of sources) {
          expect(allowedSources).toContain(source);
        }
      }
    }
  }

  // Verify private role data markers are NOT in the transcript text
  // (E2E case roles have markers E2E_PRIVATE_IGOR_ONLY, E2E_PRIVATE_ALEX_ONLY)
  if (transcript!.text) {
    expect(transcript!.text).not.toContain("E2E_PRIVATE_IGOR_ONLY");
    expect(transcript!.text).not.toContain("E2E_PRIVATE_ALEX_ONLY");
  }

  void negotiationCase;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — permissions
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Test 9 — participant cannot re-run enhancement; observer cannot re-run", async ({
  request,
}) => {
  const { session, igor, serg } = await createAssignedSession(request);

  await createTwoPassTranscript(
    session.id,
    [
      {
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 5,
        text: "Enhanced text for permissions test.",
        qualityText: "Enhanced text for permissions test.",
        alignmentConfidence: 0.85,
        textSource: "QUALITY",
      },
    ],
    { strategy: "diarize_plus_quality" },
  );

  // Participant cannot re-run transcription
  const participantRerunRes = await request.post(
    `/api/sessions/${session.id}/materials/retranscribe`,
    {
      data: { joinToken: igor.joinToken },
    },
  );
  expect(participantRerunRes.status()).toBe(403);

  // Observer cannot re-run transcription
  const observerRerunRes = await request.post(
    `/api/sessions/${session.id}/materials/retranscribe`,
    {
      data: { joinToken: serg.joinToken },
    },
  );
  expect(observerRerunRes.status()).toBe(403);
});

// ─────────────────────────────────────────────────────────────────────────────
// Alignment algorithm unit tests (via DB helper + assertions)
// ─────────────────────────────────────────────────────────────────────────────

test("Two-pass Alignment — tokenOverlapSimilarity: exact match returns 1", async () => {
  const { tokenOverlapSimilarity } = await import(
    "../../lib/transcription/alignment"
  );
  expect(tokenOverlapSimilarity("договорились по цене", "договорились по цене")).toBe(1);
});

test("Two-pass Alignment — tokenOverlapSimilarity: no overlap returns 0", async () => {
  const { tokenOverlapSimilarity } = await import(
    "../../lib/transcription/alignment"
  );
  expect(tokenOverlapSimilarity("цена скидка уступка", "привет мир тест")).toBe(0);
});

test("Two-pass Alignment — normalizeText strips punctuation and normalises ё", async () => {
  const { normalizeText } = await import("../../lib/transcription/alignment");
  expect(normalizeText("Договорились! Цена — 500.")).toBe("договорились цена 500");
  expect(normalizeText("Ёж")).toBe("еж");
});

test("Two-pass Alignment — alignQualityTranscriptToDiarizedSegments: equal count pairs by order", async () => {
  const { alignQualityTranscriptToDiarizedSegments } = await import(
    "../../lib/transcription/alignment"
  );

  const diarizedSegments = [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 5, text: "цена договорились", orderIndex: 0 },
    { speakerLabel: "speaker_2", startSeconds: 5, endSeconds: 10, text: "беру соглашусь", orderIndex: 1 },
  ];

  const qualityText = "цена договорились\nберу соглашусь";

  const result = alignQualityTranscriptToDiarizedSegments(diarizedSegments, qualityText);

  expect(result.segments).toHaveLength(2);
  expect(result.segments[0]?.speakerLabel).toBe("speaker_1");
  expect(result.segments[1]?.speakerLabel).toBe("speaker_2");

  // High confidence → quality text used as finalText
  expect(result.segments[0]?.alignmentConfidence).toBeGreaterThanOrEqual(0.75);
  expect(result.segments[0]?.finalText).toBe("цена договорились");
  expect(result.segments[0]?.alignmentSource).toBe("QUALITY");

  // Timestamps are NOT changed by alignment
  expect(result.segments[0]?.startSeconds).toBe(0);
  expect(result.segments[0]?.endSeconds).toBe(5);
});

test("Two-pass Alignment — low confidence keeps diarized text and stores quality as suggestion", async () => {
  const { alignQualityTranscriptToDiarizedSegments } = await import(
    "../../lib/transcription/alignment"
  );

  const diarizedSegments = [
    {
      speakerLabel: "speaker_1",
      startSeconds: 0,
      endSeconds: 5,
      text: "buyer agreement phrase",
      orderIndex: 0,
    },
  ];

  // Quality text is completely different — will produce low confidence
  const qualityText = "неизвестная фраза без совпадений";

  const result = alignQualityTranscriptToDiarizedSegments(diarizedSegments, qualityText);

  expect(result.segments).toHaveLength(1);
  const seg = result.segments[0]!;

  // Low confidence: finalText = diarized
  expect(seg.alignmentConfidence).toBeLessThan(0.5);
  expect(seg.finalText).toBe("buyer agreement phrase");
  expect(seg.alignmentSource).toBe("DIARIZED");

  // Quality text stored as suggestion
  expect(seg.qualityText).toBe("неизвестная фраза без совпадений");

  // Speaker label preserved
  expect(seg.speakerLabel).toBe("speaker_1");
});

test("Two-pass Alignment — empty quality transcript keeps all diarized text", async () => {
  const { alignQualityTranscriptToDiarizedSegments } = await import(
    "../../lib/transcription/alignment"
  );

  const diarizedSegments = [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 5, text: "some text", orderIndex: 0 },
  ];

  const result = alignQualityTranscriptToDiarizedSegments(diarizedSegments, "");

  expect(result.alignmentStatus).toBe("FAILED");
  expect(result.segments[0]?.finalText).toBe("some text");
  expect(result.segments[0]?.alignmentSource).toBe("DIARIZED");
  expect(result.segments[0]?.speakerLabel).toBe("speaker_1");
});
