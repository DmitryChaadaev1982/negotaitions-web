import type { PostTranscriptionLabScenarioDefinition } from "./post-transcription-lab-catalog";

export type LabBriefingSession = {
  sessionId: string;
  sessionTitle: string;
};

export type LabDomainSnapshot = {
  sessionStatus: string;
  negotiationState: string;
  roomLifecycle: string | null;
  recordingStatus: string | null;
  transcriptStatus: string | null;
  transcriptId: string | null;
  retranscribeCount: number | null;
  speakerMappingStatus: string | null;
  speakerMappingConfirmedAt: string | null;
  speakerMappingConfirmedBy: string | null;
  enhancementStatus: string | null;
  mappingSuggestion: unknown;
  processingMetadataKeys: string[];
  segmentCount: number;
  mappedSpokenSegmentCount: number;
  aiStatus: string | null;
  aiTranscriptId: string | null;
  aiRetranscribeCount: number | null;
  aiInputFingerprint: string | null;
  publicationActive: boolean;
};

export type LabReadinessSnapshot = {
  transcriptUsable: boolean;
  enhancementTerminal: boolean;
  speakerMappingReadyForAnalysis: boolean;
  aiReadyByCurrentContract: boolean;
  aiReadyReason: string;
  sessionsListMappingStage: string | null;
  materialsRailMappingStage: string;
};

export type LabPresentationSnapshot = {
  materialsStatus?: unknown;
  note: string;
};

export function formatLabBriefing(input: {
  definition: PostTranscriptionLabScenarioDefinition;
  seeded: LabBriefingSession;
  domain: LabDomainSnapshot;
  readiness: LabReadinessSnapshot;
  presentation: LabPresentationSnapshot;
}): string {
  const lines = [
    "======================================================================",
    "SCENARIO",
    `${input.definition.id} — ${input.definition.title}`,
    `FIXTURE_CLASS = ${input.definition.fixtureClass ?? "STATE_FIXTURE"}`,
    `sessionId=${input.seeded.sessionId}`,
    `title=${input.seeded.sessionTitle}`,
    "",
    "DOMAIN STATE",
    JSON.stringify(input.domain, null, 2),
    "",
    "READINESS",
    JSON.stringify(input.readiness, null, 2),
    "",
    "CURRENT PRESENTATION",
    `sessionsListMappingStage=${input.readiness.sessionsListMappingStage}`,
    `materialsRailMappingStage=${input.readiness.materialsRailMappingStage}`,
    `aiReadyByCurrentContract=${input.readiness.aiReadyByCurrentContract} (${input.readiness.aiReadyReason})`,
    `enhancementTerminal=${input.readiness.enhancementTerminal}`,
    input.presentation.note,
    input.presentation.materialsStatus
      ? `materials/status=${JSON.stringify(input.presentation.materialsStatus, null, 2)}`
      : "",
    "",
    "EXPECTED CURRENT UI",
    input.definition.expectedCurrentUi,
    "",
    "KNOWN DEFECT / EXPECTED FUTURE INVARIANT",
    `KNOWN DEFECT: ${input.definition.knownDefect}`,
    `EXPECTED FUTURE: ${input.definition.expectedFutureInvariant}`,
    "",
    "AVAILABLE NEXT ACTIONS",
    ...input.definition.availableNextActions.map((action) => `- ${action}`),
    "======================================================================",
  ];
  return lines.join("\n");
}
