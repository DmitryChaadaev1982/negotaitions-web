import { nanoid } from "nanoid";

import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  createSignedRecordingControlMessage,
  normalizeRecordingWebhookOrigin,
} from "@/lib/voximplant/recording-control-signature";
import type {
  RecordingControlAction,
  RecordingControlMessage,
} from "@/lib/voximplant/scenario-messages";

export function mapDispatchActionToScenarioAction(
  action: "start" | "stop" | "refresh",
): RecordingControlAction {
  if (action === "start") return "start";
  if (action === "stop") return "stop";
  return "status";
}

export function buildSignedRecordingDispatchPayload(input: {
  action: "start" | "stop" | "refresh";
  sessionId: string;
  participantId: string;
  controllerUserId: string;
  controllerRole: string;
  canControlRecording: boolean;
  webhookBaseUrlRaw: string;
  signingSecret: string;
  requestId?: string;
  recordingAttemptId?: string;
  issuedAt?: number;
  expiresAt?: number;
  nonce?: string;
  ttlSeconds?: number;
}): {
  scenarioMessage: RecordingControlMessage;
  scenarioMessageText: string;
  recordingStatusPending: string;
} {
  const scenarioAction = mapDispatchActionToScenarioAction(input.action);
  const conferenceName = buildVoximplantConferenceName(input.sessionId);
  const webhookBaseUrl = normalizeRecordingWebhookOrigin(input.webhookBaseUrlRaw);
  if (!webhookBaseUrl) {
    throw new Error(
      `Invalid effective Voximplant webhook base URL "${input.webhookBaseUrlRaw}". Allowed origins: https://local.negotaitions.ru, https://negotaitions.ru.`,
    );
  }

  const signed = createSignedRecordingControlMessage({
    secret: input.signingSecret,
    action: scenarioAction,
    requestId: input.requestId?.trim() || nanoid(12),
    recordingAttemptId: input.recordingAttemptId,
    sessionId: input.sessionId,
    conferenceName,
    participantId: input.participantId,
    controllerUserId: input.controllerUserId,
    controllerRole: input.controllerRole,
    canControlRecording: input.canControlRecording,
    webhookBaseUrl,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    ttlSeconds: input.ttlSeconds,
  });

  const recordingStatusPending =
    input.action === "start"
      ? "STARTING"
      : input.action === "stop"
        ? "STOPPING"
        : "NOT_STARTED";

  return {
    scenarioMessage: signed.message,
    scenarioMessageText: signed.scenarioMessageText,
    recordingStatusPending,
  };
}
