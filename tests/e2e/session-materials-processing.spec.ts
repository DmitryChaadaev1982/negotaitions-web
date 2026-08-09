import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  clearAiAnalysis,
  clearTranscript,
  countTranscripts,
  createAudioActivity,
  createRoomConnectionForParticipant,
  createCompletedTranscript,
  createDiarizedTranscript,
  createE2eCase,
  createE2eEvent,
  createUserSessionCookie,
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
  upsertRecordingForSession,
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
  if (!dmitry.userId) {
    throw new Error("Assigned E2E session requires Dmitry to be account-bound as event host.");
  }

  const hostAuthCookie = await createUserSessionCookie(dmitry.userId);

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

  const patchResponse = await request.patch(`/api/events/${event.id}/host`, {
    headers: { Cookie: hostAuthCookie },
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft,
    },
  });
  if (!patchResponse.ok()) {
    throw new Error(
      `Failed to configure assigned E2E session (${patchResponse.status()}): ${await patchResponse.text()}`,
    );
  }

  const createResponse = await request.post(`/api/events/${event.id}/host`, {
    headers: { Cookie: hostAuthCookie },
    data: { hostToken: event.hostToken },
  });
  if (!createResponse.ok()) {
    throw new Error(
      `Failed to create assigned E2E session (${createResponse.status()}): ${await createResponse.text()}`,
    );
  }
  const body = (await createResponse.json()) as { session: { id: string } };

  const session = await getSession(body.session.id);
  await upsertRecordingForSession({
    sessionId: session.id,
    status: "NOT_STARTED",
    provider: "LIVEKIT_CLOUD",
  });

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
  participant: { id: string; userId: string | null },
  action: string,
) {
  if (!participant.userId) {
    throw new Error(`Session control ${action} requires an account-bound participant.`);
  }
  const authCookie = await createUserSessionCookie(participant.userId);
  const response = await request.post(`/api/sessions/${sessionId}/control`, {
    headers: { Cookie: authCookie },
    data: { participantId: participant.id, action },
  });
  if (!response.ok()) {
    throw new Error(
      `Session control ${action} failed (${response.status()}): ${await response.text()}`,
    );
  }
  return response.json();
}

type AccountBoundParticipant = {
  id: string;
  userId: string | null;
  joinToken?: string;
  type?: string;
};

async function authCookieFor(participant: AccountBoundParticipant) {
  if (!participant.userId) {
    throw new Error("Authenticated room API request requires an account-bound participant.");
  }
  return createUserSessionCookie(participant.userId);
}

async function roomApiGet(
  request: APIRequestContext,
  url: string,
  participant: AccountBoundParticipant,
) {
  return request.get(url, {
    headers: { Cookie: await authCookieFor(participant) },
  });
}

async function roomApiPost(
  request: APIRequestContext,
  url: string,
  participant: AccountBoundParticipant,
  data: Record<string, unknown> = {},
) {
  return request.post(url, {
    headers: { Cookie: await authCookieFor(participant) },
    data: { participantId: participant.id, ...data },
  });
}

async function roomApiPostWithJoinToken(
  request: APIRequestContext,
  url: string,
  participant: AccountBoundParticipant,
  data: Record<string, unknown> = {},
) {
  if (!participant.joinToken) {
    throw new Error("Join-token API request requires a participant join token.");
  }
  return request.post(url, {
    headers: { Cookie: await authCookieFor(participant) },
    data: { joinToken: participant.joinToken, ...data },
  });
}

function materialsStatusUrl(sessionId: string, participant: AccountBoundParticipant) {
  return `/api/sessions/${sessionId}/materials/status?participantId=${participant.id}`;
}

function speakerMappingUrl(sessionId: string, participant: AccountBoundParticipant) {
  return `/api/sessions/${sessionId}/speaker-mapping?participantId=${participant.id}`;
}

function expectMockTranscriptText(text: string | null) {
  expect(text).toContain("Mock speaker 1");
}

