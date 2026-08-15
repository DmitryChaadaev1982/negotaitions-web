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

import { expect, type APIRequestContext, type Locator, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  clearAiAnalysis,
  createRoomConnectionForParticipant,
  createCompletedTranscript,
  createActiveUser,
  createE2eEvent,
  createE2eCase,
  getAiAnalysis,
  getEventParticipants,
  getSession,
  participantByName,
  query,
  disconnectRoomConnection,
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

async function markPresent(
  sessionId: string,
  recipient: { userId: string | null; type: string },
) {
  if (!recipient.userId) {
    throw new Error("Publication recipient must be account-bound.");
  }
  return createRoomConnectionForParticipant({
    sessionId,
    userId: recipient.userId,
    role: recipient.type,
  });
}

async function openRecipientDebrief(
  page: Page,
  userId: string,
  sessionId: string,
  joinToken: string,
) {
  await login(page, userId);
  await page.goto(`/room/${sessionId}?joinToken=${joinToken}`);
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });
  const debriefPanel = page
    .getByTestId("room-desktop-sidebar")
    .getByTestId("debrief-panel");
  await expect(debriefPanel).toBeVisible({ timeout: 15000 });
  return debriefPanel;
}

async function claimRoomEntry(
  request: APIRequestContext,
  sessionId: string,
  participant: { id: string },
  userId: string,
  connectionId?: string,
) {
  const claimedConnectionId =
    connectionId ?? `entry-${participant.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await request.get(
    `/api/sessions/${sessionId}/control-state?participantId=${participant.id}&connectionId=${claimedConnectionId}&claimLease=1`,
    { headers: await authHeaders(userId) },
  );
  expect(response.ok()).toBeTruthy();
  return claimedConnectionId;
}

async function countActiveViewerGrants(sessionId: string, userId?: string) {
  const rows = await query<{ count: number }>(
    userId
      ? `SELECT COUNT(*)::int AS count
         FROM "AiAnalysisPublicationGrant" g
         JOIN "AiAnalysisPublication" p ON p.id = g."publicationId"
         JOIN "AiAnalysis" a ON a.id = p."aiAnalysisId"
         WHERE a."sessionId" = $1
           AND p."revokedAt" IS NULL
           AND g."revokedAt" IS NULL
           AND g."userId" = $2`
      : `SELECT COUNT(*)::int AS count
         FROM "AiAnalysisPublicationGrant" g
         JOIN "AiAnalysisPublication" p ON p.id = g."publicationId"
         JOIN "AiAnalysis" a ON a.id = p."aiAnalysisId"
         WHERE a."sessionId" = $1
           AND p."revokedAt" IS NULL
           AND g."revokedAt" IS NULL`,
    userId ? [sessionId, userId] : [sessionId],
  );
  return rows[0]?.count ?? 0;
}

async function analyzeUntilCompleted(
  request: APIRequestContext,
  sessionId: string,
  facilitatorJoinToken: string,
  facilitatorUserId: string,
) {
  const analyze = await request.post(`/api/sessions/${sessionId}/analyze`, {
    headers: await authHeaders(facilitatorUserId),
    data: { joinToken: facilitatorJoinToken, aiProcessingConfirmed: true },
  });
  expect(analyze.ok()).toBeTruthy();
  await expect(async () => {
    expect((await getAiAnalysis(sessionId))?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });
}

async function expectVisibleRecipientReport(panel: Locator) {
  await expect(panel.getByTestId("ai-report")).toBeVisible({ timeout: 20000 });
  await expect(panel.getByTestId("executive-summary")).toBeVisible();
  await expect(panel.getByTestId("executive-summary")).not.toHaveText("");
  await expect(
    panel.getByText("AI analysis result is invalid. Please rerun analysis."),
  ).toHaveCount(0);
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

  await markPresent(session.id, igor);

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

  await markPresent(session.id, serg);

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

  await markPresent(session.id, igor);

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

test("materials/status stops no-grant polling after terminal AI failure", async ({
  request,
}) => {
  const { session, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  const transcript = await createCompletedTranscript(session.id);
  await query(
    `INSERT INTO "AiAnalysis"
       ("id", "sessionId", "transcriptId", "transcriptRetranscribeCount",
        "status", "errorMessage", "updatedAt", "completedAt")
     VALUES (gen_random_uuid(), $1, $2, 0,
             'FAILED', 'Synthetic terminal AI failure.', NOW(), NOW())`,
    [session.id, transcript.id],
  );

  const status = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect(status.ok()).toBeTruthy();
  const body = (await status.json()) as {
    aiAnalysis: { status: string; processingStage: string };
    processing: { shouldPoll: boolean; nextPollMs: number | null };
  };
  expect(body.aiAnalysis).toMatchObject({
    status: "FAILED",
    processingStage: "failed",
  });
  expect(body.processing).toMatchObject({
    shouldPoll: false,
    nextPollMs: null,
  });

  await clearAiAnalysis(session.id);
});

test("TEST C: lobby-only membership without room entry is not granted on Publish", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  const emptyPublish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(emptyPublish.ok()).toBeTruthy();
  expect((await emptyPublish.json()) as { recipientCount: number }).toMatchObject({
    recipientCount: 0,
  });
  expect(await countActiveViewerGrants(session.id, users.igor.id)).toBe(0);

  const neverEntered = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  const neverEnteredBody = (await neverEntered.json()) as {
    aiAnalysis: { canView: boolean; processingStage: string };
  };
  expect(neverEnteredBody.aiAnalysis.canView).toBe(false);
  expect(neverEnteredBody.aiAnalysis.processingStage).toBe("ready");

  await clearAiAnalysis(session.id);
});

test("TEST A: Participant who left before Publish still receives a grant", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  const igorConnection = await markPresent(session.id, igor);
  await disconnectRoomConnection(igorConnection);

  const publish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(publish.ok()).toBeTruthy();
  expect((await publish.json()) as { recipientCount: number }).toMatchObject({
    recipientCount: 1,
  });
  expect(await countActiveViewerGrants(session.id, users.igor.id)).toBe(1);

  const afterPublish = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  const afterPublishBody = (await afterPublish.json()) as {
    aiAnalysis: { canView: boolean; analysisJson: { roleObjectivesAnalysis?: unknown[] } | null };
  };
  expect(afterPublishBody.aiAnalysis.canView).toBe(true);
  expect(afterPublishBody.aiAnalysis.analysisJson?.roleObjectivesAnalysis ?? []).toHaveLength(0);

  await clearAiAnalysis(session.id);
});

test("TEST B: Observer who left before Publish still receives an Observer grant", async ({
  request,
}) => {
  const { session, facilitator, serg, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  const sergConnection = await markPresent(session.id, serg);
  await disconnectRoomConnection(sergConnection);

  const publish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(publish.ok()).toBeTruthy();
  expect(await countActiveViewerGrants(session.id, users.serg.id)).toBe(1);

  const observerStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${serg.joinToken}`,
    { headers: await authHeaders(users.serg.id) },
  );
  const observerBody = (await observerStatus.json()) as {
    aiAnalysis: { canView: boolean; analysisJson: Record<string, unknown> | null };
  };
  expect(observerBody.aiAnalysis.canView).toBe(true);
  expect(JSON.stringify(observerBody.aiAnalysis.analysisJson)).not.toContain(
    "participantPersonalFeedback",
  );

  await clearAiAnalysis(session.id);
});

