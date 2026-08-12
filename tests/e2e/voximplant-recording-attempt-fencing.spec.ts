import { createHmac } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  getRecordingDisplayPresentation,
  getRecordingDisplayState,
} from "@/lib/recording-display-state";
import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createUserSessionCookie,
  e2eId,
  query,
} from "./helpers/db";

const FENCED_PROTOCOL = "rc3-hmac-sha256-recording-attempt-v1";
const TIMEOUT_REASON = "RECORDING_STARTING_TIMEOUT_RECONCILED";

function sign(body: string) {
  const secret = process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET;
  if (!secret) throw new Error("VOXIMPLANT_RECORDING_WEBHOOK_SECRET is required.");
  return `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function postCallback(
  request: APIRequestContext,
  sessionId: string,
  payload: Record<string, unknown>,
) {
  const body = JSON.stringify(payload);
  return request.post(
    `/api/sessions/${encodeURIComponent(sessionId)}/voximplant/recording-status`,
    {
      headers: {
        "content-type": "application/json",
        "x-voximplant-signature": sign(body),
      },
      data: payload,
    },
  );
}

async function createSession(input: { eventCreated: boolean }) {
  const negotiationCase = await createE2eCase();
  const facilitator = await createActiveUser();
  const facilitatorId = facilitator.id;

  let eventId: string | null = null;
  if (input.eventCreated) {
    eventId = e2eId("recording_fence_event");
    await query(
      `INSERT INTO "TrainingEvent"
        ("id", "title", "hostUserId", "facilitatorUserId",
         "publicJoinCode", "hostToken", "updatedAt")
       VALUES ($1, 'E2E Recording Fence Event', $2, $2, $3, $4, NOW())`,
      [eventId, facilitatorId, e2eId("join"), e2eId("host")],
    );
  }

  const sessionId = e2eId(
    input.eventCreated ? "event_recording_fence" : "standalone_recording_fence",
  );
  await query(
    `INSERT INTO "Session"
      ("id", "negotiationCaseId", "facilitatorId", "eventId", "title",
       "snapshotCaseTitle", "snapshotBusinessContext",
       "snapshotPublicInstructions", "snapshotCaseLanguage",
       "preparationDurationSeconds", "durationSeconds", "updatedAt")
     VALUES ($1, $2, $3, $4, 'E2E Recording Fencing', $5,
       'E2E context', 'E2E instructions', 'EN', 300, 900, NOW())`,
    [sessionId, negotiationCase.id, facilitatorId, eventId, negotiationCase.title],
  );
  const facilitatorParticipantId = e2eId("recording_fence_facilitator");
  const facilitatorJoinToken = e2eId("recording_fence_join");
  await query(
    `INSERT INTO "SessionParticipant"
      ("id", "sessionId", "userId", "type", "joinToken", "displayName",
       "notes", "updatedAt")
     VALUES ($1, $2, $3, 'FACILITATOR', $4, 'E2E Facilitator', '', NOW())`,
    [
      facilitatorParticipantId,
      sessionId,
      facilitatorId,
      facilitatorJoinToken,
    ],
  );
  return {
    sessionId,
    facilitatorParticipantId,
    facilitatorCookie: await createUserSessionCookie(facilitatorId),
  };
}

async function setAttempt(
  sessionId: string,
  input: {
    attemptId: string;
    status: "STARTING" | "RECORDING" | "STOPPED" | "FAILED";
    errorMessage?: string | null;
  },
) {
  await query(
    `INSERT INTO "Recording"
      ("id", "sessionId", "provider", "status", "recordingAttemptId",
       "recordingType", "startedAt", "errorMessage", "updatedAt")
     VALUES ($1, $2, 'VOXIMPLANT', $3, $4, 'AUDIO_ONLY', NOW(), $5, NOW())
     ON CONFLICT ("sessionId") DO UPDATE SET
       "status" = EXCLUDED."status",
       "recordingAttemptId" = EXCLUDED."recordingAttemptId",
       "egressId" = NULL,
       "fileKey" = NULL,
       "endedAt" = NULL,
       "errorMessage" = EXCLUDED."errorMessage",
       "updatedAt" = NOW()`,
    [
      e2eId("recording"),
      sessionId,
      input.status,
      input.attemptId,
      input.errorMessage ?? null,
    ],
  );
}

test.describe("Voximplant recording attempt fencing", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET,
    "Webhook secret is required for signed callback tests.",
  );

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  for (const eventCreated of [false, true]) {
    test(`${eventCreated ? "Event-created" : "standalone"} current callback is authoritative and duplicate-safe`, async ({
      request,
    }) => {
      const { sessionId } = await createSession({ eventCreated });
      const attemptId = e2eId("attempt_current");
      await setAttempt(sessionId, { attemptId, status: "STARTING" });

      const payload = {
        protocolVersion: FENCED_PROTOCOL,
        status: "recording",
        requestId: e2eId("start_command"),
        recordingAttemptId: attemptId,
        recordingId: e2eId("provider_recording"),
        startedAt: new Date().toISOString(),
      };
      const first = await postCallback(request, sessionId, payload);
      expect(first.status()).toBe(200);

      const duplicate = await postCallback(request, sessionId, payload);
      expect(duplicate.status()).toBe(200);
      expect((await duplicate.json()).duplicate).toBe(true);

      const rows = await query<{
        status: string;
        recordingAttemptId: string;
      }>(
        `SELECT "status", "recordingAttemptId"
         FROM "Recording" WHERE "sessionId" = $1`,
        [sessionId],
      );
      expect(rows[0]).toEqual({
        status: "RECORDING",
        recordingAttemptId: attemptId,
      });
    });
  }

  for (const eventCreated of [false, true]) {
    test(`${eventCreated ? "Event-created" : "standalone"} obsolete A browser/status traffic cannot change current B indicator`, async ({
      request,
    }) => {
      const {
        sessionId,
        facilitatorParticipantId,
        facilitatorCookie,
      } = await createSession({ eventCreated });
      const attemptA = e2eId("attempt_a");
      const attemptB = e2eId("attempt_b");
      await setAttempt(sessionId, {
        attemptId: attemptA,
        status: "FAILED",
        errorMessage: TIMEOUT_REASON,
      });
      await setAttempt(sessionId, { attemptId: attemptB, status: "RECORDING" });

      const obsoleteCallbacks = [
        {
          status: "recording",
          requestId: e2eId("late_started_a"),
          recordingId: e2eId("provider_a"),
          startedAt: new Date().toISOString(),
        },
        {
          status: "stopped",
          requestId: e2eId("late_stopped_a"),
          recordingId: e2eId("provider_a"),
          objectKey: `negotiation-room/audio/${e2eId("object_a")}.flac`,
          stoppedAt: new Date().toISOString(),
        },
        {
          status: "error",
          requestId: e2eId("late_error_a"),
          recordingId: e2eId("provider_a"),
          errorCode: "LATE_A_ERROR",
          message: "Late obsolete recorder error",
        },
      ];
      for (const callback of obsoleteCallbacks) {
        const response = await postCallback(request, sessionId, {
          protocolVersion: FENCED_PROTOCOL,
          recordingAttemptId: attemptA,
          ...callback,
        });
        expect(response.status()).toBe(409);
        expect((await response.json()).code).toBe(
          "OBSOLETE_RECORDING_ATTEMPT",
        );
      }

      const rows = await query<{
        status: string;
        recordingAttemptId: string;
        fileKey: string | null;
        egressId: string | null;
        errorMessage: string | null;
      }>(
        `SELECT "status", "recordingAttemptId", "fileKey", "egressId", "errorMessage"
         FROM "Recording" WHERE "sessionId" = $1`,
        [sessionId],
      );
      expect(rows[0]).toEqual({
        status: "RECORDING",
        recordingAttemptId: attemptB,
        fileKey: null,
        egressId: null,
        errorMessage: null,
      });

      const connectionId = e2eId("recording_fence_connection");
      const canonicalStateResponse = await request.get(
        `/api/sessions/${sessionId}/control-state` +
          `?participantId=${facilitatorParticipantId}` +
          `&connectionId=${connectionId}&claimLease=1`,
        { headers: { Cookie: facilitatorCookie } },
      );
      expect(canonicalStateResponse.ok()).toBeTruthy();
      const canonicalState = (await canonicalStateResponse.json()) as {
        recording: {
          status: string;
          recordingAttemptId: string | null;
        } | null;
      };
      expect(canonicalState.recording).toEqual(
        expect.objectContaining({
          status: "RECORDING",
          recordingAttemptId: attemptB,
        }),
      );
      const displayState = getRecordingDisplayState({
        recordingStatus: canonicalState.recording?.status,
      });
      expect(displayState).toBe("active");
      expect(getRecordingDisplayPresentation(displayState).labelKey).toBe(
        "recording.recordingInProgress",
      );
    });
  }

  test("standalone facilitator reassignment keeps browser STOP relay on current RC3 attempt", async ({
    request,
  }) => {
    const {
      sessionId,
      facilitatorParticipantId: formerFacilitatorParticipantId,
    } = await createSession({ eventCreated: false });
    const currentFacilitator = await createActiveUser();
    const currentFacilitatorParticipantId = e2eId(
      "recording_reassigned_facilitator",
    );
    const currentFacilitatorJoinToken = e2eId(
      "recording_reassigned_facilitator_join",
    );
    const currentFacilitatorCookie = await createUserSessionCookie(
      currentFacilitator.id,
    );
    const attemptId = e2eId("attempt_reassigned_relay");
    const operationId =
      `stop:${e2eId("recording_reassigned")}:${attemptId}:` +
      "room_facilitator_finish";

    await query(
      `UPDATE "SessionParticipant"
       SET "type" = 'PARTICIPANT', "updatedAt" = NOW()
       WHERE "id" = $1`,
      [formerFacilitatorParticipantId],
    );
    await query(
      `INSERT INTO "SessionParticipant"
        ("id", "sessionId", "userId", "type", "joinToken", "displayName",
         "notes", "updatedAt")
       VALUES ($1, $2, $3, 'FACILITATOR', $4,
         'E2E Reassigned Facilitator', '', NOW())`,
      [
        currentFacilitatorParticipantId,
        sessionId,
        currentFacilitator.id,
        currentFacilitatorJoinToken,
      ],
    );
    await query(
      `UPDATE "Session"
       SET "facilitatorId" = $2, "negotiationState" = 'FINISHED',
           "roomLifecycle" = 'DEBRIEF_OPEN', "updatedAt" = NOW()
       WHERE "id" = $1`,
      [sessionId, currentFacilitator.id],
    );
    await setAttempt(sessionId, { attemptId, status: "RECORDING" });
    const recordings = await query<{ id: string }>(
      `SELECT "id" FROM "Recording" WHERE "sessionId" = $1`,
      [sessionId],
    );
    await query(
      `INSERT INTO "SessionRecordingStopOperation"
        ("id", "sessionId", "recordingId", "provider", "requestedByMode",
         "requestReason", "operationId", "state", "attemptCount",
         "lastError", "lastErrorClass", "failedAt", "updatedAt")
       VALUES ($1, $2, $3, 'VOXIMPLANT', 'FACILITATOR',
         'room_facilitator_finish', $4, 'FAILED', 1,
         'Server stop unavailable', 'VOXIMPLANT_SERVER_CONTROL_UNAVAILABLE',
         NOW(), NOW())`,
      [e2eId("recording_stop_operation"), sessionId, recordings[0].id, operationId],
    );

    const response = await request.post(
      `/api/sessions/${sessionId}/recording-control`,
      {
        headers: { Cookie: currentFacilitatorCookie },
        data: {
          participantId: currentFacilitatorParticipantId,
          action: "relay_stop",
          stopOperationId: operationId,
        },
      },
    );
    const payload = (await response.json()) as {
      stopRelay: {
        operationId: string;
        scenarioMessage: {
          claims: {
            protocolVersion: string;
            recordingAttemptId?: string;
            requestId: string;
          };
        };
      };
    };
    expect(response.status(), JSON.stringify(payload)).toBe(200);
    expect(payload.stopRelay.operationId).toBe(operationId);
    expect(payload.stopRelay.scenarioMessage.claims).toEqual(
      expect.objectContaining({
        protocolVersion: FENCED_PROTOCOL,
        recordingAttemptId: attemptId,
        requestId: operationId,
      }),
    );
  });

  test("lost RECORDING callback still permits fenced STOP for exact STARTING RC3 attempt", async ({
    request,
  }) => {
    const {
      sessionId,
      facilitatorParticipantId,
      facilitatorCookie,
    } = await createSession({ eventCreated: false });
    const attemptId = e2eId("attempt_lost_started_callback");
    await setAttempt(sessionId, { attemptId, status: "STARTING" });
    await query(
      `UPDATE "Session"
       SET "status" = 'READY',
           "negotiationState" = 'RUNNING',
           "roomLifecycle" = 'OPEN',
           "negotiationStartedAt" = NOW() - INTERVAL '1 minute',
           "timerStartedAt" = NOW() - INTERVAL '1 minute',
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [sessionId],
    );
    const connectionId = e2eId("lost_callback_finish");
    const stateResponse = await request.get(
      `/api/sessions/${sessionId}/control-state` +
        `?participantId=${facilitatorParticipantId}` +
        `&connectionId=${connectionId}&claimLease=1`,
      { headers: { Cookie: facilitatorCookie } },
    );
    expect(stateResponse.ok()).toBeTruthy();
    const state = (await stateResponse.json()) as {
      negotiationState: string;
      controlToken: string;
    };

    const finish = await request.post(`/api/sessions/${sessionId}/control`, {
      headers: {
        Cookie: facilitatorCookie,
        "Content-Type": "application/json",
      },
      data: {
        participantId: facilitatorParticipantId,
        connectionId,
        action: "FINISH",
        expectedNegotiationState: state.negotiationState,
        expectedControlToken: state.controlToken,
      },
    });
    expect(finish.ok(), await finish.text()).toBeTruthy();

    const operations = await query<{
      state: string;
      lastErrorClass: string | null;
      fallbackPayload: {
        claims?: {
          protocolVersion?: string;
          recordingAttemptId?: string;
          action?: string;
        };
      } | null;
    }>(
      `SELECT "state", "lastErrorClass", "fallbackPayload"
       FROM "SessionRecordingStopOperation"
       WHERE "sessionId" = $1`,
      [sessionId],
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]?.lastErrorClass).not.toContain(
      "RECORDING_STARTING_NOT_READY",
    );
    if (operations[0]?.fallbackPayload) {
      expect(operations[0].fallbackPayload.claims).toEqual(
        expect.objectContaining({
          protocolVersion: FENCED_PROTOCOL,
          recordingAttemptId: attemptId,
          action: "stop",
        }),
      );
    }
  });

  test("missing attempt and unsafe key are deterministic non-retryable rejections", async ({
    request,
  }) => {
    const { sessionId } = await createSession({ eventCreated: false });
    const attemptId = e2eId("attempt_validation");
    await setAttempt(sessionId, { attemptId, status: "STARTING" });

    const missing = await postCallback(request, sessionId, {
      status: "recording",
      requestId: e2eId("missing_attempt"),
    });
    expect(missing.status()).toBe(409);
    expect((await missing.json()).code).toBe("MISSING_RECORDING_ATTEMPT_ID");

    const unsafe = await postCallback(request, sessionId, {
      protocolVersion: FENCED_PROTOCOL,
      status: "stopped",
      requestId: e2eId("unsafe_key"),
      recordingAttemptId: attemptId,
      objectKey: "https://evil.example/recording.flac",
    });
    expect(unsafe.status()).toBe(400);
    expect((await unsafe.json()).code).toBe("UNSAFE_RECORDING_OBJECT_KEY");
  });

  test("stale timeout reconciliation CAS cannot fail a newer attempt", async () => {
    const { sessionId } = await createSession({ eventCreated: false });
    const attemptA = e2eId("timeout_a");
    const attemptB = e2eId("timeout_b");
    await setAttempt(sessionId, { attemptId: attemptA, status: "STARTING" });

    // The reconciler captured A, then B became current before its delayed CAS.
    await setAttempt(sessionId, { attemptId: attemptB, status: "STARTING" });
    const staleMutation = await query<{ id: string }>(
      `UPDATE "Recording"
       SET "status" = 'FAILED',
           "errorMessage" = $3,
           "updatedAt" = NOW()
       WHERE "sessionId" = $1
         AND "recordingAttemptId" = $2
         AND "status" = 'STARTING'
       RETURNING "id"`,
      [sessionId, attemptA, TIMEOUT_REASON],
    );
    expect(staleMutation).toHaveLength(0);

    const rows = await query<{ status: string; recordingAttemptId: string }>(
      `SELECT "status", "recordingAttemptId"
       FROM "Recording" WHERE "sessionId" = $1`,
      [sessionId],
    );
    expect(rows[0]).toEqual({
      status: "STARTING",
      recordingAttemptId: attemptB,
    });
  });
});
