import {
  isVoxProviderFaultMode,
  type VoxProviderFaultMode,
} from "@/lib/voximplant/provider-fault-simulation";

const globalForMockServices = globalThis as unknown as {
  mockExternalServiceError?: string | null;
  voxProviderFaultMode?: VoxProviderFaultMode;
};

export function isExternalServicesMockMode() {
  return process.env.EXTERNAL_SERVICES_MODE === "mock";
}

export function isProductionRuntime() {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

/**
 * Post-processing Facilitator Lab exercises real materials/transcript APIs
 * against the isolated E2E database. It does not need LiveKit/Vox signaling.
 * The flag is non-production only: a production runtime ignores it entirely so
 * a stray environment variable can never suppress Product behavior.
 */
export function isPostTranscriptionLabMode() {
  if (isProductionRuntime()) return false;
  return process.env.POST_TRANSCRIPTION_LAB === "1";
}

/**
 * Realtime transport fails closed: production always connects LiveKit/Vox, and
 * only a non-production Lab runtime may suppress browser signaling.
 */
export function shouldConnectBrowserRealtimeTransport() {
  if (isProductionRuntime()) return true;
  return !isPostTranscriptionLabMode();
}

export function isRecordingMockMode() {
  return (
    process.env.RECORDING_MODE === "mock" ||
    process.env.EXTERNAL_SERVICES_MODE === "mock"
  );
}

export function isTranscriptionMockMode() {
  return (
    process.env.TRANSCRIPTION_MODE === "mock" ||
    process.env.EXTERNAL_SERVICES_MODE === "mock"
  );
}

export function isAiAnalysisMockMode() {
  return (
    process.env.AI_ANALYSIS_MODE === "mock" ||
    process.env.EXTERNAL_SERVICES_MODE === "mock"
  );
}

export function getMockExternalServiceError() {
  return (
    globalForMockServices.mockExternalServiceError ??
    process.env.MOCK_EXTERNAL_SERVICE_ERROR?.trim().toUpperCase() ??
    null
  );
}

export function isLiveSmokeEnabled() {
  return process.env.RUN_LIVE_SMOKE_TESTS === "true";
}

export function setMockExternalServiceError(error: string | null) {
  globalForMockServices.mockExternalServiceError = error
    ? error.trim().toUpperCase()
    : null;
}

/**
 * Scripted Voximplant transport outcome for E2E media-handoff tests. Always
 * `"off"` unless the server runs in external-services mock mode, so production
 * can never serve a simulated provider fault.
 */
export function getVoxProviderFaultMode(): VoxProviderFaultMode {
  if (!isExternalServicesMockMode()) return "off";
  const configured =
    globalForMockServices.voxProviderFaultMode ?? process.env.VOX_PROVIDER_FAULT_SIM;
  return isVoxProviderFaultMode(configured) ? configured : "off";
}

export function setVoxProviderFaultMode(mode: VoxProviderFaultMode) {
  globalForMockServices.voxProviderFaultMode = mode;
}