test("TEST E: Participant first room entry after Publish materializes the current grant", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(await countActiveViewerGrants(session.id, users.igor.id)).toBe(0);

  await claimRoomEntry(request, session.id, igor, users.igor.id);
  expect(await countActiveViewerGrants(session.id, users.igor.id)).toBe(1);

  const afterEntry = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await afterEntry.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: true },
  });

  await clearAiAnalysis(session.id);
});

test("TEST D: Observer first enters during DEBRIEF after Publish and sees Observer-safe report", async ({
  page,
  request,
}) => {
  const { session, facilitator, serg, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  const beforeEntry = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${serg.joinToken}`,
    { headers: await authHeaders(users.serg.id) },
  );
  expect((await beforeEntry.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: false },
  });

  const debriefPanel = await openRecipientDebrief(
    page,
    users.serg.id,
    session.id,
    serg.joinToken,
  );
  await expectVisibleRecipientReport(debriefPanel);
  expect(await countActiveViewerGrants(session.id, users.serg.id)).toBe(1);

  const afterEntry = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${serg.joinToken}`,
    { headers: await authHeaders(users.serg.id) },
  );
  const afterEntryBody = (await afterEntry.json()) as {
    aiAnalysis: { canView: boolean; analysisJson: Record<string, unknown> | null };
  };
  expect(afterEntryBody.aiAnalysis.canView).toBe(true);
  expect(JSON.stringify(afterEntryBody.aiAnalysis.analysisJson)).not.toContain(
    "participantPersonalFeedback",
  );
  await expect(debriefPanel.getByTestId("ai-pending-section-participantPersonalFeedback")).toHaveCount(0);
  await expect(debriefPanel.locator('[data-testid="ai-report"]')).not.toContainText("Personal feedback");
  const pageContent = await page.content();
  expect(pageContent).not.toContain("E2E_PRIVATE_IGOR_ONLY");
  expect(pageContent).not.toContain("participantPersonalFeedback");

  await clearAiAnalysis(session.id);
});

