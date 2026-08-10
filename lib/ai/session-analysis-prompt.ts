import {
  YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
  estimateAiAnalysisTokensFromChars,
} from "@/lib/ai/analysis-input-budget";
import { getAiAnalysisProvider } from "@/lib/env";

export type BuildAnalysisPromptContext = {
  session: {
    id?: string;
    title: string;
    roomLabel?: string | null;
    status?: string;
    caseTitle: string;
    caseLanguage: string;
    publicInstructions: string;
    businessContext: string;
    preparationDurationSeconds: number;
    durationSeconds: number;
    startedAt?: string | null;
    endedAt?: string | null;
    negotiationStartedAt?: string | null;
    negotiationEndedAt?: string | null;
    sequenceNumber: number | null;
  };
  event: {
    id?: string;
    title: string;
    status?: string;
  } | null;
  roles: Array<{
    id?: string;
    name: string;
    privateInstructions?: string;
    objectives: string;
    constraints: string;
    hiddenInfo: string;
    fallbackPosition: string;
  }>;
  participants: Array<{
    id?: string;
    displayName: string;
    type: string;
    roleName: string | null;
    notes: string;
  }>;
  transcript: {
    id?: string;
    text: string;
    diarizedText: string | null;
    language: string | null;
    transcriptionModel?: string | null;
    hasSpeakerDiarization: boolean;
    segments: Array<{
      orderIndex?: number;
      speakerLabel: string | null;
      mappedParticipantName: string | null;
      startSeconds: number | null;
      endSeconds: number | null;
      text: string;
    }>;
  } | null;
};

type TranscriptPromptMode = "direct" | "lossless_compact";

