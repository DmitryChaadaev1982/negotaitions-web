import { expect, type APIRequestContext, test } from "@playwright/test";

import {
  cleanupE2eData,
  countTranscripts,
  createManualTranscript,
  createE2eCase,
  createE2eEvent,
  getExternalServiceEvent,
  getExternalServiceNames,
  getEventParticipants,
  getRecordingBySession,
  getSession,
  getTranscriptText,
  participantByName,
  softDeleteCase,
  updateParticipantNotes,
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

  if (!buyerRole || !sellerRole) {
    throw new Error("E2E case roles were not created.");
  }

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
  return response.json() as Promise<{
    negotiationState: string;
    recording: { status: string; errorMessage: string | null } | null;
  }>;
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];

  if (!payload) {
    throw new Error("JWT payload missing.");
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");

  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as {
    sub?: string;
    metadata?: string;
  };
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

test("role privacy, preparation, negotiation recording, transcription, notes, and rejoin", async ({
  request,
  page,
}) => {
  const { session, facilitator, igor, alex, serg } =
    await createAssignedSession(request);

  const igorSidebar = await request.get(
    `/api/livekit/sidebar?joinToken=${igor.joinToken}`,
  );
  expect(igorSidebar.ok()).toBeTruthy();
  const igorSidebarText = await igorSidebar.text();
  expect(igorSidebarText).toContain("E2E_PRIVATE_IGOR_ONLY");
  expect(igorSidebarText).not.toContain("E2E_PRIVATE_ALEX_ONLY");

  const sergSidebar = await request.get(
    `/api/livekit/sidebar?joinToken=${serg.joinToken}`,
  );
  expect(await sergSidebar.text()).not.toContain("E2E_PRIVATE_IGOR_ONLY");

  const initialState = await request.get(
    `/api/sessions/${session.id}/control-state?joinToken=${facilitator.joinToken}`,
  );
  const initialStateBody = await initialState.json();
  expect(initialStateBody.negotiationState).toBe("PREPARATION");
  expect(initialStateBody.recording).toBeNull();

  expect(
    await control(request, session.id, facilitator.joinToken, "START_PREPARATION"),
  ).toMatchObject({ negotiationState: "PREPARATION_RUNNING", recording: null });
  expect(await getRecordingBySession(session.id)).toBeNull();

  expect(
    await control(request, session.id, facilitator.joinToken, "PAUSE_PREPARATION"),
  ).toMatchObject({ negotiationState: "PREPARATION_PAUSED", recording: null });
  expect(
    await control(request, session.id, facilitator.joinToken, "RESUME_PREPARATION"),
  ).toMatchObject({ negotiationState: "PREPARATION_RUNNING", recording: null });
  expect(
    await control(request, session.id, facilitator.joinToken, "STOP_PREPARATION"),
  ).toMatchObject({ negotiationState: "READY_TO_START", recording: null });

  const started = await control(request, session.id, facilitator.joinToken, "START");
  expect(started.negotiationState).toBe("RUNNING");
  expect(started.recording?.status).toBe("RECORDING");
  const firstRecording = await getRecordingBySession(session.id);
  expect(firstRecording).not.toBeNull();

  const paused = await control(request, session.id, facilitator.joinToken, "PAUSE");
  expect(paused.negotiationState).toBe("PAUSED");
  expect(paused.recording?.status).toBe("RECORDING");
  expect(await countTranscripts(session.id)).toBe(0);

  const resumed = await control(request, session.id, facilitator.joinToken, "RESUME");
  expect(resumed.negotiationState).toBe("RUNNING");
  const resumedRecording = await getRecordingBySession(session.id);
  expect(resumedRecording?.id).toBe(firstRecording?.id);

  const finished = await control(request, session.id, facilitator.joinToken, "FINISH");
  expect(finished.negotiationState).toBe("FINISHED");
  const completedRecording = await getRecordingBySession(session.id);
  expect(completedRecording?.status).toBe("COMPLETED");
  expect(completedRecording?.fileKey).toBeTruthy();

  const transcriptResponse = await request.post(
    `/api/sessions/${session.id}/transcribe-recording`,
    {
      data: {
        joinToken: facilitator.joinToken,
        recordingId: completedRecording!.id,
        languageHint: "auto",
      },
    },
  );
  expect(transcriptResponse.ok()).toBeTruthy();
  expect(await transcriptResponse.text()).toContain(
    "Mock transcript for NegotAItions regression test.",
  );

  const editedText = "E2E edited transcript persists";
  const saveTranscriptResponse = await request.post(
    `/api/sessions/${session.id}/transcript`,
    { data: { joinToken: facilitator.joinToken, text: editedText } },
  );
  expect(saveTranscriptResponse.ok()).toBeTruthy();

  const recordingResponse = await request.get(
    `/api/sessions/${session.id}/recording?joinToken=${facilitator.joinToken}`,
  );
  expect(await recordingResponse.text()).toContain(editedText);

  await updateParticipantNotes(igor.id, "E2E_NOTE_IGOR");
  await updateParticipantNotes(alex.id, "E2E_NOTE_ALEX");
  await updateParticipantNotes(serg.id, "E2E_NOTE_SERG");

  await page.goto(`/join/${igor.joinToken}`);
  await expect(page.getByText("E2E_NOTE_IGOR")).toBeVisible();
  await expect(page.getByText("E2E_NOTE_ALEX")).not.toBeVisible();

  const facilitatorNotes = await request.get(`/api/sessions/${session.id}/notes`);
  const facilitatorNotesText = await facilitatorNotes.text();
  expect(facilitatorNotesText).toContain("E2E_NOTE_IGOR");
  expect(facilitatorNotesText).toContain("E2E_NOTE_ALEX");
  expect(facilitatorNotesText).toContain("E2E_NOTE_SERG");

  const rejoinResponse = await request.post("/api/rejoin/validate", {
    data: {
      type: "SESSION_ROOM",
      sessionId: session.id,
      joinToken: igor.joinToken,
    },
  });
  const rejoinBody = await rejoinResponse.json();
  expect(rejoinBody.valid).toBe(true);
  expect(rejoinBody.primaryAction).toBe("materials");
  expect(rejoinBody.targetUrl).toContain(`/join/${igor.joinToken}`);
});

test("LiveKit tokens keep participant identity stable across duplicate connections", async ({
  request,
}) => {
  const { facilitator } = await createAssignedSession(request);

  const firstResponse = await request.post("/api/livekit/token", {
    data: { joinToken: facilitator.joinToken },
  });

  test.skip(firstResponse.status() === 503, "LiveKit is not configured.");
  expect(firstResponse.ok()).toBeTruthy();

  const secondResponse = await request.post("/api/livekit/token", {
    data: { joinToken: facilitator.joinToken },
  });
  expect(secondResponse.ok()).toBeTruthy();

  const firstBody = (await firstResponse.json()) as {
    token: string;
    participantId: string;
    participantType: string;
  };
  const secondBody = (await secondResponse.json()) as {
    token: string;
    participantId: string;
    participantType: string;
  };

  const firstPayload = decodeJwtPayload(firstBody.token);
  const secondPayload = decodeJwtPayload(secondBody.token);
  const firstMetadata = JSON.parse(firstPayload.metadata ?? "{}") as {
    participantId?: string;
    participantType?: string;
  };
  const secondMetadata = JSON.parse(secondPayload.metadata ?? "{}") as {
    participantId?: string;
    participantType?: string;
  };

  expect(firstBody.participantId).toBe(facilitator.id);
  expect(secondBody.participantId).toBe(facilitator.id);
  expect(firstBody.participantType).toBe("FACILITATOR");
  expect(secondBody.participantType).toBe("FACILITATOR");
  expect(firstPayload.sub).not.toBe(secondPayload.sub);
  expect(firstPayload.sub).toContain(facilitator.id);
  expect(secondPayload.sub).toContain(facilitator.id);
  expect(firstMetadata).toMatchObject({
    participantId: facilitator.id,
    participantType: "FACILITATOR",
  });
  expect(secondMetadata).toMatchObject({
    participantId: facilitator.id,
    participantType: "FACILITATOR",
  });
});

test("soft-deleted cases disappear from new event selection but old session snapshots remain", async ({
  request,
  page,
}) => {
  const { event, negotiationCase, session, igor } =
    await createAssignedSession(request);

  await softDeleteCase(negotiationCase.id);

  const oldSession = await getSession(session.id);
  expect(oldSession.snapshotCaseTitle).toBe(negotiationCase.title);

  await page.goto(`/join/${igor.joinToken}`);
  await expect(page.getByText("E2E public business context")).toBeVisible();
  await expect(page.getByText("E2E_PRIVATE_IGOR_ONLY")).toBeVisible();

  const freshEvent = await createE2eEvent({ withParticipants: true });
  const freshState = await request.get(
    `/api/events/${freshEvent.id}/state?hostToken=${freshEvent.hostToken}`,
  );
  expect(await freshState.text()).not.toContain(negotiationCase.title);

  const deletedEventState = await request.get(
    `/api/events/${event.id}/state?hostToken=${event.hostToken}`,
  );
  expect(deletedEventState.ok()).toBeTruthy();
});

test("mock external service failures are visible without blocking negotiation state", async ({
  request,
}) => {
  const { session, facilitator } = await createAssignedSession(request);

  await control(request, session.id, facilitator.joinToken, "SKIP_PREPARATION");
  await request.post("/api/test/mock-external-service", {
    data: { error: "LIVEKIT_QUOTA_EXCEEDED" },
  });

  const start = await control(request, session.id, facilitator.joinToken, "START");
  expect(start.negotiationState).toBe("RUNNING");
  expect(start.recording?.status).toBe("FAILED");

  const liveKitEvent = await getExternalServiceEvent(session.id, "LIVEKIT");
  expect(liveKitEvent?.errorCode).toBe("QUOTA_EXCEEDED");

  await request.post("/api/test/mock-external-service", {
    data: { error: null },
  });
  await control(request, session.id, facilitator.joinToken, "FINISH");

  const recording = await updateRecordingCompleted(session.id);
  await createManualTranscript(
    session.id,
    recording.id,
    "Existing transcript must survive provider errors",
  );

  await request.post("/api/test/mock-external-service", {
    data: { error: "YANDEX_STORAGE_DOWNLOAD_FAILED" },
  });
  const storageFailure = await request.post(
    `/api/sessions/${session.id}/transcribe-recording`,
    {
      data: {
        joinToken: facilitator.joinToken,
        recordingId: recording.id,
        languageHint: "auto",
      },
    },
  );
  expect(storageFailure.ok()).toBeFalsy();

  await request.post("/api/test/mock-external-service", {
    data: { error: "OPENAI_QUOTA_EXCEEDED" },
  });
  const openAiFailure = await request.post(
    `/api/sessions/${session.id}/transcribe-recording`,
    {
      data: {
        joinToken: facilitator.joinToken,
        recordingId: recording.id,
        languageHint: "auto",
      },
    },
  );
  expect(openAiFailure.ok()).toBeFalsy();

  expect(await getTranscriptText(session.id)).toBe(
    "Existing transcript must survive provider errors",
  );

  const providerEvents = await getExternalServiceNames(session.id);
  expect(providerEvents).toEqual(
    expect.arrayContaining(["LIVEKIT", "YANDEX_OBJECT_STORAGE", "OPENAI"]),
  );
});