test("TEST F/G: entry after Unshare does not resurrect; Republish grants historical entrants", async ({
  request,
}) => {
  const { session, facilitator, igor, alex, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  await markPresent(session.id, igor);
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  await request.post(`/api/sessions/${session.id}/ai-analysis/unshare`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken },
  });

  await claimRoomEntry(request, session.id, alex, users.alex.id);
  expect(await countActiveViewerGrants(session.id, users.alex.id)).toBe(0);
  const afterUnshareEntry = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${alex.joinToken}`,
    { headers: await authHeaders(users.alex.id) },
  );
  expect((await afterUnshareEntry.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: false },
  });

  const republish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(republish.ok()).toBeTruthy();
  expect((await republish.json()) as { recipientCount: number }).toMatchObject({
    recipientCount: 2,
  });

  for (const recipient of [
    { participant: igor, user: users.igor },
    { participant: alex, user: users.alex },
  ]) {
    const status = await request.get(
      `/api/sessions/${session.id}/materials/status?joinToken=${recipient.participant.joinToken}`,
      { headers: await authHeaders(recipient.user.id) },
    );
    expect((await status.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
      aiAnalysis: { canView: true },
    });
  }

  await clearAiAnalysis(session.id);
});

test("TEST H: reconnects do not duplicate the effective viewer grant", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  await markPresent(session.id, igor);
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(await countActiveViewerGrants(session.id, users.igor.id)).toBe(1);

  await claimRoomEntry(request, session.id, igor, users.igor.id, `reconnect-a-${igor.id}`);
  await claimRoomEntry(request, session.id, igor, users.igor.id, `reconnect-b-${igor.id}`);
  expect(await countActiveViewerGrants(session.id, users.igor.id)).toBe(1);

  const afterReconnect = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await afterReconnect.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: true },
  });

  await clearAiAnalysis(session.id);
});

test("grants survive rejoin, and Unshare remains an epoch boundary", async ({
  request,
}) => {
  const { session, facilitator, igor, alex, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await analyzeUntilCompleted(request, session.id, facilitator.joinToken, users.facilitator.id);

  const igorConnection = await markPresent(session.id, igor);
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  await disconnectRoomConnection(igorConnection);
  await markPresent(session.id, igor);
  const afterRejoin = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await afterRejoin.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: true },
  });

  await markPresent(session.id, alex);
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  for (const recipient of [
    { participant: igor, user: users.igor },
    { participant: alex, user: users.alex },
  ]) {
    const status = await request.get(
      `/api/sessions/${session.id}/materials/status?joinToken=${recipient.participant.joinToken}`,
      { headers: await authHeaders(recipient.user.id) },
    );
    expect((await status.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
      aiAnalysis: { canView: true },
    });
  }

  await request.post(`/api/sessions/${session.id}/ai-analysis/unshare`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken },
  });
  const afterUnshare = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await afterUnshare.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: false },
  });

  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  const igorAfterNewEpoch = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await igorAfterNewEpoch.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: true },
  });

  await clearAiAnalysis(session.id);
});

test("observer receives completed freshness status without gaining unpublished analysis", async ({
  request,
}) => {
  const { session, facilitator, serg, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await query(
    `UPDATE "Transcript"
     SET "processingMetadata" = jsonb_build_object(
       'transcriptionProvider', 'yandex_speechkit',
       'transcriptEnhancement', jsonb_build_object('status', 'COMPLETED')
     )
     WHERE "sessionId" = $1`,
    [session.id],
  );

  const analyze = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyze.ok()).toBeTruthy();
  await expect(async () => {
    expect((await getAiAnalysis(session.id))?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  const status = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${serg.joinToken}`,
    { headers: await authHeaders(users.serg.id) },
  );
  const body = (await status.json()) as {
    transcription: { enhancement: { status: string } | null };
    aiAnalysis: { processingStage: string; canView: boolean; analysisJson: unknown };
  };
  expect(body.transcription.enhancement?.status).toBe("COMPLETED");
  expect(body.aiAnalysis.processingStage).toBe("ready");
  expect(body.aiAnalysis.canView).toBe(false);
  expect(body.aiAnalysis.analysisJson).toBeNull();

  await clearAiAnalysis(session.id);
});

