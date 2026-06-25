import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  clearAiAnalysis,
  clearTranscript,
  countTranscripts,
  createAudioActivity,
  createCompletedTranscript,
  createDiarizedTranscript,
  createE2eCase,
  createE2eEvent,
  getAiAnalysis,
  getEventParticipants,
  getExternalServiceEvent,
  getExternalServiceNames,
  getRecordingBySession,
  getSession,
  getSpeakerMappingStatus,
  getTranscriptStatus,
  getTranscriptText,
  participantByName,
  updateRecordingCompleted,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

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

  const assignmentDraft = {
    facilitatorEventParticipantId: dmitry.id,
    roleAssignments: {
      [buyerRole.id]: igor.id,
      [sellerRole.id]: alex.id,
    },
    observerEventParticipantIds: [serg.id],
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };

  await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
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

test("Test 1 — Materials page shows processing dashboard after session finish", async ({
  request,
  page,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await page.goto(`/join/${igor.joinToken}`);

  await expect(
    page.getByTestId("processing-dashboard"),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("recording-section")).toBeVisible();
  await expect(page.getByTestId("transcript-section")).toBeVisible();
  await expect(page.getByTestId("ai-analysis-section")).toBeVisible();
});

test("Test 2 — Materials status API returns recording state after finish", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording).not.toBeNull();
  expect(recording?.status).toBe("COMPLETED");

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  expect(statusResponse.ok()).toBeTruthy();

  const body = (await statusResponse.json()) as {
    recording: { status: string; processingStage: string } | null;
    transcription: { status: string | null; canStart: boolean; processingStage: string };
    processing: { shouldPoll: boolean; autoTranscribeEnabled: boolean };
  };

  expect(body.recording).not.toBeNull();
  expect(body.recording?.status).toBe("COMPLETED");
  expect(body.recording?.processingStage).toBe("ready");

  expect(body.transcription.processingStage).toBe("not_started");
  expect(body.transcription.canStart).toBe(true);

  // With AUTO_TRANSCRIBE_AFTER_RECORDING=false (test default), polling stops
  // once recording is ready and no active transcription is running.
  expect(body.processing.autoTranscribeEnabled).toBe(false);
  expect(body.processing.shouldPoll).toBe(false);
});

test("Test 3 — Transcription flow via new endpoint: QUEUED → COMPLETED", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  expect(await countTranscripts(session.id)).toBe(0);

  const transcribeResponse = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    {
      data: {
        joinToken: facilitator.joinToken,
        language: "auto",
      },
    },
  );
  expect(transcribeResponse.ok()).toBeTruthy();

  const transcribeBody = (await transcribeResponse.json()) as {
    status: string;
    text: string;
  };

  expect(transcribeBody.status).toBe("COMPLETED");
  expect(transcribeBody.text).toContain("Mock transcript");

  const transcriptStatus = await getTranscriptStatus(session.id);
  expect(transcriptStatus?.status).toBe("COMPLETED");

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const statusBody = (await statusResponse.json()) as {
    transcription: { status: string; processingStage: string; text: string | null };
  };
  expect(statusBody.transcription.status).toBe("COMPLETED");
  expect(statusBody.transcription.processingStage).toBe("ready");
  expect(statusBody.transcription.text).toContain("Mock transcript");
});

test("Test 4 — Failed transcription marks status FAILED and logs ExternalServiceEvent", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await updateRecordingCompleted(session.id);

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_QUOTA_EXCEEDED" },
  });

  const transcribeResponse = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    {
      data: { joinToken: facilitator.joinToken, language: "auto" },
    },
  );
  expect(transcribeResponse.ok()).toBeFalsy();

  const transcriptStatus = await getTranscriptStatus(session.id);
  expect(transcriptStatus?.status).toBe("FAILED");
  expect(transcriptStatus?.errorMessage).toBeTruthy();

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const statusBody = (await statusResponse.json()) as {
    transcription: { status: string; canRetry: boolean; processingStage: string };
  };
  expect(statusBody.transcription.status).toBe("FAILED");
  expect(statusBody.transcription.processingStage).toBe("failed");
  expect(statusBody.transcription.canRetry).toBe(true);

  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });

  const serviceEvents = await getExternalServiceNames(session.id);
  expect(serviceEvents).toContain("OPENAI");
});

