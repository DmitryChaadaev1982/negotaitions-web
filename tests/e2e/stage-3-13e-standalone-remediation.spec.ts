import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
  test,
} from "@playwright/test";
import { Pool } from "pg";

import {
  cleanupE2eData,
  countTranscripts,
  createActiveUser,
  createE2eCase,
  createRoomConnectionForParticipant,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
  updateRecordingCompleted,
  upsertRecordingForSession,
} from "./helpers/db";
import { resolveE2eDatabaseUrl } from "./helpers/e2e-database";

test.describe.configure({ mode: "serial" });

type SessionFixture = {
  sessionId: string;
  facilitator: { id: string; userId: string; joinToken: string };
  candidate: { id: string; userId: string; joinToken: string };
};

async function createSessionFixture(options?: {
  eventLinked?: boolean;
}): Promise<SessionFixture> {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser();
  const candidateUser = await createActiveUser();
  const playerUser = await createActiveUser();
  const sessionId = e2eId(options?.eventLinked ? "event-session" : "standalone-session");
  const facilitatorParticipantId = e2eId("facilitator-participant");
  const candidateParticipantId = e2eId("candidate-participant");
  const facilitatorJoinToken = e2eId("facilitator-token");
  const candidateJoinToken = e2eId("candidate-token");
  const playerParticipantId = e2eId("player-participant");
  const playerJoinToken = e2eId("player-token");
  let eventId: string | null = null;

  if (options?.eventLinked) {
    eventId = e2eId("event");
    await query(
      `INSERT INTO "TrainingEvent"
         ("id", "title", "status", "hostUserId", "facilitatorUserId", "visibility",
          "publicJoinCode", "hostToken", "estimatedEventDurationSeconds", "createdAt", "updatedAt")
       VALUES ($1, $2, 'SESSION_CREATED', $3, $3, 'PRIVATE', $4, $5, 3600, NOW(), NOW())`,
      [
        eventId,
        e2eName("Stage 3.13E remediation Event"),
        facilitatorUser.id,
        e2eId("join-code"),
        e2eId("host-token"),
      ],
    );
  }

  await query(
    `INSERT INTO "Session"
       ("id", "title", "negotiationCaseId", "facilitatorId", "eventId", "visibility",
        "status", "snapshotCaseTitle", "snapshotBusinessContext",
        "snapshotPublicInstructions", "snapshotCaseLanguage", "negotiationState",
        "durationSeconds", "preparationDurationSeconds", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'PRIVATE', 'DRAFT', $6, 'Context',
        'Instructions', 'EN', 'PREPARATION', 900, 300, NOW(), NOW())`,
    [
      sessionId,
      e2eName(
        options?.eventLinked
          ? "Stage 3.13E Event control regression"
          : "Stage 3.13E standalone remediation",
      ),
      negotiationCase.id,
      facilitatorUser.id,
      eventId,
      e2eName("Stage 3.13E case snapshot"),
    ],
  );
  const sessionRoleId = e2eId("session-role");
  const sourceRole = negotiationCase.roles[0];
  await query(
    `INSERT INTO "SessionRole"
       ("id", "sessionId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW(), NOW())`,
    [
      sessionRoleId,
      sessionId,
      sourceRole.name,
      sourceRole.privateInstructions,
      sourceRole.objectives,
      sourceRole.constraints,
      sourceRole.hiddenInfo,
      sourceRole.fallbackPosition,
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "displayName", "type", "joinToken", "sessionRoleId", "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Initial facilitator', 'FACILITATOR', $4, NULL, NOW(), NOW()),
       ($5, $2, $6, 'Next facilitator', 'OBSERVER', $7, NULL, NOW(), NOW()),
       ($8, $2, $9, 'Assigned player', 'PARTICIPANT', $10, $11, NOW(), NOW())`,
    [
      facilitatorParticipantId,
      sessionId,
      facilitatorUser.id,
      facilitatorJoinToken,
      candidateParticipantId,
      candidateUser.id,
      candidateJoinToken,
      playerParticipantId,
      playerUser.id,
      playerJoinToken,
      sessionRoleId,
    ],
  );

  return {
    sessionId,
    facilitator: {
      id: facilitatorParticipantId,
      userId: facilitatorUser.id,
      joinToken: facilitatorJoinToken,
    },
    candidate: {
      id: candidateParticipantId,
      userId: candidateUser.id,
      joinToken: candidateJoinToken,
    },
  };
}

async function authenticatePage(page: Page, userId: string) {
  const cookie = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookie.replace("auth_session=", ""),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function controlStateWithoutReclaim(
  request: APIRequestContext,
  input: {
    sessionId: string;
    participantId: string;
    connectionId: string;
    cookie: string;
  },
) {
  const response = await request.get(
    `/api/sessions/${input.sessionId}/control-state?participantId=${input.participantId}&connectionId=${input.connectionId}`,
    { headers: { Cookie: input.cookie } },
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    negotiationState: string;
    controlToken: string;
  }>;
}

async function postControl(
  request: APIRequestContext,
  input: {
    sessionId: string;
    participantId: string;
    connectionId: string;
    cookie: string;
    action: string;
  },
) {
  const state = await controlStateWithoutReclaim(request, input);
  return request.post(`/api/sessions/${input.sessionId}/control`, {
    headers: { Cookie: input.cookie },
    data: {
      participantId: input.participantId,
      connectionId: input.connectionId,
      action: input.action,
      expectedNegotiationState: state.negotiationState,
      expectedControlToken: state.controlToken,
    },
  });
}

async function holdSessionRowLock(sessionId: string) {
  const pool = new Pool({ connectionString: resolveE2eDatabaseUrl() });
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`SELECT id FROM "Session" WHERE id = $1 FOR UPDATE`, [sessionId]);

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await client.query("COMMIT");
    client.release();
    await pool.end();
  };
}

async function expectConcurrentTranscriptionIsSingleFlight(
  request: APIRequestContext,
  fixture: SessionFixture,
) {
  await upsertRecordingForSession({
    sessionId: fixture.sessionId,
    status: "COMPLETED",
  });
  await updateRecordingCompleted(fixture.sessionId);
  const cookie = await createUserSessionCookie(fixture.facilitator.userId);
  const releaseLock = await holdSessionRowLock(fixture.sessionId);

  let responses: APIResponse[] = [];
  try {
    const first = request.post(
      `/api/sessions/${fixture.sessionId}/materials/transcribe`,
      {
        headers: { Cookie: cookie },
        data: { participantId: fixture.facilitator.id, language: "auto" },
      },
    );
    const second = request.post(
      `/api/sessions/${fixture.sessionId}/materials/transcribe`,
      {
        headers: { Cookie: cookie },
        data: { participantId: fixture.facilitator.id, language: "auto" },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    await releaseLock();
    responses = await Promise.all([first, second]);
  } finally {
    await releaseLock();
  }

  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  expect(await countTranscripts(fixture.sessionId)).toBe(1);
  const rows = await query<{ status: string; retranscribeCount: number }>(
    `SELECT status, "retranscribeCount"
     FROM "Transcript"
     WHERE "sessionId" = $1`,
    [fixture.sessionId],
  );
  expect(rows).toEqual([{ status: "COMPLETED", retranscribeCount: 0 }]);
}

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

test("standalone reassignment rebinds the open lease without reload and revokes old control", async ({
  page,
  request,
}) => {
  const fixture = await createSessionFixture();
  const oldConnectionId = await createRoomConnectionForParticipant({
    sessionId: fixture.sessionId,
    userId: fixture.facilitator.userId,
    role: "FACILITATOR",
  });
  const newConnectionId = await createRoomConnectionForParticipant({
    sessionId: fixture.sessionId,
    userId: fixture.candidate.userId,
    role: "OBSERVER",
  });

  await authenticatePage(page, fixture.facilitator.userId);
  await page.goto(`/sessions/${fixture.sessionId}`);
  await page
    .getByTestId("reassign-facilitator-select")
    .selectOption(fixture.candidate.id);
  const reassignmentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/sessions/${fixture.sessionId}`),
  );
  await page.getByTestId("reassign-facilitator-button").click();
  expect((await reassignmentResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("reassign-facilitator-button")).toBeDisabled();

  const authorityRows = await query<{
    userId: string;
    participantType: string;
    leaseRole: string;
  }>(
    `SELECT sp."userId", sp.type::text AS "participantType", src.role::text AS "leaseRole"
     FROM "SessionParticipant" sp
     INNER JOIN "SessionRoomConnection" src
       ON src."sessionId" = sp."sessionId" AND src."userId" = sp."userId"
     WHERE sp."sessionId" = $1
     ORDER BY sp."userId"`,
    [fixture.sessionId],
  );
  expect(authorityRows).toEqual(
    expect.arrayContaining([
      {
        userId: fixture.facilitator.userId,
        participantType: "OBSERVER",
        leaseRole: "OBSERVER",
      },
      {
        userId: fixture.candidate.userId,
        participantType: "FACILITATOR",
        leaseRole: "FACILITATOR",
      },
    ]),
  );

  const newCookie = await createUserSessionCookie(fixture.candidate.userId);
  const startResponse = await postControl(request, {
    sessionId: fixture.sessionId,
    participantId: fixture.candidate.id,
    connectionId: newConnectionId,
    cookie: newCookie,
    action: "START_PREPARATION",
  });
  expect(startResponse.ok()).toBeTruthy();

  const oldCookie = await createUserSessionCookie(fixture.facilitator.userId);
  const oldResponse = await postControl(request, {
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.id,
    connectionId: oldConnectionId,
    cookie: oldCookie,
    action: "PAUSE_PREPARATION",
  });
  expect(oldResponse.status()).toBe(403);
});