test("legacy session-wide shared state requires an explicit republish before recipient access", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await query(
    `INSERT INTO "AiAnalysis"
       ("id", "sessionId", "status", "analysisJson", "sharedAnalysisJson",
        "executiveSummary", "sharedExecutiveSummary", "visibility", "updatedAt", "completedAt")
     VALUES (gen_random_uuid(), $1, 'COMPLETED', $2, $2, 'legacy', 'legacy',
             'SHARED_WITH_SESSION', NOW(), NOW())`,
    [session.id, JSON.stringify({ executiveSummary: "legacy", overallScore: 1 })],
  );
  await query(
    `UPDATE "AiAnalysis"
     SET "transcriptId" = (SELECT id FROM "Transcript" WHERE "sessionId" = $1),
         "transcriptRetranscribeCount" = 0
     WHERE "sessionId" = $1`,
    [session.id],
  );

  // The old payload has no persisted publication-time lease snapshot, so it
  // cannot be converted into a grant merely from current membership.
  const beforeRepublish = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await beforeRepublish.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: false },
  });

  await markPresent(session.id, igor);
  const republish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(republish.ok()).toBeTruthy();
  const afterRepublish = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect((await afterRepublish.json()) as { aiAnalysis: { canView: boolean } }).toMatchObject({
    aiAnalysis: { canView: true },
  });

  await clearAiAnalysis(session.id);
});

