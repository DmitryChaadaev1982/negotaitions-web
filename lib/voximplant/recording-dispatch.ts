import "server-only";

/**
 * Architecture: docs/architecture/05-voximplant-integration.md
 * Architecture: docs/architecture/06-recording-transcription-pipeline.md
 */

/**
 * Stage 5.4.6 — Voximplant recording persistence helpers added.
 *
 * Stage 5.3 — Voximplant recording provider dispatch bridge.
 *
 * Architecture:
 *   - The recording-control route is the shared orchestration facade.
 *   - For LiveKit: lib/livekit-egress.ts handles dispatch (unchanged).
 *   - For Voximplant: this module handles dispatch.
 *
 * Voximplant recording communication model:
 *   - VoxEngine scenario manages actual recording.
 *   - Server ↔ scenario communication goes through the Voximplant SDK message
 *     channel (browser sends typed RecordingControlMessage to the conference;
 *     the scenario responds with RecordingStatusMessage).
 *   - The recording-control route validates permissions and returns a typed
 *     RecordingControlMessage. The browser Voximplant adapter is responsible
 *     for relaying this message to the SDK conference object.
 *
 * Why not a direct server→scenario push (Stage 5.3 deferral note):
 *   The Voximplant Management API does not expose a general "send message to
 *   running conference" endpoint. The standard pattern is browser→scenario
 *   via Conference.sendMessage() / Conference.MessagingAPIMessage. A
 *   server-push path would require a custom HTTP webhook endpoint within
 *   the VoxEngine scenario (CallService or HTTP requests from the scenario),
 *   which is a Stage 5.4 work item once the scenario HTTP callback pattern
 *   is approved and tested.
 *
 * Stage 5.4 next step:
 *   Implement a server-side recording status store (Redis or DB polling
 *   endpoint) so the recording-control route can push commands directly
 *   to the scenario via a registered HTTP callback. Until then, the browser
 *   relays the command and polls for status via the same recording-control
 *   endpoint.
 *
 * Recording policy (Stage 5.3):
 *   - Default: audio-only (VOXIMPLANT_RECORDING_AUDIO_ONLY=true).
 *   - Audio mode: lossless preferred; hd_mp3 as configured fallback.
 *   - Do NOT combine lossless + hd_audio.
 *   - Visible UI: start/stop only (no visible pause/resume in Stage 5.3).
 *   - Pause/resume may remain internal/flagged but must not appear in UI.
 */

import { nanoid } from "nanoid";
import {
  RecordingStatus as DbRecordingStatus,
  RecordingType,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { RoomRecordingState } from "@/lib/room-provider/types";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  createRecordingControlMessage,
  type RecordingControlAction,
  type RecordingControlMessage,
  type RecordingStatus,
  type VoximplantRoomRole,
} from "@/lib/voximplant/scenario-messages";
import { getVoximplantConfig } from "@/lib/voximplant/config";
import { getVoximplantRecordingWebhookBaseUrl } from "@/lib/voximplant/recording-webhook-url";

/** Maps the recording-control route actions to the scenario message actions. */
function mapActionToScenarioAction(
  action: "start" | "stop" | "refresh",
): RecordingControlAction {
  if (action === "start") return "start";
  if (action === "stop") return "stop";
  return "status";
}

/**
 * Maps a Voximplant scenario RecordingStatus to the common recording status model
 * used by the recording-control route response (matches the LiveKit DB status values
 * so the shared UI RecordingIndicator can handle both without branching).
 */
export function mapScenarioStatusToCommon(
  scenarioStatus: RecordingStatus,
): string {
  switch (scenarioStatus) {
    case "idle":
    case "not_recording":
      return "NOT_STARTED";
    case "starting":
      return "STARTING";
    case "recording":
      return "RECORDING";
    case "stopping":
      return "STOPPING";
    case "stopped":
      return "STOPPED";
    case "error":
      return "FAILED";
    case "paused":
    case "resuming":
      // Visible UI shows no pause/resume; map to RECORDING for indicator purposes.
      return "RECORDING";
    default:
      return "NOT_STARTED";
  }
}