test("Event facilitator preparation control remains unchanged", async ({ request }) => {
  const fixture = await createSessionFixture({ eventLinked: true });
  const connectionId = await createRoomConnectionForParticipant({
    sessionId: fixture.sessionId,
    userId: fixture.facilitator.userId,
    role: "FACILITATOR",
  });
  const cookie = await createUserSessionCookie(fixture.facilitator.userId);
  const response = await postControl(request, {
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.id,
    connectionId,
    cookie,
    action: "START_PREPARATION",
  });
  expect(response.ok()).toBeTruthy();
});

test("standalone duplicate auto-transcription admission runs once", async ({ request }) => {
  await expectConcurrentTranscriptionIsSingleFlight(
    request,
    await createSessionFixture(),
  );
});

test("Event duplicate transcription admission keeps existing single-run behavior", async ({
  request,
}) => {
  await expectConcurrentTranscriptionIsSingleFlight(
    request,
    await createSessionFixture({ eventLinked: true }),
  );
});

test("account Materials Notes becomes clean after persisting its edited draft @bug01-notes", async ({ page }) => {
  const fixture = await createSessionFixture();
  await query(`UPDATE "SessionParticipant" SET notes = $2 WHERE id = $1`, [
    fixture.facilitator.id,
    "A",
  ]);
  await authenticatePage(page, fixture.facilitator.userId);

  await page.goto(`/sessions/${fixture.sessionId}/materials`);
  const notes = page.getByTestId("materials-notes-textarea");
  await expect(notes).toHaveValue("A");
  await notes.fill("A");

  await notes.fill("B");
  await page.getByTestId("materials-notes-save-button").click();

  await expect(notes).toHaveValue("B");
  await expect(page.getByText("Notes saved.")).toBeVisible();
  await expect(page.getByText("Unsaved notes")).toHaveCount(0);
});

