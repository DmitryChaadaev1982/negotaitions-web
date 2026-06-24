/**
 * E2E tests for the post-session debrief workflow and AI analysis sharing.
 *
 * Tests:
 * 1. Stay in room after finish (debrief panel visible, controls disabled)
 * 2. Run AI analysis from Sessions page
 * 3. Share AI analysis with participants
 * 4. Shared analysis is visible to participants in debrief room
 * 5. Multi-session sharing isolation
 * 6. Observer privacy: shared report does not expose private briefings
 */

import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  clearAiAnalysis,
  createCompletedTranscript,
  createE2eEvent,
  createE2eCase,
  getAiAnalysis,
  getEventParticipants,
  getSession,
  participantByName,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function createAndAssignSession(request: APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;
  if (!buyerRole || !sellerRole) throw new Error("E2E case roles missing");

  await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        facilitatorEventParticipantId: dmitry.id,
        roleAssignments: { [buyerRole.id]: igor.id, [sellerRole.id]: alex.id },
        observerEventParticipantIds: [serg.id],
        preparationDurationMinutes: 1,
        negotiationDurationMinutes: 2,
      },
    },
  });

  const createRes = await request.post(`/api/events/${event.id}/host`, {
    data: { hostToken: event.hostToken },
  });
  expect(createRes.ok()).toBeTruthy();
  const { session: { id: sessionId } } = (await createRes.json()) as { session: { id: string } };

  const session = await getSession(sessionId);
  return {
    event,
    session,
    facilitator: participantByName(session.participants, "Dmitry"),
    igor: participantByName(session.participants, "Igor"),
    alex: participantByName(session.participants, "Alex"),
    serg: participantByName(session.participants, "Serg"),
  };
}

async function finishSession(
  request: APIRequestContext,
  sessionId: string,
  facilitatorToken: string,
) {
  const res = await request.post(`/api/sessions/${sessionId}/control`, {
    data: { joinToken: facilitatorToken, action: "FINISH" },
  });
  expect(res.ok()).toBeTruthy();
}

// ── Test 1: Stay in room after finish ─────────────────────────────────────

test("debrief: user stays in session room after session finish", async ({
  page,
  request,
}) => {
  const { session, facilitator } = await createAndAssignSession(request);

  // Finish the session directly via API (no need to actually start it for UI test)
  await finishSession(request, session.id, facilitator.joinToken);

  // Navigate to the room
  await page.goto(`/room/${session.id}?joinToken=${facilitator.joinToken}`);

  // The session-room-page should still be visible (not redirected away)
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });

  // Debrief panel should appear in the sidebar
  await expect(page.getByTestId("debrief-panel")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("debrief-title")).toBeVisible();
  await expect(page.getByTestId("debrief-message")).toBeVisible();

  // Debrief mode badge in header
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible();

  // Facilitator controls are gone (FINISH is done, session closed)
  await expect(page.getByTestId("facilitator-start-button")).not.toBeVisible();

  // Key actions visible in debrief panel
  await expect(page.getByTestId("debrief-open-materials-button")).toBeVisible();
});

// ── Test 2: Run AI analysis from Sessions page ────────────────────────────

test("sessions page: facilitator can run AI analysis when transcript is ready", async ({
  page,
  request,
}) => {
  const { session, facilitator } = await createAndAssignSession(request);
  await finishSession(request, session.id, facilitator.joinToken);

  // Seed a completed transcript
  await createCompletedTranscript(session.id);

  // Open sessions page
  await page.goto("/sessions");
  await expect(page.getByText(session.title)).toBeVisible({ timeout: 10000 });

  // Run AI analysis button should appear for this finished session
  const runBtn = page.getByTestId("sessions-run-ai-analysis-button").first();
  await expect(runBtn).toBeVisible({ timeout: 5000 });
  await runBtn.click();

  // Wait for AI analysis to be created
  await expect(async () => {
    const analysis = await getAiAnalysis(session.id);
    expect(analysis).not.toBeNull();
  }).toPass({ timeout: 15000 });

  // After action, the page reloads; wait for AI status to show
  await page.waitForLoadState("domcontentloaded");

  // Clean up
  await clearAiAnalysis(session.id);
});

