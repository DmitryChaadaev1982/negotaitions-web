export type RecordingTranscriptionPresentation = "roomQuick" | "materialsDetail";

export type RecordingTranscriptionSurface = "roomSidebar" | "materialsPage";

export function resolveRecordingTranscriptionPresentation(
  surface: RecordingTranscriptionSurface,
): RecordingTranscriptionPresentation {
  return surface === "roomSidebar" ? "roomQuick" : "materialsDetail";
}

export function showRecordingStatusDetail(
  presentation: RecordingTranscriptionPresentation,
): boolean {
  return presentation === "materialsDetail";
}

export function showTranscriptLanguageSelector(
  presentation: RecordingTranscriptionPresentation,
): boolean {
  return presentation === "materialsDetail";
}