async function seedSpeakerMappingCandidates(
  sessionId: string,
  participants: AccountBoundParticipant[],
) {
  for (const participant of participants) {
    if (!participant.userId || !participant.type) {
      throw new Error("Speaker mapping candidate requires account-bound participant with type.");
    }
    await createRoomConnectionForParticipant({
      sessionId,
      userId: participant.userId,
      role: participant.type,
    });
  }
}

async function authenticatePageAs(page: Page, participant: { userId: string | null }) {
  if (!participant.userId) {
    throw new Error("Browser join flow requires an account-bound participant.");
  }
  const authCookie = await createUserSessionCookie(participant.userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: authCookie.replace("auth_session=", ""),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
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
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await authenticatePageAs(page, facilitator);
  await page.goto(`/join/${facilitator.joinToken}`);

  await expect(page.getByTestId("account-materials-page")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId("account-recording-section")).toBeVisible();
  await expect(page.getByTestId("account-transcript-section")).toBeVisible();
  await expect(page.getByTestId("account-ai-analysis-section")).toBeVisible();
  await expect(page.getByTestId("session-post-processing-panel")).toBeVisible();
});

test("Test 2 — Materials status API returns recording state after finish", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording).not.toBeNull();
  expect(recording?.status).toBe("COMPLETED");

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  expect(await countTranscripts(session.id)).toBe(0);

  const transcribeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(transcribeResponse.ok()).toBeTruthy();

  const transcribeBody = (await transcribeResponse.json()) as {
    status: string;
    text: string;
  };

  expect(transcribeBody.status).toBe("COMPLETED");
  expectMockTranscriptText(transcribeBody.text);

  const transcriptStatus = await getTranscriptStatus(session.id);
  expect(transcriptStatus?.status).toBe("COMPLETED");

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  const statusBody = (await statusResponse.json()) as {
    transcription: { status: string; processingStage: string; text: string | null };
  };
  expect(statusBody.transcription.status).toBe("COMPLETED");
  expect(statusBody.transcription.processingStage).toBe("ready");
  expectMockTranscriptText(statusBody.transcription.text);
});

test("Test 4 — Failed transcription marks status FAILED and logs ExternalServiceEvent", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await updateRecordingCompleted(session.id);

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_QUOTA_EXCEEDED" },
  });

  const transcribeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(transcribeResponse.ok()).toBeFalsy();

  const transcriptStatus = await getTranscriptStatus(session.id);
  expect(transcriptStatus?.status).toBe("FAILED");
  expect(transcriptStatus?.errorMessage).toBeTruthy();

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
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

  await control(request, session1Id, facilitator1, "SKIP_PREPARATION");
  await control(request, session1Id, facilitator1, "START");
  await control(request, session1Id, facilitator1, "FINISH");

  await control(request, session2Id, facilitator2, "SKIP_PREPARATION");
  await control(request, session2Id, facilitator2, "START");
  await control(request, session2Id, facilitator2, "FINISH");

  await updateRecordingCompleted(session1Id);

  const transcribeResponse1 = await roomApiPost(
    request,
    `/api/sessions/${session1Id}/materials/transcribe`,
    facilitator1,
    { language: "auto" },
  );
  expect(transcribeResponse1.ok()).toBeTruthy();

  const transcriptText = await getTranscriptText(session1Id);
  expectMockTranscriptText(transcriptText);

  expect(await countTranscripts(session2Id)).toBe(0);

  const status1 = await roomApiGet(
    request,
    materialsStatusUrl(session1Id, facilitator1),
    facilitator1,
  );
  const body1 = (await status1.json()) as {
    transcription: { processingStage: string; text: string | null };
  };
  expect(body1.transcription.processingStage).toBe("ready");
  expectMockTranscriptText(body1.transcription.text);

  const status2 = await roomApiGet(
    request,
    materialsStatusUrl(session2Id, facilitator2),
    facilitator2,
  );
  const body2 = (await status2.json()) as {
    transcription: { processingStage: string; text: string | null };
  };
  expect(body2.transcription.processingStage).toBe("not_started");
  expect(body2.transcription.text).toBeNull();

  const wrongTokenResponse = await roomApiGet(
    request,
    materialsStatusUrl(session1Id, facilitator2),
    facilitator2,
  );
  expect(wrongTokenResponse.status()).toBe(403);
});