// ── Test 3: Share AI analysis ─────────────────────────────────────────────

test("materials: facilitator can share AI analysis with participants", async ({
  page,
  request,
}) => {
  const { session, facilitator, igor } = await createAndAssignSession(request);
  await finishSession(request, session.id, facilitator.joinToken);
  await createCompletedTranscript(session.id);

  // Run AI analysis via API
  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken },
  });
  expect(analyzeRes.ok()).toBeTruthy();

  // Verify analysis completed
  await expect(async () => {
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Open Session Materials as facilitator
  await page.goto(`/join/${facilitator.joinToken}`);
  await expect(page.getByTestId("ai-analysis-section")).toBeVisible({ timeout: 10000 });

  // Share button should be visible
  const shareBtn = page.getByTestId("share-ai-analysis-button");
  await expect(shareBtn).toBeVisible({ timeout: 5000 });
  await shareBtn.click();

  // Shared indicator appears
  await expect(page.getByTestId("analysis-shared-indicator")).toBeVisible({ timeout: 5000 });

  // Now open as participant — shared analysis should be visible
  await page.goto(`/join/${igor.joinToken}`);
  await expect(page.getByTestId("ai-analysis-section")).toBeVisible({ timeout: 10000 });

  // Participant should NOT see facilitator-only badge
  await expect(page.getByTestId("ai-report-facilitator-badge")).not.toBeVisible();

  // Participant should NOT see private role objective analysis
  // (the shared report has roleObjectivesAnalysis stripped)
  // The shared report badge should be visible if analysis is shown
  // Check the not-shared message is gone
  await expect(page.getByTestId("ai-analysis-not-shared-message")).not.toBeVisible();

  // Clean up
  await clearAiAnalysis(session.id);
});

// ── Test 4: Participant cannot see full AI report before sharing ───────────

test("materials: participant cannot see AI report before facilitator shares it", async ({
  page,
  request,
}) => {
  const { session, facilitator, igor } = await createAndAssignSession(request);
  await finishSession(request, session.id, facilitator.joinToken);
  await createCompletedTranscript(session.id);

  // Run AI analysis (stays facilitator-only by default)
  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken },
  });
  expect(analyzeRes.ok()).toBeTruthy();

  await expect(async () => {
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Open as participant
  await page.goto(`/join/${igor.joinToken}`);
  await expect(page.getByTestId("ai-analysis-section")).toBeVisible({ timeout: 10000 });

  // Should show "not shared yet" message
  await expect(page.getByTestId("ai-analysis-not-shared-message")).toBeVisible({ timeout: 5000 });

  // Should NOT show the AI report
  await expect(page.getByTestId("ai-report")).not.toBeVisible();

  // Clean up
  await clearAiAnalysis(session.id);
});

// ── Test 5: Multi-session sharing isolation ────────────────────────────────