export type VoximplantRecordingDispatchResult = {
  ok: boolean;
  /**
   * The typed scenario message to relay to the Voximplant conference via the
   * browser SDK. The browser Voximplant adapter must call
   * conference.sendMessage(JSON.stringify(scenarioMessage)) after receiving
   * this response.
   */
  scenarioMessage: RecordingControlMessage;
  /**
   * Voximplant recording config from the environment (audio mode, audio-only flag).
   * The scenario uses this to initialize recording parameters.
   */
  recordingConfig: {
    audioOnly: boolean;
    audioMode: "lossless" | "hd_mp3";
    pauseEnabled: boolean;
  };
  /** Human-readable warning when config is partially missing. */
  warning?: string;
  /**
   * Common recording status placeholder while the scenario processes the command.
   * The browser adapter should poll and update once the scenario responds.
   */
  recordingStatusPending: string;
};

/**
 * Build a Voximplant recording dispatch result for the given action.
 *
 * This does NOT directly communicate with the Voximplant Management API or the
 * running scenario — it builds the typed message payload that the browser adapter
 * will relay to the conference via the SDK.
 *
 * @param action - "start" | "stop" | "refresh"
 * @param context - Caller context for the message (sessionId, participantId, role)
 */
export async function buildVoximplantRecordingDispatch(
  action: "start" | "stop" | "refresh",
  context: {
    sessionId: string;
    participantId?: string;
    role?: VoximplantRoomRole;
  },
): Promise<VoximplantRecordingDispatchResult> {
  let config;
  let warning: string | undefined;

  try {
    config = getVoximplantConfig({ provider: "voximplant", requireForRuntime: true });
  } catch {
    config = getVoximplantConfig({ provider: "voximplant", requireForRuntime: false });
    warning =
      "Voximplant recording config is incomplete. Recording command queued but may not execute.";
  }

  const scenarioAction = mapActionToScenarioAction(action);
  const conferenceName = buildVoximplantConferenceName(context.sessionId);
  const webhookBaseUrl = await getVoximplantRecordingWebhookBaseUrl();
  const scenarioMessage = createRecordingControlMessage(scenarioAction, {
    requestId: nanoid(12),
    sessionId: context.sessionId,
    conferenceName,
    ...(webhookBaseUrl ? { webhookBaseUrl } : {}),
    participantId: context.participantId,
    role: context.role,
  });

  const recordingConfig = {
    audioOnly: config.recording.audioOnly,
    audioMode: config.recording.audioMode,
    pauseEnabled: config.recording.pauseEnabled,
  };

  const recordingStatusPending =
    action === "start"
      ? "STARTING"
      : action === "stop"
        ? "STOPPING"
        : "NOT_STARTED";

  return {
    ok: true,
    scenarioMessage,
    recordingConfig,
    warning,
    recordingStatusPending,
  };
}

// ─── Statuses that indicate recording is already active or done on start ─────

const DO_NOT_OVERWRITE_ON_START = new Set<DbRecordingStatus>([
  DbRecordingStatus.STARTING,
  DbRecordingStatus.RECORDING,
  DbRecordingStatus.PAUSED,
  DbRecordingStatus.PROCESSING,
  DbRecordingStatus.COMPLETED,
]);

type PersistedRecordingRef = {
  id: string;
  status: DbRecordingStatus;
  errorMessage: string | null;
};

/**
 * Create or update a Recording row for a Voximplant session on start.
 *
 * Rules:
 *  - If no row: create with STARTING.
 *  - If row is already STARTING/RECORDING/PAUSED/PROCESSING/COMPLETED: return as-is
 *    (idempotent — repeated start does not create duplicates or overwrite active/terminal state).
 *  - Otherwise (NOT_STARTED/FAILED/STOPPED): update to STARTING.
 *
 * Diagnostic log: non-secret, logs recordingId and status.
 */