test("Test 6 — Existing transcript preserved on failed retry", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await updateRecordingCompleted(session.id);

  const firstTranscribe = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(firstTranscribe.ok()).toBeTruthy();

  const originalText = await getTranscriptText(session.id);
  expectMockTranscriptText(originalText);

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_QUOTA_EXCEEDED" },
  });

  const failedRetry = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const refreshResponse = await roomApiPostWithJoinToken(
    request,
    `/api/sessions/${session.id}/recording/refresh-status`,
    facilitator,
  );
  expect(refreshResponse.ok()).toBeTruthy();
  const refreshBody = (await refreshResponse.json()) as { recording: { status: string } };
  expect(refreshBody.recording.status).toBeTruthy();

  const participantRefresh = await roomApiPostWithJoinToken(
    request,
    `/api/sessions/${session.id}/recording/refresh-status`,
    igor,
  );
  expect(participantRefresh.status()).toBe(403);
});

test("Test 8 — Duplicate transcription prevented (409 on concurrent second call)", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");
  await updateRecordingCompleted(session.id);

  const firstTranscribe = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(firstTranscribe.ok()).toBeTruthy();

  // Second call while the first job may still be running (or COMPLETED in mock)
  // must be rejected as a duplicate — either 409 (in-progress) or the transcript
  // already completed, in which case canStart is false and the second POST would
  // start a fresh job only if the transcript was cleared first. Here the transcript
  // exists as COMPLETED (mock mode completes synchronously), so canStartTranscription
  // is false → the endpoint should return 400 (recording/transcript already complete).
  const secondTranscribe = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");
  await updateRecordingCompleted(session.id);

  await request.post("/api/test/mock-external-service", {
    data: { error: "YANDEX_STORAGE_DOWNLOAD_FAILED" },
  });

  const transcribeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await createCompletedTranscript(session.id);

  const statusBefore = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  const bodyBefore = (await statusBefore.json()) as {
    aiAnalysis: { canStart: boolean; processingStage: string };
  };
  expect(bodyBefore.aiAnalysis.canStart).toBe(true);
  expect(bodyBefore.aiAnalysis.processingStage).toBe("not_started");

  const analyzeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/analyze`,
    facilitator,
    { aiProcessingConfirmed: true },
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

  const statusAfter = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
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

  await authenticatePageAs(page, facilitator);
  await page.goto(`/join/${facilitator.joinToken}`);
  await expect(page.getByTestId("account-ai-analysis-section")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId("session-post-processing-panel")).toBeVisible();
  await expect(page.getByTestId("ai-report")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("executive-summary")).toBeVisible();
  await expect(page.getByTestId("overall-score")).toBeVisible();
});

test("AI Test 2 — AI analysis unavailable without transcript", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  const body = (await statusResponse.json()) as {
    aiAnalysis: { canStart: boolean; processingStage: string };
  };
  expect(body.aiAnalysis.canStart).toBe(false);
  expect(body.aiAnalysis.processingStage).toBe("waiting_for_transcript");

  const analyzeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/analyze`,
    facilitator,
    { aiProcessingConfirmed: true },
  );
  expect(analyzeResponse.ok()).toBeFalsy();
  expect(analyzeResponse.status()).toBe(400);
});