function normalizeTranscriptCoverageText(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

function renderAnalysisPrompt(
  context: BuildAnalysisPromptContext,
  transcriptMode: TranscriptPromptMode,
): string {
  const lines: string[] = [];

  const formatTimestamp = (value: number | null) => {
    if (value == null) return null;
    const safe = Math.max(0, Math.floor(value));
    const hours = Math.floor(safe / 3600)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((safe % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safe % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  lines.push("# NegotAItions — Negotiation Session Analysis Request");
  lines.push("");
  lines.push(
    "You are an expert negotiation coach. Analyze the following negotiation session and provide a detailed structured assessment.",
  );
  lines.push("");
  lines.push("## Instructions");
  lines.push(
    "- Base your analysis ONLY on the transcript, notes, and session data provided.",
  );
  lines.push(
    "- If evidence is insufficient, explicitly state so and give conservative scores.",
  );
  lines.push(
    "- If speaker attribution is missing, set confidenceLevel to LOW or MEDIUM.",
  );
  lines.push(
    "- Do not invent facts, timestamps, or quotes not present in the transcript.",
  );
  lines.push("- Scores must be integers 0–100.");
  lines.push(
    `- Output language: ${context.session.caseLanguage === "RU" ? "Russian" : "English"}.`,
  );
  lines.push(
    "- For participantPersonalFeedback: generate one entry per NEGOTIATING participant (exclude facilitators and observers). Each entry must be specific to that individual's behaviour in the transcript. Include concrete evidence. Achievements should highlight genuine strengths. CouldHaveDoneBetter should name specific missed opportunities or mistakes with actionable tips.",
  );
  lines.push("");

  lines.push("## Session Metadata");
  lines.push(`- Title: ${context.session.title}`);
  lines.push(`- Case: ${context.session.caseTitle}`);
  if (context.event) {
    lines.push(`- Event: ${context.event.title}`);
  }
  if (context.session.sequenceNumber) {
    lines.push(`- Session number: ${context.session.sequenceNumber}`);
  }
  lines.push(
    `- Preparation duration: ${Math.round(context.session.preparationDurationSeconds / 60)} min`,
  );
  lines.push(
    `- Negotiation duration: ${Math.round(context.session.durationSeconds / 60)} min`,
  );
  lines.push("");

  lines.push("## Case Context (Public)");
  lines.push(context.session.businessContext || "(not available)");
  lines.push("");
  lines.push("## Public Instructions");
  lines.push(context.session.publicInstructions || "(not available)");
  lines.push("");

  if (context.roles.length > 0) {
    lines.push("## Roles & Private Briefings (Facilitator Only)");
    for (const role of context.roles) {
      lines.push(`### Role: ${role.name}`);
      lines.push(`- Objectives: ${role.objectives}`);
      lines.push(`- Constraints: ${role.constraints}`);
      lines.push(`- Hidden info: ${role.hiddenInfo}`);
      lines.push(`- Fallback position: ${role.fallbackPosition}`);
    }
    lines.push("");
  }

  if (context.participants.length > 0) {
    lines.push("## Participants");
    for (const p of context.participants) {
      const roleLabel = p.roleName ? ` (Role: ${p.roleName})` : "";
      lines.push(`- ${p.displayName}${roleLabel} [${p.type}]`);
      if (p.notes?.trim()) {
        lines.push(`  Notes: ${p.notes.trim()}`);
      }
    }
    lines.push("");
  }

  if (context.transcript) {
    lines.push("## Transcript");
    const hasTimeline = context.transcript.segments.length > 0;
    const segmentCoverageText = context.transcript.segments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ");
    const canonicalTextHasUncoveredContent =
      hasTimeline &&
      normalizeTranscriptCoverageText(context.transcript.text) !==
        normalizeTranscriptCoverageText(segmentCoverageText);
    if (transcriptMode === "lossless_compact" && hasTimeline) {
      lines.push(
        "(Complete lossless timeline; the duplicate narrative transcript is intentionally omitted.)",
      );
    } else if (
      context.transcript.hasSpeakerDiarization &&
      context.transcript.diarizedText?.trim()
    ) {
      lines.push("(Speaker-attributed transcript)");
      lines.push(context.transcript.diarizedText.trim());
      if (
        canonicalTextHasUncoveredContent &&
        context.transcript.text.trim()
      ) {
        lines.push("");
        lines.push(
          "(Additional canonical plain transcript retained because it differs from the segment timeline)",
        );
        lines.push(context.transcript.text.trim());
      }
    } else if (context.transcript.text?.trim()) {
      lines.push("(Plain transcript — speaker attribution not available)");
      lines.push(context.transcript.text.trim());
    } else {
      lines.push("(Transcript is empty)");
    }
    lines.push("");
    if (context.transcript.language) {
      lines.push(`Transcript language: ${context.transcript.language}`);
    }

    if (context.transcript.segments.length > 0) {
      lines.push("");
      lines.push("## Transcript Segments (Timeline)");
      if (transcriptMode === "lossless_compact") {
        lines.push(
          JSON.stringify({
            segments: context.transcript.segments.map((segment, position) => ({
              orderIndex: segment.orderIndex ?? position,
              speaker:
                segment.mappedParticipantName ??
                segment.speakerLabel ??
                "Speaker",
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds,
              text: segment.text,
            })),
          }),
        );
      } else {
        for (const segment of context.transcript.segments) {
          const speaker =
            segment.mappedParticipantName ?? segment.speakerLabel ?? "Speaker";
          const start = formatTimestamp(segment.startSeconds);
          const end = formatTimestamp(segment.endSeconds);
          const timeRange =
            start && end ? `${start}-${end}` : (start ?? end ?? "00:00:00");
          lines.push(`[${timeRange}] [${speaker}] ${segment.text}`);
        }
      }
    }
  } else {
    lines.push("## Transcript");
    lines.push("(No transcript available)");
    lines.push("");
  }

  return lines.join("\n");
}

export type AnalysisPromptPackingResult = {
  prompt: string;
  mode: TranscriptPromptMode;
  promptChars: number;
  estimatedPromptTokens: number;
  sourceSegmentCount: number;
  sourceSegmentCharacters: number;
  duplicateNarrativeCharactersOmitted: number;
  duplicateNarrativeVerified: boolean;
  exceedsPromptBudget: boolean;
};

export function packAnalysisPrompt(
  context: BuildAnalysisPromptContext,
): AnalysisPromptPackingResult {
  const directPrompt = renderAnalysisPrompt(context, "direct");
  const directEstimatedTokens = estimateAiAnalysisTokensFromChars(
    directPrompt.length,
  );
  const sourceSegmentCount = context.transcript?.segments.length ?? 0;
  const sourceSegmentCharacters =
    context.transcript?.segments.reduce(
      (total, segment) => total + segment.text.length,
      0,
    ) ?? 0;
  const segmentCoverageText =
    context.transcript?.segments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ") ?? "";
  const duplicateNarrativeVerified = Boolean(
    context.transcript &&
      sourceSegmentCount > 0 &&
      normalizeTranscriptCoverageText(context.transcript.text) ===
        normalizeTranscriptCoverageText(segmentCoverageText),
  );

  if (
    directEstimatedTokens <=
      YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET ||
    !duplicateNarrativeVerified
  ) {
    return {
      prompt: directPrompt,
      mode: "direct",
      promptChars: directPrompt.length,
      estimatedPromptTokens: directEstimatedTokens,
      sourceSegmentCount,
      sourceSegmentCharacters,
      duplicateNarrativeCharactersOmitted: 0,
      duplicateNarrativeVerified,
      exceedsPromptBudget:
        directEstimatedTokens >
        YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
    };
  }

  const compactPrompt = renderAnalysisPrompt(context, "lossless_compact");
  return {
    prompt: compactPrompt,
    mode: "lossless_compact",
    promptChars: compactPrompt.length,
    estimatedPromptTokens: estimateAiAnalysisTokensFromChars(
      compactPrompt.length,
    ),
    sourceSegmentCount,
    sourceSegmentCharacters,
    duplicateNarrativeCharactersOmitted:
      (context.transcript?.diarizedText?.trim() ||
        context.transcript?.text?.trim() ||
        "").length,
    duplicateNarrativeVerified,
    exceedsPromptBudget:
      estimateAiAnalysisTokensFromChars(compactPrompt.length) >
      YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
  };
}

export function buildAnalysisPrompt(
  context: BuildAnalysisPromptContext,
): string {
  if (getAiAnalysisProvider() !== "yandex") {
    return renderAnalysisPrompt(context, "direct");
  }
  return packAnalysisPrompt(context).prompt;
}