test("Test 5 — Multi-session isolation: Session 1 transcript not visible in Session 2", async ({
  request,
}) => {
  const event1 = await createAssignedSession(request);
  const event2 = await createAssignedSession(request);

  const session1Id = event1.session.id;
  const session2Id = event2.session.id;
  const facilitator1 = event1.facilitator;
  const facilitator2 = event2.facilitator;

  await control(request, session1Id, facilitator1.joinToken, "SKIP_PREPARATION");
  await control(request, session1Id, facilitator1.joinToken, "START");
  await control(request, session1Id, facilitator1.joinToken, "FINISH");

  await control(request, session2Id, facilitator2.joinToken, "SKIP_PREPARATION");
  await control(request, session2Id, facilitator2.joinToken, "START");
  await control(request, session2Id, facilitator2.joinToken, "FINISH");

  await updateRecordingCompleted(session1Id);

  const transcribeResponse1 = await request.post(
    `/api/sessions/${session1Id}/materials/transcribe`,
    {
      data: { joinToken: facilitator1.joinToken, language: "auto" },
    },
  );
  expect(transcribeResponse1.ok()).toBeTruthy();

  const transcriptText = await getTranscriptText(session1Id);
  expect(transcriptText).toContain("Mock transcript");

  expect(await countTranscripts(session2Id)).toBe(0);

  const status1 = await request.get(
    `/api/sessions/${session1Id}/materials/status?joinToken=${facilitator1.joinToken}`,
  );
  const body1 = (await status1.json()) as {
    transcription: { processingStage: string; text: string | null };
  };
  expect(body1.transcription.processingStage).toBe("ready");
  expect(body1.transcription.text).toContain("Mock transcript");

  const status2 = await request.get(
    `/api/sessions/${session2Id}/materials/status?joinToken=${facilitator2.joinToken}`,
  );
  const body2 = (await status2.json()) as {
    transcription: { processingStage: string; text: string | null };
  };
  expect(body2.transcription.processingStage).toBe("not_started");
  expect(body2.transcription.text).toBeNull();

  const wrongTokenResponse = await request.get(
    `/api/sessions/${session1Id}/materials/status?joinToken=${facilitator2.joinToken}`,
  );
  expect(wrongTokenResponse.status()).toBe(403);
});

test("Test 6 — Existing transcript preserved on failed retry", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await updateRecordingCompleted(session.id);

  const firstTranscribe = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(firstTranscribe.ok()).toBeTruthy();

  const originalText = await getTranscriptText(session.id);
  expect(originalText).toContain("Mock transcript");

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_QUOTA_EXCEEDED" },
  });

  const failedRetry = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(failedRetry.ok()).toBeFalsy();

  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });

  const textAfterFailedRetry = await getTranscriptText(session.id);
  expect(textAfterFailedRetry).toBe(originalText);
});

test("Test 7 — Recording refresh status endpoint accessible to facilitator", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const refreshResponse = await request.post(
    `/api/sessions/${session.id}/recording/refresh-status`,
    { data: { joinToken: facilitator.joinToken } },
  );
  expect(refreshResponse.ok()).toBeTruthy();
  const refreshBody = (await refreshResponse.json()) as { recording: { status: string } };
  expect(refreshBody.recording.status).toBeTruthy();

  const participantRefresh = await request.post(
    `/api/sessions/${session.id}/recording/refresh-status`,
    { data: { joinToken: igor.joinToken } },
  );
  expect(participantRefresh.status()).toBe(403);
});

test("Test 8 — Duplicate transcription prevented (409 on concurrent second call)", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  const firstTranscribe = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(firstTranscribe.ok()).toBeTruthy();

  // Second call while the first job may still be running (or COMPLETED in mock)
  // must be rejected as a duplicate — either 409 (in-progress) or the transcript
  // already completed, in which case canStart is false and the second POST would
  // start a fresh job only if the transcript was cleared first. Here the transcript
  // exists as COMPLETED (mock mode completes synchronously), so canStartTranscription
  // is false → the endpoint should return 400 (recording/transcript already complete).
  const secondTranscribe = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  // 409 = transcript in active state; 400 = recording not ready (unlikely here);
  // 200 would mean a duplicate was allowed — that must not happen.
  expect(secondTranscribe.status()).not.toBe(200);

  expect(await countTranscripts(session.id)).toBe(1);

  await clearTranscript(session.id);
  await updateRecordingCompleted(session.id);
});