test("a grant stays bound to its published analysis snapshot after the mutable analysis reruns", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  const versionOne = { executiveSummary: "published-v1", overallScore: 1 };
  const versionTwo = { executiveSummary: "unpublished-v2", overallScore: 2 };
  await query(
    `INSERT INTO "AiAnalysis"
       ("id", "sessionId", "status", "analysisJson", "executiveSummary",
        "visibility", "updatedAt", "completedAt")
     VALUES (gen_random_uuid(), $1, 'COMPLETED', $2, 'published-v1',
             'FACILITATOR_ONLY', NOW(), NOW())`,
    [session.id, JSON.stringify(versionOne)],
  );
  await query(
    `UPDATE "AiAnalysis"
     SET "transcriptId" = (SELECT id FROM "Transcript" WHERE "sessionId" = $1),
         "transcriptRetranscribeCount" = 0
     WHERE "sessionId" = $1`,
    [session.id],
  );

  await markPresent(session.id, igor);
  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  // The analysis execution row is mutable and reused. Simulate its next
  // completed generation without publishing that generation.
  await query(
    `UPDATE "AiAnalysis"
     SET "analysisVersion" = "analysisVersion" + 1,
         "analysisJson" = $2,
         "executiveSummary" = 'unpublished-v2',
         "updatedAt" = NOW()
     WHERE "sessionId" = $1`,
    [session.id, JSON.stringify(versionTwo)],
  );

  const status = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  const body = (await status.json()) as {
    aiAnalysis: { canView: boolean; executiveSummary: string | null; analysisJson: unknown };
  };
  expect(body.aiAnalysis.canView).toBe(true);
  expect(body.aiAnalysis.executiveSummary).toBe("published-v1");
  expect(JSON.stringify(body.aiAnalysis.analysisJson)).toContain("published-v1");
  expect(JSON.stringify(body.aiAnalysis.analysisJson)).not.toContain("unpublished-v2");

  await clearAiAnalysis(session.id);
});