export async function upsertVoximplantRecordingOnStart(
  sessionId: string,
): Promise<PersistedRecordingRef> {
  const existing = await prisma.recording.findUnique({
    where: { sessionId },
    select: { id: true, status: true, errorMessage: true },
  });

  if (!existing) {
    const created = await prisma.recording.create({
      data: {
        sessionId,
        provider: "VOXIMPLANT",
        status: DbRecordingStatus.STARTING,
        recordingType: RecordingType.AUDIO_ONLY,
        startedAt: new Date(),
        errorMessage: null,
      },
      select: { id: true, status: true, errorMessage: true },
    });
    console.log(
      `[recording-control] vox start: created recordingId=${created.id} status=${created.status}`,
    );
    return created;
  }

  if (DO_NOT_OVERWRITE_ON_START.has(existing.status)) {
    console.log(
      `[recording-control] vox start: idempotent recordingId=${existing.id} status=${existing.status}`,
    );
    return existing;
  }

  const updated = await prisma.recording.update({
    where: { id: existing.id },
    data: {
      status: DbRecordingStatus.STARTING,
      errorMessage: null,
      startedAt: new Date(),
    },
    select: { id: true, status: true, errorMessage: true },
  });
  console.log(
    `[recording-control] vox start: updated recordingId=${updated.id} status=${updated.status}`,
  );
  return updated;
}

/**
 * Create or update a Recording row for a Voximplant session on stop.
 *
 * Rules:
 *  - STOPPING is not a valid RecordingStatus enum value; STOPPED is used instead.
 *  - If no row: create a recoverable row with STOPPED so the webhook can upgrade to COMPLETED.
 *  - If row is COMPLETED: return as-is (do not overwrite terminal state).
 *  - If row is already STOPPED or FAILED: return as-is (idempotent).
 *  - Otherwise (STARTING/RECORDING/PAUSED/PROCESSING/NOT_STARTED): update to STOPPED.
 *
 * Diagnostic log: non-secret, logs recordingId and status.
 */
export async function upsertVoximplantRecordingOnStop(
  sessionId: string,
): Promise<PersistedRecordingRef> {
  const existing = await prisma.recording.findUnique({
    where: { sessionId },
    select: { id: true, status: true, errorMessage: true },
  });

  if (!existing) {
    const created = await prisma.recording.create({
      data: {
        sessionId,
        provider: "VOXIMPLANT",
        status: DbRecordingStatus.STOPPED,
        recordingType: RecordingType.AUDIO_ONLY,
        endedAt: new Date(),
      },
      select: { id: true, status: true, errorMessage: true },
    });
    console.log(
      `[recording-control] vox stop: created recoverable recordingId=${created.id} status=${created.status}`,
    );
    return created;
  }

  if (
    existing.status === DbRecordingStatus.COMPLETED ||
    existing.status === DbRecordingStatus.STOPPED ||
    existing.status === DbRecordingStatus.FAILED
  ) {
    console.log(
      `[recording-control] vox stop: idempotent recordingId=${existing.id} status=${existing.status}`,
    );
    return existing;
  }

  const updated = await prisma.recording.update({
    where: { id: existing.id },
    data: {
      status: DbRecordingStatus.STOPPED,
      endedAt: new Date(),
    },
    select: { id: true, status: true, errorMessage: true },
  });
  console.log(
    `[recording-control] vox stop: updated recordingId=${updated.id} status=${updated.status}`,
  );
  return updated;
}

/**
 * Read the canonical Recording DB row for Voximplant refresh responses.
 * Returns NOT_STARTED when no row exists yet.
 */
export async function getVoximplantRecordingStateFromDb(
  sessionId: string,
): Promise<NonNullable<RoomRecordingState>> {
  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: { status: true, errorMessage: true },
  });

  if (!recording) {
    return { status: "NOT_STARTED", errorMessage: null };
  }

  return {
    status: recording.status,
    errorMessage: recording.errorMessage,
  };
}