test("Test 9 — External event diagnostics recorded for failed storage download", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  await request.post("/api/test/mock-external-service", {
    data: { error: "YANDEX_STORAGE_DOWNLOAD_FAILED" },
  });

  const transcribeResponse = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(transcribeResponse.ok()).toBeFalsy();

  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });

  const storageEvent = await getExternalServiceEvent(session.id, "YANDEX_OBJECT_STORAGE");
  expect(storageEvent).not.toBeNull();
  expect(storageEvent?.errorCode).toBeTruthy();
});

// ── AI Analysis Tests ──────────────────────────────────────────────────────

test("AI Test 1 — AI analysis flow: QUEUED → COMPLETED with report", async ({
  request,
  page,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createCompletedTranscript(session.id);

  const statusBefore = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const bodyBefore = (await statusBefore.json()) as {
    aiAnalysis: { canStart: boolean; processingStage: string };
  };
  expect(bodyBefore.aiAnalysis.canStart).toBe(true);
  expect(bodyBefore.aiAnalysis.processingStage).toBe("not_started");

  const analyzeResponse = await request.post(
    `/api/sessions/${session.id}/analyze`,
    { data: { joinToken: facilitator.joinToken } },
  );
  expect(analyzeResponse.ok()).toBeTruthy();
  const analyzeBody = (await analyzeResponse.json()) as {
    status: string;
    executiveSummary: string | null;
    overallScore: number | null;
  };
  expect(analyzeBody.status).toBe("COMPLETED");
  expect(analyzeBody.executiveSummary).toBeTruthy();
  expect(analyzeBody.overallScore).toBeGreaterThanOrEqual(0);

  const dbAnalysis = await getAiAnalysis(session.id);
  expect(dbAnalysis?.status).toBe("COMPLETED");
  expect(dbAnalysis?.executiveSummary).toBeTruthy();
  expect(dbAnalysis?.overallScore).toBeGreaterThanOrEqual(0);

  const statusAfter = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const bodyAfter = (await statusAfter.json()) as {
    aiAnalysis: {
      status: string;
      processingStage: string;
      executiveSummary: string | null;
      overallScore: number | null;
      analysisJson: unknown;
    };
    processing: { shouldPoll: boolean };
  };
  expect(bodyAfter.aiAnalysis.status).toBe("COMPLETED");
  expect(bodyAfter.aiAnalysis.processingStage).toBe("ready");
  expect(bodyAfter.aiAnalysis.executiveSummary).toBeTruthy();
  expect(bodyAfter.aiAnalysis.overallScore).toBeGreaterThanOrEqual(0);
  expect(bodyAfter.aiAnalysis.analysisJson).not.toBeNull();
  expect(bodyAfter.processing.shouldPoll).toBe(false);

  await page.goto(`/join/${facilitator.joinToken}`);
  await expect(page.getByTestId("ai-analysis-section")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId("ai-report")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("executive-summary")).toBeVisible();
  await expect(page.getByTestId("overall-score")).toBeVisible();
});

test("AI Test 2 — AI analysis unavailable without transcript", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const body = (await statusResponse.json()) as {
    aiAnalysis: { canStart: boolean; processingStage: string };
  };
  expect(body.aiAnalysis.canStart).toBe(false);
  expect(body.aiAnalysis.processingStage).toBe("waiting_for_transcript");

  const analyzeResponse = await request.post(
    `/api/sessions/${session.id}/analyze`,
    { data: { joinToken: facilitator.joinToken } },
  );
  expect(analyzeResponse.ok()).toBeFalsy();
  expect(analyzeResponse.status()).toBe(400);
});

test("AI Test 3 — AI analysis failure creates ExternalServiceEvent and retry available", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createCompletedTranscript(session.id);

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_AI_ANALYSIS_FAILED" },
  });

  const analyzeResponse = await request.post(
    `/api/sessions/${session.id}/analyze`,
    { data: { joinToken: facilitator.joinToken } },
  );
  expect(analyzeResponse.ok()).toBeFalsy();

  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });

  const dbAnalysis = await getAiAnalysis(session.id);
  expect(dbAnalysis?.status).toBe("FAILED");
  expect(dbAnalysis?.errorMessage).toBeTruthy();

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const statusBody = (await statusResponse.json()) as {
    aiAnalysis: {
      status: string;
      processingStage: string;
      canRetry: boolean;
      errorMessage: string | null;
    };
  };
  expect(statusBody.aiAnalysis.status).toBe("FAILED");
  expect(statusBody.aiAnalysis.processingStage).toBe("failed");
  expect(statusBody.aiAnalysis.canRetry).toBe(true);
  expect(statusBody.aiAnalysis.errorMessage).toBeTruthy();

  const serviceEvents = await getExternalServiceNames(session.id);
  expect(serviceEvents).toContain("OPENAI");

  const openaiEvent = await getExternalServiceEvent(session.id, "OPENAI");
  expect(openaiEvent).not.toBeNull();
});