test("account Materials Notes keeps an in-flight newer draft dirty and preserves its baseline after failure @bug01-notes", async ({
  page,
}) => {
  const fixture = await createSessionFixture();
  await query(`UPDATE "SessionParticipant" SET notes = $2 WHERE id = $1`, [
    fixture.facilitator.id,
    "A",
  ]);
  await authenticatePage(page, fixture.facilitator.userId);

  await page.goto(`/sessions/${fixture.sessionId}/materials`);
  const notes = page.getByTestId("materials-notes-textarea");
  await expect(notes).toHaveValue("A");
  await notes.fill("A");

  let releaseSaveResponse: (() => void) | undefined;
  let notifySaveRequest: (() => void) | undefined;
  const saveRequestIntercepted = new Promise<void>((resolve) => {
    notifySaveRequest = resolve;
  });
  let holdNextSaveResponse = true;

  await page.route(`**/sessions/${fixture.sessionId}/materials`, async (route) => {
    const request = route.request();
    if (
      !holdNextSaveResponse ||
      request.method() !== "POST" ||
      !(await request.headerValue("next-action"))
    ) {
      await route.continue();
      return;
    }

    holdNextSaveResponse = false;
    const response = await route.fetch();
    notifySaveRequest?.();
    await new Promise<void>((resolve) => {
      releaseSaveResponse = resolve;
    });
    await route.fulfill({ response });
  });

  await notes.fill("B");
  await page.getByTestId("materials-notes-save-button").click();
  await saveRequestIntercepted;

  await notes.fill("C");
  releaseSaveResponse?.();

  await expect(notes).toHaveValue("C");
  await expect(page.getByText("Unsaved notes")).toBeVisible();
  await expect(page.getByText("Notes saved.")).toHaveCount(0);

  await page.locator('input[name="participantId"]').evaluate((input) => {
    (input as HTMLInputElement).value = "missing-participant";
  });
  await page.getByTestId("materials-notes-save-button").click();

  await expect(page.getByText("invalidRequest")).toBeVisible();
  await expect(notes).toHaveValue("C");
  await expect(page.getByText("Unsaved notes")).toBeVisible();

  await notes.fill("B");
  await expect(page.getByText("Unsaved notes")).toHaveCount(0);
});

