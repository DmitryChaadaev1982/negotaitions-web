export const OLD_TRANSCRIBE_ROUTE_MODE = "CANONICAL_ADAPTER" as const;

export function materialsTranscribePath(sessionId: string): string {
  return `/api/sessions/${sessionId}/materials/transcribe`;
}

export function materialsRetranscribePath(sessionId: string): string {
  return `/api/sessions/${sessionId}/materials/retranscribe`;
}

export function compatibilityTranscribeRecordingPath(sessionId: string): string {
  return `/api/sessions/${sessionId}/transcribe-recording`;
}

export function silentLegacyTranscribeFallbackEnabled(): false {
  return false;
}

export function nextTranscriptionActionAfterCanonicalFailure(): "retry_canonical" {
  return "retry_canonical";
}