test("AI Test 4 — Participant does not see facilitator-only analysis", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createCompletedTranscript(session.id);

  const analyzeResponse = await request.post(
    `/api/sessions/${session.id}/analyze`,
    { data: { joinToken: facilitator.joinToken } },
  );
  expect(analyzeResponse.ok()).toBeTruthy();

  const facilitatorStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const facilitatorBody = (await facilitatorStatus.json()) as {
    aiAnalysis: { analysisJson: unknown; canView: boolean };
    permissions: { canViewAiAnalysis: boolean };
  };
  expect(facilitatorBody.permissions.canViewAiAnalysis).toBe(true);
  expect(facilitatorBody.aiAnalysis.canView).toBe(true);
  expect(facilitatorBody.aiAnalysis.analysisJson).not.toBeNull();

  const participantStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
  );
  const participantBody = (await participantStatus.json()) as {
    aiAnalysis: {
      analysisJson: unknown;
      canView: boolean;
      participantPlaceholder: boolean;
    };
    permissions: { canViewAiAnalysis: boolean };
  };
  expect(participantBody.permissions.canViewAiAnalysis).toBe(false);
  expect(participantBody.aiAnalysis.canView).toBe(false);
  expect(participantBody.aiAnalysis.analysisJson).toBeNull();
  expect(participantBody.aiAnalysis.participantPlaceholder).toBe(true);
});

test("AI Test 5 — Multi-session isolation: Session 1 analysis not visible in Session 2", async ({
  request,
}) => {
  const event1 = await createAssignedSession(request);
  const event2 = await createAssignedSession(request);

  const session1Id = event1.session.id;
  const session2Id = event2.session.id;
  const facilitator1 = event1.facilitator;
  const facilitator2 = event2.facilitator;

  await control(request, session1Id, facilitator1.joinToken, "SKIP_PREPARATION");
  await control(request, session1Id, facilitator1.joinToken, "START");
  await control(request, session1Id, facilitator1.joinToken, "FINISH");

  await control(request, session2Id, facilitator2.joinToken, "SKIP_PREPARATION");
  await control(request, session2Id, facilitator2.joinToken, "START");
  await control(request, session2Id, facilitator2.joinToken, "FINISH");

  await createCompletedTranscript(session1Id);

  const analyzeResponse = await request.post(
    `/api/sessions/${session1Id}/analyze`,
    { data: { joinToken: facilitator1.joinToken } },
  );
  expect(analyzeResponse.ok()).toBeTruthy();

  const session1Status = await request.get(
    `/api/sessions/${session1Id}/materials/status?joinToken=${facilitator1.joinToken}`,
  );
  const body1 = (await session1Status.json()) as {
    aiAnalysis: { status: string; processingStage: string; analysisJson: unknown };
  };
  expect(body1.aiAnalysis.status).toBe("COMPLETED");
  expect(body1.aiAnalysis.processingStage).toBe("ready");
  expect(body1.aiAnalysis.analysisJson).not.toBeNull();

  const session2Status = await request.get(
    `/api/sessions/${session2Id}/materials/status?joinToken=${facilitator2.joinToken}`,
  );
  const body2 = (await session2Status.json()) as {
    aiAnalysis: { status: string; processingStage: string; analysisJson: unknown };
  };
  expect(body2.aiAnalysis.status).toBe("NOT_STARTED");
  expect(body2.aiAnalysis.processingStage).toBe("waiting_for_transcript");
  expect(body2.aiAnalysis.analysisJson).toBeNull();

  const session2Analysis = await getAiAnalysis(session2Id);
  expect(session2Analysis).toBeNull();

  await clearAiAnalysis(session1Id);
});

// ── AUTO_TRANSCRIBE_AFTER_RECORDING Tests ─────────────────────────────────

