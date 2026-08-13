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

import { createHash, randomBytes } from "node:crypto";

import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  clearAiAnalysis,
  createCompletedTranscript,
  createActiveUser,
  createE2eEvent,
  createE2eCase,
  getAiAnalysis,
  getEventParticipants,
  getSession,
  participantByName,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function createUserSessionCookie(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,NOW() + INTERVAL '30 days',NOW())`,
    [userId, tokenHash],
  );
  return rawToken;
}

async function authHeaders(userId: string) {
  return { Cookie: `auth_session=${await createUserSessionCookie(userId)}` };
}

async function login(page: Page, userId: string) {
  const rawToken = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: rawToken,
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function createAndAssignSession(request: APIRequestContext) {
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ withParticipants: true });
  const participants = await getEventParticipants(event.id);
  const dmitry = participantByName(participants, "Dmitry");
  const igor = participantByName(participants, "Igor");
  const alex = participantByName(participants, "Alex");
  const serg = participantByName(participants, "Serg");
  const [buyerRole, sellerRole] = negotiationCase.roles;
  const hostUser = await createActiveUser();
  const igorUser = await createActiveUser();
  const alexUser = await createActiveUser();
  const sergUser = await createActiveUser();
  if (!buyerRole || !sellerRole) throw new Error("E2E case roles missing");

  await query(
    `UPDATE "TrainingEvent"
     SET "visibility"='PUBLIC',"hostUserId"=$2,"facilitatorUserId"=$2
     WHERE "id"=$1`,
    [event.id, hostUser.id],
  );
  await query(
    `UPDATE "EventParticipant"
     SET "userId" = CASE "id"
       WHEN $2 THEN $6
       WHEN $3 THEN $7
       WHEN $4 THEN $8
       WHEN $5 THEN $9
       ELSE "userId"
     END
     WHERE "eventId"=$1`,
    [
      event.id,
      dmitry.id,
      igor.id,
      alex.id,
      serg.id,
      hostUser.id,
      igorUser.id,
      alexUser.id,
      sergUser.id,
    ],
  );

  const patchRes = await request.patch(`/api/events/${event.id}/host`, {
    data: {
      hostToken: event.hostToken,
      selectedCaseId: negotiationCase.id,
      assignmentDraft: {
        roomLabel: "Debrief E2E Room",
        facilitatorEventParticipantId: dmitry.id,
        roleAssignments: { [buyerRole.id]: igor.id, [sellerRole.id]: alex.id },
        observerEventParticipantIds: [serg.id],
        preparationDurationMinutes: 1,
        negotiationDurationMinutes: 2,
      },
    },
  });
  expect(patchRes.ok()).toBeTruthy();

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
    users: {
      facilitator: hostUser,
      igor: igorUser,
      alex: alexUser,
      serg: sergUser,
    },
  };
}

async function finishSession(
  sessionId: string,
) {
  await query(
    `UPDATE "Session"
     SET "negotiationState"='FINISHED',
         "roomLifecycle"='DEBRIEF_OPEN',
         "negotiationStartedAt"=COALESCE("negotiationStartedAt", NOW() - INTERVAL '2 minutes'),
         "negotiationEndedAt"=COALESCE("negotiationEndedAt", NOW()),
         "updatedAt"=NOW()
     WHERE "id"=$1`,
    [sessionId],
  );
}

// ── Test 1: Stay in room after finish ─────────────────────────────────────

test("debrief: user stays in session room after session finish", async ({
  page,
  request,
}) => {
  const { session, facilitator, users } = await createAndAssignSession(request);

  // Finish the session directly via API (no need to actually start it for UI test)
  await finishSession(session.id);

  // Navigate to the room
  await login(page, users.facilitator.id);
  await page.goto(`/room/${session.id}?joinToken=${facilitator.joinToken}`);

  // The session-room-page should still be visible (not redirected away)
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });

  // Debrief panel should appear in the sidebar
  const debriefPanel = page
    .getByTestId("room-desktop-sidebar")
    .getByTestId("debrief-panel");
  await expect(debriefPanel).toBeVisible({ timeout: 10000 });
  await expect(debriefPanel.getByTestId("debrief-title")).toBeVisible();
  await expect(debriefPanel.getByTestId("debrief-message")).toBeVisible();

  // Debrief mode badge in header
  await expect(page.getByTestId("debrief-mode-badge")).toBeVisible();
  await expect(page.getByTestId("debrief-mode-notice")).toHaveCount(0);

  // Facilitator controls are gone (FINISH is done, session closed)
  await expect(page.getByTestId("facilitator-start-button")).not.toBeVisible();

  // Key actions visible in debrief panel
  await expect(
    debriefPanel.getByTestId("debrief-open-materials-button"),
  ).toBeVisible();
});

// ── Test 2: Run AI analysis from Sessions page ────────────────────────────

test("materials: facilitator can run AI analysis when transcript is ready", async ({
  page,
  request,
}) => {
  const { session, facilitator, users } = await createAndAssignSession(request);
  await finishSession(session.id);

  // Seed a completed transcript
  await createCompletedTranscript(session.id);

  // Open materials page
  await login(page, users.facilitator.id);
  await page.goto(`/join/${facilitator.joinToken}`);
  await expect(page.getByTestId("post-processing-ai-section")).toBeVisible({ timeout: 10000 });

  // Run AI analysis button should appear for this finished session
  const runBtn = page.getByTestId("post-processing-run-ai-analysis-button");
  await expect(runBtn).toBeVisible({ timeout: 5000 });
  await runBtn.click();
  await page.getByTestId("ai-analysis-consent-checkbox").check();
  await page.getByTestId("ai-analysis-confirm").click();

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
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);

  // Run AI analysis via API
  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();

  // Verify analysis completed
  await expect(async () => {
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Open Session Materials as facilitator
  await login(page, users.facilitator.id);
  await page.goto(`/join/${facilitator.joinToken}`);
  await expect(page.getByTestId("post-processing-ai-section")).toBeVisible({ timeout: 10000 });

  // Share button should be visible
  const shareBtn = page.getByTestId("post-processing-share-analysis-button");
  await expect(shareBtn).toBeVisible({ timeout: 5000 });
  await shareBtn.click();
  await page.getByTestId("share-debrief-consent-checkbox").check();
  await page.getByTestId("share-debrief-confirm").click();

  // Shared indicator appears
  await expect(page.getByTestId("post-processing-unshare-analysis-button")).toBeVisible({ timeout: 5000 });

  // Now open as participant — shared analysis should be visible
  await login(page, users.igor.id);
  await page.goto(`/join/${igor.joinToken}`);
  await expect(page.getByTestId("post-processing-ai-section")).toBeVisible({ timeout: 10000 });

  // Participant should NOT see facilitator-only badge
  await expect(page.getByText("Full facilitator analysis")).not.toBeVisible();

  // Participant should NOT see private role objective analysis
  // (the shared report has roleObjectivesAnalysis stripped)
  // The shared report badge should be visible if analysis is shown
  // Check the not-shared message is gone
  await expect(page.getByText("AI analysis has not been shared yet.")).not.toBeVisible();

  // Clean up
  await clearAiAnalysis(session.id);
});

// ── Test 4: Participant cannot see full AI report before sharing ───────────

test("materials: participant cannot see AI report before facilitator shares it", async ({
  page,
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);

  // Run AI analysis (stays facilitator-only by default)
  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();

  await expect(async () => {
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Open as participant
  await login(page, users.igor.id);
  await page.goto(`/join/${igor.joinToken}`);
  await expect(page.getByTestId("post-processing-ai-section")).toBeVisible({ timeout: 10000 });

  // Should show "not shared yet" message
  await expect(page.getByText("AI analysis has not been shared yet.")).toBeVisible({ timeout: 5000 });

  // Should NOT show the AI report
  await expect(page.getByText("Overall assessment")).not.toBeVisible();

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

  await finishSession(setup1.session.id);
  await finishSession(setup2.session.id);

  await createCompletedTranscript(setup1.session.id);
  await createCompletedTranscript(setup2.session.id);

  // Run AI for session 1 only
  const analyzeRes = await request.post(`/api/sessions/${setup1.session.id}/analyze`, {
    headers: await authHeaders(setup1.users.facilitator.id),
    data: { joinToken: setup1.facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const a = await getAiAnalysis(setup1.session.id);
    expect(a?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Share session 1 analysis
  const shareRes = await request.post(
    `/api/sessions/${setup1.session.id}/ai-analysis/share`,
    {
      headers: await authHeaders(setup1.users.facilitator.id),
      data: { joinToken: setup1.facilitator.joinToken, shareDebriefConfirmed: true },
    },
  );
  expect(shareRes.ok()).toBeTruthy();

  // Session 2 AI analysis: should NOT be shared
  const session2Status = await request.get(
    `/api/sessions/${setup2.session.id}/materials/status?joinToken=${setup2.igor.joinToken}`,
    { headers: await authHeaders(setup2.users.igor.id) },
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
  const { session, facilitator, serg, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);

  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const a = await getAiAnalysis(session.id);
    expect(a?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Share the analysis
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  // Open as observer
  await login(page, users.serg.id);
  await page.goto(`/join/${serg.joinToken}`);
  await expect(page.getByTestId("post-processing-ai-section")).toBeVisible({ timeout: 10000 });

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
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);

  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const a = await getAiAnalysis(session.id);
    expect(a?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  // Before sharing: participant should not see analysis
  const beforeShare = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
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
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  // After sharing: participant can see shared (sanitized) analysis
  const afterShare = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
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
  expect(afterData.aiAnalysis.analysisJson?.roleObjectivesAnalysis ?? []).toHaveLength(0);

  // Facilitator still gets full analysis data
  const facilitatorStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${facilitator.joinToken}`,
    { headers: await authHeaders(users.facilitator.id) },
  );
  const facilitatorData = (await facilitatorStatus.json()) as {
    aiAnalysis: { visibility: string; canShare: boolean };
  };
  expect(facilitatorData.aiAnalysis.visibility).toBe("SHARED_WITH_SESSION");
  expect(facilitatorData.aiAnalysis.canShare).toBe(true);

  // Clean up
  await clearAiAnalysis(session.id);
});