test("AI Test 3 — AI analysis failure creates ExternalServiceEvent and retry available", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await createCompletedTranscript(session.id);

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_AI_ANALYSIS_FAILED" },
  });

  const analyzeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/analyze`,
    facilitator,
    { aiProcessingConfirmed: true },
  );
  expect(analyzeResponse.ok()).toBeFalsy();

  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });

  const dbAnalysis = await getAiAnalysis(session.id);
  expect(dbAnalysis?.status).toBe("FAILED");
  expect(dbAnalysis?.errorMessage).toBeTruthy();

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await createCompletedTranscript(session.id);

  const analyzeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/analyze`,
    facilitator,
    { aiProcessingConfirmed: true },
  );
  expect(analyzeResponse.ok()).toBeTruthy();

  const facilitatorStatus = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  const facilitatorBody = (await facilitatorStatus.json()) as {
    aiAnalysis: { analysisJson: unknown; canView: boolean };
    permissions: { canViewAiAnalysis: boolean };
  };
  expect(facilitatorBody.permissions.canViewAiAnalysis).toBe(true);
  expect(facilitatorBody.aiAnalysis.canView).toBe(true);
  expect(facilitatorBody.aiAnalysis.analysisJson).not.toBeNull();

  const participantStatus = await roomApiGet(
    request,
    materialsStatusUrl(session.id, igor),
    igor,
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

  await control(request, session1Id, facilitator1, "SKIP_PREPARATION");
  await control(request, session1Id, facilitator1, "START");
  await control(request, session1Id, facilitator1, "FINISH");

  await control(request, session2Id, facilitator2, "SKIP_PREPARATION");
  await control(request, session2Id, facilitator2, "START");
  await control(request, session2Id, facilitator2, "FINISH");

  await createCompletedTranscript(session1Id);

  const analyzeResponse = await roomApiPost(
    request,
    `/api/sessions/${session1Id}/analyze`,
    facilitator1,
    { aiProcessingConfirmed: true },
  );
  expect(analyzeResponse.ok()).toBeTruthy();

  const session1Status = await roomApiGet(
    request,
    materialsStatusUrl(session1Id, facilitator1),
    facilitator1,
  );
  const body1 = (await session1Status.json()) as {
    aiAnalysis: { status: string; processingStage: string; analysisJson: unknown };
  };
  expect(body1.aiAnalysis.status).toBe("COMPLETED");
  expect(body1.aiAnalysis.processingStage).toBe("ready");
  expect(body1.aiAnalysis.analysisJson).not.toBeNull();

  const session2Status = await roomApiGet(
    request,
    materialsStatusUrl(session2Id, facilitator2),
    facilitator2,
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const recording = await getRecordingBySession(session.id);
  expect(recording?.status).toBe("COMPLETED");

  // Manually start transcription
  const transcribeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(transcribeResponse.ok()).toBeTruthy();

  const statusResult = await getTranscriptStatus(session.id);
  expect(statusResult?.status).toBe("COMPLETED");

  const text = await getTranscriptText(session.id);
  expect(text).toBeTruthy();

  // After manual transcription completes, canStart is false
  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
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

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");
  await updateRecordingCompleted(session.id);

  const first = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(first.ok()).toBeTruthy();

  // Second call must be rejected (transcript already COMPLETED in mock mode = canStart=false)
  const second = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(second.status()).not.toBe(200);

  // Only one transcript record should exist
  expect(await countTranscripts(session.id)).toBe(1);
});

test("Test 14 — String 'false' is parsed as false: getEnvBoolean safety check via API response", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  const body = (await statusResponse.json()) as {
    processing: { autoTranscribeEnabled: boolean };
  };

  // The test env explicitly sets AUTO_TRANSCRIBE_AFTER_RECORDING="false"
  // getEnvBoolean must parse the string "false" as boolean false, not truthy
  expect(body.processing.autoTranscribeEnabled).toBe(false);
});

test("Test 15 — Transcription metadata includes preprocessing decision fields", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);
  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  const transcribeResponse = await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  expect(transcribeResponse.ok()).toBeTruthy();

  const statusResponse = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  expect(statusResponse.ok()).toBeTruthy();
  const statusBody = (await statusResponse.json()) as {
    transcription: {
      processingMetadata: Record<string, unknown> | null;
    };
  };

  const metadata = statusBody.transcription.processingMetadata ?? {};
  expect(typeof metadata.audioTranscriptionMaxFileMb).toBe("number");
  expect(typeof metadata.thresholdBytes).toBe("number");
  expect(typeof metadata.originalSizeBytes).toBe("number");
  expect(typeof metadata.transcriptionInputSizeBytes).toBe("number");
  expect(typeof metadata.preprocessingSkipped).toBe("boolean");
  expect(typeof metadata.selectedInputForSpeechKit).toBe("string");
});