test("Test 10 — AUTO_TRANSCRIBE disabled: status API returns autoTranscribeEnabled=false and shouldPoll=false when recording ready", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  expect(statusResponse.ok()).toBeTruthy();

  const body = (await statusResponse.json()) as {
    recording: { status: string; processingStage: string } | null;
    transcription: { status: string | null; canStart: boolean; processingStage: string };
    processing: { shouldPoll: boolean; autoTranscribeEnabled: boolean };
  };

  // Recording is ready, transcription not started
  expect(body.recording?.processingStage).toBe("ready");
  expect(body.transcription.processingStage).toBe("not_started");
  expect(body.transcription.canStart).toBe(true);

  // Auto-transcribe is disabled in test env → no polling needed for the recording-ready state
  expect(body.processing.autoTranscribeEnabled).toBe(false);
  expect(body.processing.shouldPoll).toBe(false);
});

test("Test 11 — AUTO_TRANSCRIBE disabled: no transcript is created automatically after recording completes", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  // Confirm no transcript was created automatically
  expect(await countTranscripts(session.id)).toBe(0);
  expect(await getTranscriptStatus(session.id)).toBeNull();
});

test("Test 12 — Manual transcription works when AUTO_TRANSCRIBE is disabled", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  // Manually start transcription
  const transcribeResponse = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(transcribeResponse.ok()).toBeTruthy();

  const statusResult = await getTranscriptStatus(session.id);
  expect(statusResult?.status).toBe("COMPLETED");

  const text = await getTranscriptText(session.id);
  expect(text).toBeTruthy();

  // After manual transcription completes, canStart is false
  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const body = (await statusResponse.json()) as {
    transcription: { canStart: boolean; processingStage: string };
  };
  expect(body.transcription.canStart).toBe(false);
  expect(body.transcription.processingStage).toBe("ready");

  await clearTranscript(session.id);
});

test("Test 13 — Duplicate job prevention: second transcription POST rejected when first is in progress or completed", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");
  await updateRecordingCompleted(session.id);

  const first = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(first.ok()).toBeTruthy();

  // Second call must be rejected (transcript already COMPLETED in mock mode = canStart=false)
  const second = await request.post(
    `/api/sessions/${session.id}/materials/transcribe`,
    { data: { joinToken: facilitator.joinToken, language: "auto" } },
  );
  expect(second.status()).not.toBe(200);

  // Only one transcript record should exist
  expect(await countTranscripts(session.id)).toBe(1);
});

test("Test 14 — String 'false' is parsed as false: getEnvBoolean safety check via API response", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const statusResponse = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const body = (await statusResponse.json()) as {
    processing: { autoTranscribeEnabled: boolean };
  };

  // The test env explicitly sets AUTO_TRANSCRIBE_AFTER_RECORDING="false"
  // getEnvBoolean must parse the string "false" as boolean false, not truthy
  expect(body.processing.autoTranscribeEnabled).toBe(false);
});

// ── Speaker Mapping Tests ─────────────────────────────────────────────────