test("early preparation finish waits for confirmation before one canonical control request", async ({
  page,
  request,
}) => {
  const fixture = await createSessionFixture();
  const seededConnectionId = await createRoomConnectionForParticipant({
    sessionId: fixture.sessionId,
    userId: fixture.facilitator.userId,
    role: "FACILITATOR",
  });
  const cookie = await createUserSessionCookie(fixture.facilitator.userId);
  const startedPreparation = await postControl(request, {
    sessionId: fixture.sessionId,
    participantId: fixture.facilitator.id,
    connectionId: seededConnectionId,
    cookie,
    action: "START_PREPARATION",
  });
  expect(startedPreparation.ok()).toBeTruthy();
  await authenticatePage(page, fixture.facilitator.userId);

  const controlActions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(`/api/sessions/${fixture.sessionId}/control`)
    ) {
      const payload = JSON.parse(request.postData() ?? "{}") as { action?: string };
      controlActions.push(payload.action ?? "");
    }
  });

  await page.goto(`/room/${fixture.sessionId}?media=off`);
  const stopButton = page.getByTestId("stop-preparation-button");
  await expect(stopButton).toBeVisible();
  const cookieBanner = page.getByTestId("cookie-banner");
  if (await cookieBanner.isVisible().catch(() => false)) {
    await page.getByTestId("cookie-accept-all").click();
    await expect(cookieBanner).toHaveCount(0);
  }

  await stopButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  expect(controlActions).toEqual([]);

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(controlActions).toEqual([]);

  await stopButton.click();
  await expect(dialog).toBeVisible();
  const confirmedControl = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/sessions/${fixture.sessionId}/control`),
  );
  await dialog.getByRole("button", { name: "Stop preparation", exact: true }).click();

  const controlRequest = await confirmedControl;
  expect(JSON.parse(controlRequest.postData() ?? "{}")).toMatchObject({
    action: "STOP_PREPARATION",
  });
  await expect.poll(() => controlActions).toEqual(["STOP_PREPARATION"]);
  expect(controlActions).not.toContain("PAUSE");
  expect(controlActions).not.toContain("RESUME");
});