// ── Speaker Mapping Tests ─────────────────────────────────────────────────

test("Speaker Mapping Test 1 — AI analysis blocked when speaker mapping required", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  // Transcription via mock produces hasSpeakerDiarization=true, speakerMappingStatus=REQUIRED
  await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  await seedSpeakerMappingCandidates(session.id, [facilitator, igor]);

  // AI analysis must be blocked
  const analyzeRes = await roomApiPost(
    request,
    `/api/sessions/${session.id}/analyze`,
    facilitator,
    { aiProcessingConfirmed: true },
  );
  expect(analyzeRes.status()).toBe(422);
  const analyzeBody = (await analyzeRes.json()) as { errorCode: string };
  expect(analyzeBody.errorCode).toBe("SPEAKER_MAPPING_REQUIRED");

  // Confirm mapping via speaker-mapping API
  const confirmRes = await roomApiPost(
    request,
    `/api/sessions/${session.id}/speaker-mapping`,
    facilitator,
    {
      mapping: { speaker_1: facilitator.id, speaker_2: igor.id },
      confirm: true,
      applyToTranscript: false,
    },
  );
  expect(confirmRes.ok()).toBeTruthy();
  const confirmBody = (await confirmRes.json()) as { confirmed: boolean };
  expect(confirmBody.confirmed).toBe(true);

  const mappingStatus = await getSpeakerMappingStatus(session.id);
  expect(mappingStatus?.speakerMappingStatus).toBe("CONFIRMED");

  // AI analysis must now be allowed
  const analyzeAfterConfirm = await roomApiPost(
    request,
    `/api/sessions/${session.id}/analyze`,
    facilitator,
    { aiProcessingConfirmed: true },
  );
  expect(analyzeAfterConfirm.ok()).toBeTruthy();

  await clearAiAnalysis(session.id);
  await clearTranscript(session.id);
});

test("Speaker Mapping Test 2 — Participant cannot edit speaker mapping", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await roomApiPost(
    request,
    `/api/sessions/${session.id}/materials/transcribe`,
    facilitator,
    { language: "auto" },
  );
  await seedSpeakerMappingCandidates(session.id, [facilitator, igor]);

  // Participant POST should be forbidden
  const postRes = await roomApiPost(
    request,
    `/api/sessions/${session.id}/speaker-mapping`,
    igor,
    {
      mapping: { speaker_1: igor.id },
      confirm: true,
    },
  );
  expect(postRes.status()).toBe(403);

  // Participant GET returns canEdit: false
  const getRes = await roomApiGet(
    request,
    speakerMappingUrl(session.id, igor),
    igor,
  );
  expect(getRes.ok()).toBeTruthy();
  const getBody = (await getRes.json()) as { canEdit: boolean };
  expect(getBody.canEdit).toBe(false);

  await clearTranscript(session.id);
});