test("Speaker Mapping Test 1 — AI analysis blocked when speaker mapping required", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  // Transcription via mock produces hasSpeakerDiarization=true, speakerMappingStatus=REQUIRED
  await request.post(`/api/sessions/${session.id}/materials/transcribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });

  // AI analysis must be blocked
  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken },
  });
  expect(analyzeRes.status()).toBe(422);
  const analyzeBody = (await analyzeRes.json()) as { errorCode: string };
  expect(analyzeBody.errorCode).toBe("SPEAKER_MAPPING_REQUIRED");

  // Confirm mapping via speaker-mapping API
  const confirmRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: {
      joinToken: facilitator.joinToken,
      mapping: { speaker_1: facilitator.id },
      confirm: true,
      applyToTranscript: false,
    },
  });
  expect(confirmRes.ok()).toBeTruthy();
  const confirmBody = (await confirmRes.json()) as { confirmed: boolean };
  expect(confirmBody.confirmed).toBe(true);

  const mappingStatus = await getSpeakerMappingStatus(session.id);
  expect(mappingStatus?.speakerMappingStatus).toBe("CONFIRMED");

  // AI analysis must now be allowed
  const analyzeAfterConfirm = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken },
  });
  expect(analyzeAfterConfirm.ok()).toBeTruthy();

  await clearAiAnalysis(session.id);
  await clearTranscript(session.id);
});

test("Speaker Mapping Test 2 — Participant cannot edit speaker mapping", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await request.post(`/api/sessions/${session.id}/materials/transcribe`, {
    data: { joinToken: facilitator.joinToken, language: "auto" },
  });

  // Participant POST should be forbidden
  const postRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: {
      joinToken: igor.joinToken,
      mapping: { speaker_1: igor.id },
      confirm: true,
    },
  });
  expect(postRes.status()).toBe(403);

  // Participant GET returns canEdit: false
  const getRes = await request.get(
    `/api/sessions/${session.id}/speaker-mapping?joinToken=${igor.joinToken}`,
  );
  expect(getRes.ok()).toBeTruthy();
  const getBody = (await getRes.json()) as { canEdit: boolean };
  expect(getBody.canEdit).toBe(false);

  await clearTranscript(session.id);
});

test("Speaker Mapping Test 3 — Automatic mapping unavailable without audio activity", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 10, text: "Hello from speaker 1." },
    { speakerLabel: "speaker_2", startSeconds: 10, endSeconds: 20, text: "Hello from speaker 2." },
  ]);

  // No audio activity — automatic mapping should report unavailable
  const suggestRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: {
      joinToken: facilitator.joinToken,
      suggestAutomatically: true,
    },
  });
  expect(suggestRes.ok()).toBeTruthy();
  const suggestBody = (await suggestRes.json()) as {
    available: boolean;
    unavailableReason: string | null;
  };
  expect(suggestBody.available).toBe(false);
  expect(suggestBody.unavailableReason).toBe("no_audio_activity");

  await clearTranscript(session.id);
});

test("Speaker Mapping Test 4 — Automatic mapping suggestion with mock audio activity", async ({
  request,
}) => {
  const { session, facilitator, igor, alex } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await control(request, session.id, facilitator.joinToken, "START");
  await control(request, session.id, facilitator.joinToken, "FINISH");

  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 10, text: "Hello from speaker 1." },
    { speakerLabel: "speaker_2", startSeconds: 10, endSeconds: 20, text: "Hello from speaker 2." },
  ]);

  // Seed audio activity matching segments
  await createAudioActivity(session.id, igor.id, 0, 10);
  await createAudioActivity(session.id, alex.id, 10, 20);

  const suggestRes = await request.post(`/api/sessions/${session.id}/speaker-mapping`, {
    data: {
      joinToken: facilitator.joinToken,
      suggestAutomatically: true,
    },
  });
  expect(suggestRes.ok()).toBeTruthy();
  const suggestBody = (await suggestRes.json()) as {
    available: boolean;
    suggestedMapping: Record<string, string>;
    confidence: Record<string, number>;
  };
  expect(suggestBody.available).toBe(true);
  expect(suggestBody.suggestedMapping["speaker_1"]).toBe(igor.id);
  expect(suggestBody.suggestedMapping["speaker_2"]).toBe(alex.id);
  expect(suggestBody.confidence["speaker_1"]).toBeGreaterThanOrEqual(0.6);
  expect(suggestBody.confidence["speaker_2"]).toBeGreaterThanOrEqual(0.6);

  await clearTranscript(session.id);
});

test("Speaker Mapping Test 5 — Multi-session isolation: mapping from Session 1 does not affect Session 2", async ({
  request,
}) => {
  const sess1 = await createAssignedSession(request);
  const sess2 = await createAssignedSession(request);

  for (const { session, facilitator } of [sess1, sess2]) {
    await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
    await control(request, session.id, facilitator.joinToken, "START");
    await control(request, session.id, facilitator.joinToken, "FINISH");
  }

  // Transcribe and confirm mapping only in session 1
  await request.post(`/api/sessions/${sess1.session.id}/materials/transcribe`, {
    data: { joinToken: sess1.facilitator.joinToken, language: "auto" },
  });
  await request.post(`/api/sessions/${sess1.session.id}/speaker-mapping`, {
    data: {
      joinToken: sess1.facilitator.joinToken,
      mapping: { speaker_1: sess1.facilitator.id },
      confirm: true,
      applyToTranscript: false,
    },
  });

  const status1 = await getSpeakerMappingStatus(sess1.session.id);
  expect(status1?.speakerMappingStatus).toBe("CONFIRMED");

  // Session 2 should have no transcript / mapping
  const status2 = await getSpeakerMappingStatus(sess2.session.id);
  expect(status2).toBeNull();

  await clearTranscript(sess1.session.id);
});