test("multi-session: sharing analysis in session 1 does not affect session 2", async ({
  request,
}) => {
  // Create two sessions
  const setup1 = await createAndAssignSession(request);
  const setup2 = await createAndAssignSession(request);

  await finishSession(request, setup1.session.id, setup1.facilitator.joinToken);
  await finishSession(request, setup2.session.id, setup2.facilitator.joinToken);

  await createCompletedTranscript(setup1.session.id);
  await createCompletedTranscript(setup2.session.id);

  // Run AI for session 1 only
  const analyzeRes = await request.post(`/api/sessions/${setup1.session.id}/analyze`, {
    data: { joinToken: setup1.facilitator.joinToken },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const a = await getAiAnalysis(setup1.session.id);
    expect(a?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Share session 1 analysis
  const shareRes = await request.post(
    `/api/sessions/${setup1.session.id}/ai-analysis/share`,
    { data: { joinToken: setup1.facilitator.joinToken } },
  );
  expect(shareRes.ok()).toBeTruthy();

  // Session 2 AI analysis: should NOT be shared
  const session2Status = await request.get(
    `/api/sessions/${setup2.session.id}/materials/status?joinToken=${setup2.igor.joinToken}`,
  );
  expect(session2Status.ok()).toBeTruthy();
  const status2 = (await session2Status.json()) as {
    aiAnalysis: { isSharedWithSession: boolean; participantPlaceholder: boolean };
  };
  expect(status2.aiAnalysis.isSharedWithSession).toBe(false);

  // Clean up
  await clearAiAnalysis(setup1.session.id);
  await clearAiAnalysis(setup2.session.id);
});

// ── Test 6: Observer privacy ─────────────────────────────────────────────

test("observer: shared report does not expose private participant instructions", async ({
  page,
  request,
}) => {
  const { session, facilitator, serg } = await createAndAssignSession(request);
  await finishSession(request, session.id, facilitator.joinToken);
  await createCompletedTranscript(session.id);

  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const a = await getAiAnalysis(session.id);
    expect(a?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Share the analysis
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    data: { joinToken: facilitator.joinToken },
  });

  // Open as observer
  await page.goto(`/join/${serg.joinToken}`);
  await expect(page.getByTestId("ai-analysis-section")).toBeVisible({ timeout: 10000 });

  // Observer should not see private role markers
  const pageContent = await page.content();
  expect(pageContent).not.toContain("E2E_PRIVATE_IGOR_ONLY");
  expect(pageContent).not.toContain("E2E_PRIVATE_ALEX_ONLY");
  expect(pageContent).not.toContain("Buyer fallback");
  expect(pageContent).not.toContain("Seller fallback");

  // Clean up
  await clearAiAnalysis(session.id);
});

// ── Test 7: Materials status API returns safe data to participants ─────────

test("materials/status API: returns safe shared data to participants, not full analysis", async ({
  request,
}) => {
  const { session, facilitator, igor } = await createAndAssignSession(request);
  await finishSession(request, session.id, facilitator.joinToken);
  await createCompletedTranscript(session.id);

  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    data: { joinToken: facilitator.joinToken },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const a = await getAiAnalysis(session.id);
    expect(a?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Before sharing: participant should not see analysis
  const beforeShare = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
  );
  const beforeData = (await beforeShare.json()) as {
    aiAnalysis: {
      analysisJson: unknown;
      canView: boolean;
      participantPlaceholder: boolean;
      notSharedMessage: string | null;
    };
  };
  expect(beforeData.aiAnalysis.canView).toBe(false);
  expect(beforeData.aiAnalysis.analysisJson).toBeNull();
  expect(beforeData.aiAnalysis.notSharedMessage).not.toBeNull();

  // Share the analysis
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    data: { joinToken: facilitator.joinToken },
  });

  // After sharing: participant can see shared (sanitized) analysis
  const afterShare = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
  );
  const afterData = (await afterShare.json()) as {
    aiAnalysis: {
      analysisJson: { roleObjectivesAnalysis?: unknown[] };
      canView: boolean;
      isSharedWithSession: boolean;
    };
  };
  expect(afterData.aiAnalysis.canView).toBe(true);
  expect(afterData.aiAnalysis.isSharedWithSession).toBe(true);
  // Shared version has roleObjectivesAnalysis stripped
  expect(afterData.aiAnalysis.analysisJson?.roleObjectivesAnalysis).toHaveLength(0);

  // Facilitator still gets full analysis data
  const facilitatorStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
  );
  const facilitatorData = (await facilitatorStatus.json()) as {
    aiAnalysis: { visibility: string; canShare: boolean };
  };
  expect(facilitatorData.aiAnalysis.visibility).toBe("SHARED_WITH_SESSION");
  expect(facilitatorData.aiAnalysis.canShare).toBe(false); // already completed, can't share again (it is shared)

  // Clean up
  await clearAiAnalysis(session.id);
});