test("Speaker Mapping Test 3 — Automatic mapping unavailable without audio activity", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 10, text: "Hello from speaker 1." },
    { speakerLabel: "speaker_2", startSeconds: 10, endSeconds: 20, text: "Hello from speaker 2." },
  ]);
  await seedSpeakerMappingCandidates(session.id, [facilitator, igor]);

  // No audio activity — automatic mapping should report unavailable
  const suggestRes = await roomApiPost(
    request,
    `/api/sessions/${session.id}/speaker-mapping`,
    facilitator,
    { suggestAutomatically: true },
  );
  expect(suggestRes.ok()).toBeTruthy();
  const suggestBody = (await suggestRes.json()) as {
    available: boolean;
    unavailableReason: string | null;
  };
  expect(suggestBody.available).toBe(false);
  expect(suggestBody.unavailableReason).toBe("no_audio_activity");

  const statusRes = await roomApiGet(
    request,
    materialsStatusUrl(session.id, facilitator),
    facilitator,
  );
  expect(statusRes.ok()).toBeTruthy();
  const statusBody = (await statusRes.json()) as {
    transcription: {
      mappingFailureReason: string | null;
      mappingFailureI18nKey: string | null;
      mappingFailureCompactI18nKey: string | null;
    };
  };
  expect(statusBody.transcription.mappingFailureReason).toBe("unavailable:no_audio_activity");
  expect(statusBody.transcription.mappingFailureI18nKey).toBe(
    "recording.mappingFailureReason.unavailableNoAudioActivity",
  );
  expect(statusBody.transcription.mappingFailureCompactI18nKey).toBe(
    "recording.mappingFailureCompact.noAudioActivity",
  );

  await clearTranscript(session.id);
});

test("Speaker Mapping Test 4 — Automatic mapping suggestion with mock audio activity", async ({
  request,
}) => {
  const { session, facilitator, igor, alex } = await createAssignedSession(request);

  await control(request, session.id, facilitator, "SKIP_PREPARATION");
  await control(request, session.id, facilitator, "START");
  await control(request, session.id, facilitator, "FINISH");

  await createDiarizedTranscript(session.id, [
    { speakerLabel: "speaker_1", startSeconds: 0, endSeconds: 10, text: "Hello from speaker 1." },
    { speakerLabel: "speaker_2", startSeconds: 10, endSeconds: 20, text: "Hello from speaker 2." },
  ]);
  await seedSpeakerMappingCandidates(session.id, [igor, alex]);

  // Seed audio activity matching segments
  await createAudioActivity(session.id, igor.id, 0, 5, "VOX_REMOTE_STREAM_ACTIVITY");
  await createAudioActivity(session.id, igor.id, 5, 10, "VOX_REMOTE_STREAM_ACTIVITY");
  await createAudioActivity(session.id, alex.id, 10, 15, "VOX_REMOTE_STREAM_ACTIVITY");
  await createAudioActivity(session.id, alex.id, 15, 20, "VOX_REMOTE_STREAM_ACTIVITY");

  const suggestRes = await roomApiPost(
    request,
    `/api/sessions/${session.id}/speaker-mapping`,
    facilitator,
    { suggestAutomatically: true },
  );
  expect(suggestRes.ok()).toBeTruthy();
  const suggestBody = (await suggestRes.json()) as {
    available: boolean;
    suggestedMapping: Record<string, string>;
    confidence: Record<string, number>;
  };
  expect(suggestBody.available, JSON.stringify(suggestBody)).toBe(true);
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
    await control(request, session.id, facilitator, "SKIP_PREPARATION");
    await control(request, session.id, facilitator, "START");
    await control(request, session.id, facilitator, "FINISH");
  }

  // Transcribe and confirm mapping only in session 1
  await roomApiPost(
    request,
    `/api/sessions/${sess1.session.id}/materials/transcribe`,
    sess1.facilitator,
    { language: "auto" },
  );
  await seedSpeakerMappingCandidates(sess1.session.id, [
    sess1.facilitator,
    sess1.igor,
  ]);
  await roomApiPost(
    request,
    `/api/sessions/${sess1.session.id}/speaker-mapping`,
    sess1.facilitator,
    {
      mapping: { speaker_1: sess1.facilitator.id, speaker_2: sess1.igor.id },
      confirm: true,
      applyToTranscript: false,
    },
  );

  const status1 = await getSpeakerMappingStatus(sess1.session.id);
  expect(status1?.speakerMappingStatus).toBe("CONFIRMED");

  // Session 2 should have no transcript / mapping
  const status2 = await getSpeakerMappingStatus(sess2.session.id);
  expect(status2).toBeNull();

  await clearTranscript(sess1.session.id);
});
