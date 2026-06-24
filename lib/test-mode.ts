const globalForMockServices = globalThis as unknown as {
  mockExternalServiceError?: string | null;
};

export function isExternalServicesMockMode() {
  return process.env.EXTERNAL_SERVICES_MODE === "mock";
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