test("Publish explicitly clears legacy shared JSON when the canonical analysis is null", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  await query(
    `INSERT INTO "AiAnalysis"
       ("id","sessionId","status","analysisJson","sharedAnalysisJson",
        "visibility","updatedAt","completedAt")
     VALUES (gen_random_uuid(),$1,'COMPLETED',NULL,$2,
             'SHARED_WITH_SESSION',NOW(),NOW())`,
    [session.id, JSON.stringify({ executiveSummary: "stale legacy report" })],
  );
  await query(
    `UPDATE "AiAnalysis"
     SET "transcriptId" = (SELECT id FROM "Transcript" WHERE "sessionId" = $1),
         "transcriptRetranscribeCount" = 0
     WHERE "sessionId" = $1`,
    [session.id],
  );
  await markPresent(session.id, igor);

  const publish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(publish.ok()).toBeTruthy();

  const cleared = await query<{ rowCleared: boolean; snapshotCleared: boolean }>(
    `SELECT
       jsonb_typeof(a."sharedAnalysisJson") = 'null' AS "rowCleared",
       jsonb_typeof(p."sharedAnalysisJson") = 'null' AS "snapshotCleared"
     FROM "AiAnalysis" a
     JOIN "AiAnalysisPublication" p ON p."aiAnalysisId" = a.id
     WHERE a."sessionId" = $1 AND p."revokedAt" IS NULL`,
    [session.id],
  );
  expect(cleared[0]).toMatchObject({
    rowCleared: true,
    snapshotCleared: true,
  });
  const recipientStatus = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${igor.joinToken}`,
    { headers: await authHeaders(users.igor.id) },
  );
  expect(JSON.stringify(await recipientStatus.json())).not.toContain(
    "stale legacy report",
  );

  await clearAiAnalysis(session.id);
});

test("Publish rejects a completed analysis whose transcript generation is stale", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  const analyze = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyze.ok()).toBeTruthy();
  await expect(async () => {
    expect((await getAiAnalysis(session.id))?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });
  await markPresent(session.id, igor);

  await query(
    `UPDATE "Transcript" SET "retranscribeCount" = "retranscribeCount" + 1
     WHERE "sessionId" = $1`,
    [session.id],
  );
  const stalePublish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(stalePublish.status()).toBe(409);

  await query(
    `UPDATE "AiAnalysis"
     SET "transcriptRetranscribeCount" = (
       SELECT "retranscribeCount" FROM "Transcript" WHERE "sessionId" = $1
     )
     WHERE "sessionId" = $1`,
    [session.id],
  );
  const currentPublish = await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  expect(currentPublish.ok()).toBeTruthy();

  await clearAiAnalysis(session.id);
});

test("concurrent Publish and Unshare serialize, while concurrent Publish is idempotent", async ({
  request,
}) => {
  const { session, facilitator, igor, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);
  const analyze = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyze.ok()).toBeTruthy();
  await expect(async () => {
    expect((await getAiAnalysis(session.id))?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });
  await markPresent(session.id, igor);
  const headers = await authHeaders(users.facilitator.id);
  const share = () =>
    request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
      headers,
      data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
    });
  const unshare = () =>
    request.post(`/api/sessions/${session.id}/ai-analysis/unshare`, {
      headers,
      data: { joinToken: facilitator.joinToken },
    });

  const [firstPublish, secondPublish] = await Promise.all([share(), share()]);
  expect(firstPublish.ok()).toBeTruthy();
  expect(secondPublish.ok()).toBeTruthy();
  const publicationCount = await query(
    `SELECT COUNT(*)::int AS count FROM "AiAnalysisPublication"
     WHERE "aiAnalysisId" = (SELECT id FROM "AiAnalysis" WHERE "sessionId" = $1)
       AND "revokedAt" IS NULL`,
    [session.id],
  );
  expect(publicationCount[0]?.count).toBe(1);
  const grantCount = await query(
    `SELECT COUNT(*)::int AS count FROM "AiAnalysisPublicationGrant"
     WHERE "publicationId" = (
       SELECT id FROM "AiAnalysisPublication"
       WHERE "aiAnalysisId" = (SELECT id FROM "AiAnalysis" WHERE "sessionId" = $1)
         AND "revokedAt" IS NULL
     )`,
    [session.id],
  );
  expect(grantCount[0]?.count).toBe(1);

  const [concurrentPublish, concurrentUnshare] = await Promise.all([share(), unshare()]);
  expect(concurrentPublish.status()).not.toBe(500);
  expect(concurrentUnshare.status()).not.toBe(500);
  expect([200, 409]).toContain(concurrentPublish.status());
  expect([200, 409]).toContain(concurrentUnshare.status());

  // Whichever request linearized last determines the state. If Unshare was
  // last, every active grant is revoked; if Publish was last, its one active
  // snapshot/grant set is coherent and discoverable.
  const state = await query(
    `SELECT "visibility" FROM "AiAnalysis" WHERE "sessionId" = $1`,
    [session.id],
  );
  const activePublications = await query(
    `SELECT COUNT(*)::int AS count FROM "AiAnalysisPublication"
     WHERE "aiAnalysisId" = (SELECT id FROM "AiAnalysis" WHERE "sessionId" = $1)
       AND "revokedAt" IS NULL`,
    [session.id],
  );
  if (state[0]?.visibility === "FACILITATOR_ONLY") {
    expect(activePublications[0]?.count).toBe(0);
  } else {
    expect(activePublications[0]?.count).toBe(1);
  }

  await clearAiAnalysis(session.id);
});

test("S313E-AIPUB-004: Observer with a valid grant sees the observer-safe report body", async ({
  page,
  request,
}) => {
  const { session, event, facilitator, serg, users } = await createAndAssignSession(request);
  await finishSession(session.id);
  await createCompletedTranscript(session.id);

  const analyzeRes = await request.post(`/api/sessions/${session.id}/analyze`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, aiProcessingConfirmed: true },
  });
  expect(analyzeRes.ok()).toBeTruthy();
  await expect(async () => {
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  await markPresent(session.id, serg);
  const debriefPanel = await openRecipientDebrief(
    page,
    users.serg.id,
    session.id,
    serg.joinToken,
  );
  await expect(debriefPanel.getByTestId("debrief-fallback-content")).toBeVisible({
    timeout: 15000,
  });

  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });

  const statusRes = await request.get(
    `/api/sessions/${session.id}/materials/status?joinToken=${serg.joinToken}`,
    { headers: await authHeaders(users.serg.id) },
  );
  expect(statusRes.ok()).toBeTruthy();
  const statusBody = (await statusRes.json()) as {
    aiAnalysis: {
      canView: boolean;
      analysisJson: { executiveSummary?: string; participantPersonalFeedback?: unknown } | null;
    };
  };
  expect(statusBody.aiAnalysis.canView).toBe(true);
  expect(statusBody.aiAnalysis.analysisJson?.executiveSummary).toBeTruthy();
  expect(statusBody.aiAnalysis.analysisJson).not.toHaveProperty("participantPersonalFeedback");

  await expectVisibleRecipientReport(debriefPanel);
  await expect(debriefPanel.getByTestId("ai-pending-section-participantPersonalFeedback")).toHaveCount(0);
  await expect(debriefPanel.locator('[data-testid="ai-report"]')).not.toContainText("Personal feedback");
  const pageContent = await page.content();
  expect(pageContent).not.toContain("E2E_PRIVATE_IGOR_ONLY");
  expect(pageContent).not.toContain("participantPersonalFeedback");

  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible({ timeout: 15000 });
  await page.goto(`/room/${session.id}?joinToken=${serg.joinToken}`);
  await expect(page.getByTestId("session-room-page")).toBeVisible({ timeout: 15000 });
  const reenteredPanel = page
    .getByTestId("room-desktop-sidebar")
    .getByTestId("debrief-panel");
  await expect(reenteredPanel).toBeVisible({ timeout: 15000 });
  await expectVisibleRecipientReport(reenteredPanel);

  await clearAiAnalysis(session.id);
});

test("S313E-AIPUB-014: mounted Participant loses the report after canonical Unshare without navigation", async ({
  page,
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
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  await markPresent(session.id, igor);
  const debriefPanel = await openRecipientDebrief(
    page,
    users.igor.id,
    session.id,
    igor.joinToken,
  );

  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  await expectVisibleRecipientReport(debriefPanel);

  const unshareRes = await request.post(`/api/sessions/${session.id}/ai-analysis/unshare`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken },
  });
  expect(unshareRes.ok()).toBeTruthy();

  await expect(debriefPanel.getByTestId("ai-report")).toHaveCount(0, { timeout: 20000 });
  await expect(debriefPanel.getByTestId("debrief-fallback-content")).toBeVisible({
    timeout: 20000,
  });
  await expect(debriefPanel.getByText("AI analysis has not been shared yet.")).toBeVisible({
    timeout: 20000,
  });

  await clearAiAnalysis(session.id);
});

test("S313E-AIPUB-014: mounted Observer loses the report after canonical Unshare without navigation", async ({
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
    const analysis = await getAiAnalysis(session.id);
    expect(analysis?.status).toBe("COMPLETED");
  }).toPass({ timeout: 30000 });

  await markPresent(session.id, serg);
  const debriefPanel = await openRecipientDebrief(
    page,
    users.serg.id,
    session.id,
    serg.joinToken,
  );

  await request.post(`/api/sessions/${session.id}/ai-analysis/share`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken, shareDebriefConfirmed: true },
  });
  await expectVisibleRecipientReport(debriefPanel);

  const unshareRes = await request.post(`/api/sessions/${session.id}/ai-analysis/unshare`, {
    headers: await authHeaders(users.facilitator.id),
    data: { joinToken: facilitator.joinToken },
  });
  expect(unshareRes.ok()).toBeTruthy();

  await expect(debriefPanel.getByTestId("ai-report")).toHaveCount(0, { timeout: 20000 });
  await expect(debriefPanel.getByTestId("debrief-fallback-content")).toBeVisible({
    timeout: 20000,
  });
  await expect(debriefPanel.getByText("AI analysis has not been shared yet.")).toBeVisible({
    timeout: 20000,
  });

  await clearAiAnalysis(session.id);
});
