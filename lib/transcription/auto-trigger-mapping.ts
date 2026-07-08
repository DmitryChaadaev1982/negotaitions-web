import { ParticipantType, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decideAutoMappingApplication } from "@/lib/transcription/mapping-decision";
import {
  AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
  AUTO_MAPPING_HIGH_CONFIDENCE,
  AUTO_MAPPING_MIN_MARGIN,
  AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
  computeGlobalAssignmentMargin,
  shouldAllowGlobalMarginOverride,
} from "@/lib/transcription/auto-trigger-mapping-core";
import {
  detectMappingMode,
  evaluateMappingSafety,
  type MappingSafetyResult,
  type TelemetryQuality,
} from "@/lib/transcription/mapping-safety";
import {
  suggestSpeakerMapping,
  type TelemetryHealthReport,
} from "@/lib/transcription/auto-speaker-mapping";
import {
  applySpeakerMapping,
  buildDiarizedText,
  getDisplaySpeakerLabel,
  getUniqueSpeakerLabels,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";

export {
  AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
  AUTO_MAPPING_HIGH_CONFIDENCE,
  AUTO_MAPPING_MIN_MARGIN,
  AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
  computeGlobalAssignmentCandidates,
  computeGlobalAssignmentMargin,
  shouldAllowGlobalMarginOverride,
} from "@/lib/transcription/auto-trigger-mapping-core";

export type AutoMappingTriggerDiagnostics = {
  strategy: "diarization_segment_overlap";
  attempted: boolean;
  available: boolean;
  unavailableReason: string | null;
  uniqueSpeakerCount: number;
  suggestedSpeakerCount: number;
  minConfidence: number | null;
  appliedStatus: string | null;
  reason: string;
  computedAt: string;
  scoreMatrix: Record<string, Record<string, unknown>>;
  selectedMapping: SpeakerMapping;
  rejectedCandidateMapping: SpeakerMapping;
  candidateMapping: SpeakerMapping;
  candidateConfidence: Record<string, number>;
  safety: {
    oneToOne: boolean;
    safeToApply: boolean;
    reason: string | null;
  };
  isApplied: boolean;
  rejectedBySafety: boolean;
  safetyReason: string | null;
  mappingSafety: MappingSafetyResult;
  telemetryQuality: TelemetryQuality;
  telemetryHealth: TelemetryHealthReport;
  selectedTelemetrySource:
    | "VOX_REMOTE_STREAM_ACTIVITY"
    | "VOXIMPLANT_MIC_ACTIVITY"
    | "NONE";
  fallbackReason: string | null;
  sourceDecisionSummary: string;
  targetRuntimeDecision:
    | "remote_selected"
    | "local_fallback_selected"
    | "manual_review";
  selectedWindowStrategy: "provider_raw_windows" | "order_normalized_windows";
  windowNormalizationReason: string | null;
  providerWindowPathology: {
    hasPathologicalOverlap: boolean;
    overlapRatio: number;
    conflictingSegments: number[];
    reasons: string[];
  } | null;
  remoteStreamTelemetryAvailable: boolean;
  localMicTelemetryAvailable: boolean;
  remoteRejectedReason: string | null;
  scoreMatrixBySource: Record<string, Record<string, Record<string, unknown>>>;
  sourceWarningsBySource: Record<string, string[]>;
  sourceReasonBySource: Record<string, string | null>;
  weakMarginDetected: boolean;
  weakMarginOverriddenByGlobalEvidence: boolean;
  selectedCoverageBySpeaker: Record<string, number | null>;
  globalAssignmentMargin: number | null;
  globalAssignmentBestScore: number | null;
  globalAssignmentSecondBestScore: number | null;
  globalMarginOverrideThreshold: number;
  minSelectedCoverageForOverride: number;
  effectiveHighConfidence: boolean;
};

function notAttempted(reason: string): AutoMappingTriggerDiagnostics {
  return {
    strategy: "diarization_segment_overlap",
    attempted: false,
    available: false,
    unavailableReason: null,
    uniqueSpeakerCount: 0,
    suggestedSpeakerCount: 0,
    minConfidence: null,
    appliedStatus: null,
    reason,
    computedAt: new Date().toISOString(),
    scoreMatrix: {},
    selectedMapping: {},
    rejectedCandidateMapping: {},
    candidateMapping: {},
    candidateConfidence: {},
    safety: {
      oneToOne: true,
      safeToApply: false,
      reason: reason.startsWith("unavailable:") ? reason : null,
    },
    isApplied: false,
    rejectedBySafety: false,
    safetyReason: null,
    mappingSafety: {
      safe: true,
      rawSpeakerCount: 0,
      participantCount: 0,
      distinctMappedParticipantCount: 0,
      duplicateParticipantIds: [],
      mode: "unknown",
    },
    telemetryQuality: {
      participantCoverage: 0,
      participantCount: 0,
      rowsByParticipant: {},
      durationByParticipantMs: {},
      avgIntervalMs: {},
      medianIntervalMs: {},
      shortIntervalCount: 0,
      mergedIntervalCount: 0,
      totalRows: 0,
      imbalanceByRows: null,
      imbalanceByDuration: null,
      hasOffsets: false,
      hasDerivedOffsets: false,
      alignmentMode: "none",
      activeParticipantsDuringRecording: 0,
      outsideRecordingWindowRows: 0,
      warnings: [],
    },
    telemetryHealth: {
      participants: {},
      warnings: [],
    },
    selectedTelemetrySource: "NONE",
    fallbackReason: null,
    sourceDecisionSummary: reason,
    targetRuntimeDecision: "manual_review",
    selectedWindowStrategy: "provider_raw_windows",
    windowNormalizationReason: null,
    providerWindowPathology: null,
    remoteStreamTelemetryAvailable: false,
    localMicTelemetryAvailable: false,
    remoteRejectedReason: null,
    scoreMatrixBySource: {},
    sourceWarningsBySource: {},
    sourceReasonBySource: {},
    weakMarginDetected: false,
    weakMarginOverriddenByGlobalEvidence: false,
    selectedCoverageBySpeaker: {},
    globalAssignmentMargin: null,
    globalAssignmentBestScore: null,
    globalAssignmentSecondBestScore: null,
    globalMarginOverrideThreshold: AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
    minSelectedCoverageForOverride:
      AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
    effectiveHighConfidence: false,
  };
}

/**
 * Phase 4 — auto-trigger speaker mapping after transcription completes.
 *
 * Runs the existing telemetry-overlap suggestion logic and persists the
 * result. It never auto-confirms: high-confidence suggestions become
 * AUTO_SUGGESTED (prefilled + applied to segments); low-confidence or partial
 * suggestions are stored for UI prefill but leave the status REQUIRED.
 *
 * Resilient: callers should treat a thrown error as non-fatal for the run.
 * Returns diagnostics for logging / processingMetadata.
 */
export async function autoTriggerSpeakerMappingAfterTranscription(
  sessionId: string,
): Promise<AutoMappingTriggerDiagnostics> {
  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    include: { segments: { orderBy: { orderIndex: "asc" } } },
  });

  if (!transcript) return notAttempted("no_transcript");
  if (!transcript.hasSpeakerDiarization) return notAttempted("no_diarization");
  if (transcript.speakerMappingStatus === "CONFIRMED") {
    return notAttempted("already_confirmed");
  }

  const suggestion = await suggestSpeakerMapping(sessionId, {
    id: transcript.id,
    processingMetadata: transcript.processingMetadata,
    segments: transcript.segments.map((segment) => ({
      orderIndex: segment.orderIndex,
      speakerLabel: segment.speakerLabel,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
  });

  const labelOrder = getUniqueSpeakerLabels(
    transcript.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel: segment.speakerLabel
        ? getDisplaySpeakerLabel(
            segment.speakerLabel,
            transcript.segments
              .map((s) => s.speakerLabel)
              .filter((label): label is string => Boolean(label)),
          )
        : null,
    })),
  ).map((label) => label.speakerLabel);

  const existingMetadata =
    transcript.processingMetadata && typeof transcript.processingMetadata === "object"
      ? (transcript.processingMetadata as Record<string, unknown>)
      : {};

  const persistDiagnostics = async (diag: AutoMappingTriggerDiagnostics) => {
    await prisma.transcript.update({
      where: { id: transcript.id },
      data: {
        processingMetadata: {
          ...existingMetadata,
          mappingSuggestion: diag,
        } as Prisma.InputJsonValue,
      },
    });
  };

  if (!suggestion.available) {
    const safeByDefault: MappingSafetyResult = {
      safe: true,
      rawSpeakerCount: labelOrder.length,
      participantCount: 0,
      distinctMappedParticipantCount: 0,
      duplicateParticipantIds: [],
      mode: detectMappingMode(existingMetadata),
    };
    const diag: AutoMappingTriggerDiagnostics = {
      strategy: suggestion.strategy,
      attempted: true,
      available: false,
      unavailableReason: suggestion.unavailableReason,
      uniqueSpeakerCount: labelOrder.length,
      suggestedSpeakerCount: 0,
      minConfidence: null,
      appliedStatus: null,
      reason: `unavailable:${suggestion.unavailableReason ?? "unknown"}`,
      computedAt: new Date().toISOString(),
      scoreMatrix: suggestion.scoreMatrix,
      selectedMapping: suggestion.selectedMapping,
      rejectedCandidateMapping: suggestion.rejectedCandidateMapping,
      candidateMapping: {},
      candidateConfidence: {},
      safety: {
        oneToOne: false,
        safeToApply: false,
        reason: `unavailable:${suggestion.unavailableReason ?? "unknown"}`,
      },
      isApplied: false,
      rejectedBySafety: false,
      safetyReason: null,
      mappingSafety: safeByDefault,
      telemetryQuality: suggestion.telemetryQuality,
      telemetryHealth: suggestion.telemetryHealth,
      selectedTelemetrySource: suggestion.selectedTelemetrySource,
      fallbackReason: suggestion.fallbackReason,
      sourceDecisionSummary: suggestion.sourceDecisionSummary,
      targetRuntimeDecision: suggestion.targetRuntimeDecision,
      selectedWindowStrategy: suggestion.selectedWindowStrategy,
      windowNormalizationReason: suggestion.windowNormalizationReason,
      providerWindowPathology: suggestion.providerWindowPathology,
      remoteStreamTelemetryAvailable: suggestion.remoteStreamTelemetryAvailable,
      localMicTelemetryAvailable: suggestion.localMicTelemetryAvailable,
      remoteRejectedReason: suggestion.remoteRejectedReason,
      scoreMatrixBySource: suggestion.scoreMatrixBySource,
      sourceWarningsBySource: suggestion.sourceWarningsBySource,
      sourceReasonBySource: suggestion.sourceReasonBySource,
      weakMarginDetected: false,
      weakMarginOverriddenByGlobalEvidence: false,
      selectedCoverageBySpeaker: {},
      globalAssignmentMargin: null,
      globalAssignmentBestScore: null,
      globalAssignmentSecondBestScore: null,
      globalMarginOverrideThreshold: AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
      minSelectedCoverageForOverride:
        AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
      effectiveHighConfidence: false,
    };
    await persistDiagnostics(diag);
    return diag;
  }

  const suggestedLabels = Object.keys(suggestion.selectedMapping).filter(
    (label) => suggestion.selectedMapping[label],
  );
  const confidences = suggestedLabels
    .map((label) => suggestion.confidence[label])
    .filter((value): value is number => typeof value === "number");
  const minConfidence = confidences.length > 0 ? Math.min(...confidences) : null;

  const allSpeakersCovered =
    labelOrder.length > 0 &&
    labelOrder.every((label) => Boolean(suggestion.selectedMapping[label]));
  const highConfidence =
    minConfidence !== null && minConfidence >= AUTO_MAPPING_HIGH_CONFIDENCE;
  const weakMargin = Object.values(suggestion.selectedMargins).some(
    (margin) => margin != null && margin < AUTO_MAPPING_MIN_MARGIN,
  );
  const selectedCoverageBySpeaker = labelOrder.reduce<Record<string, number | null>>(
    (acc, label) => {
      const value = suggestion.confidence[label];
      acc[label] = typeof value === "number" ? value : null;
      return acc;
    },
    {},
  );

  // Sanitized mapping (only real participant ids).
  const sanitizedMapping: SpeakerMapping = {};
  for (const label of labelOrder) {
    sanitizedMapping[label] = suggestion.selectedMapping[label] ?? null;
  }

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId, type: { not: ParticipantType.OBSERVER } },
    include: { sessionRole: { select: { name: true } } },
  });
  const negotiationParticipantPool = participants.filter((p) => p.type === "PARTICIPANT");
  const participantPool = negotiationParticipantPool.length > 0 ? negotiationParticipantPool : participants;
  const mappingSafety = evaluateMappingSafety({
    mapping: sanitizedMapping,
    rawSpeakerLabels: labelOrder,
    participantIds: participantPool.map((participant) => participant.id),
    mode: detectMappingMode(existingMetadata),
  });
  const globalAssignment = computeGlobalAssignmentMargin({
    speakerLabels: labelOrder,
    participantIds: participantPool.map((participant) => participant.id),
    scoreMatrix: suggestion.scoreMatrix,
  });
  const weakMarginOverriddenByGlobalEvidence = shouldAllowGlobalMarginOverride({
    weakMargin,
    speakerLabelCount: labelOrder.length,
    participantCandidateCount: participantPool.length,
    allSpeakersCovered,
    mappingSafetySafe: mappingSafety.safe,
    globalAssignmentMargin: globalAssignment.margin,
    selectedCoverageBySpeaker,
    telemetryQuality: suggestion.telemetryQuality,
  });
  const effectiveWeakMargin = weakMargin && !weakMarginOverriddenByGlobalEvidence;
  const effectiveHighConfidence =
    highConfidence || weakMarginOverriddenByGlobalEvidence;
  const decision = decideAutoMappingApplication({
    allSpeakersCovered,
    highConfidence: effectiveHighConfidence,
    weakMargin: effectiveWeakMargin,
    mappingSafetySafe: mappingSafety.safe,
    mappingSafetyReason: mappingSafety.reason,
    rawSpeakerCount: labelOrder.length,
    expectedParticipantCount: participantPool.length,
    activeParticipantsDuringRecording:
      suggestion.telemetryQuality.activeParticipantsDuringRecording,
    hasOffsets: suggestion.telemetryQuality.hasOffsets,
    hasDerivedOffsets: suggestion.telemetryQuality.hasDerivedOffsets,
    telemetryWarnings: suggestion.telemetryQuality.warnings,
  });
  const shouldApply = decision.shouldApply;
  const rejectedBySafety = !mappingSafety.safe;
  const reason = decision.reason;

  if (!shouldApply) {
    const requiresManualReview =
      reason === "telemetry_quality_review_required" ||
      reason === "telemetry_coverage_review_required" ||
      reason === "telemetry_offsets_review_required" ||
      reason === "many_to_one_mapping_in_multi_participant_session" ||
      reason === "many_to_one_requires_manual_review_single_device";
    const nonAppliedStatus = requiresManualReview ? "NEEDS_REVIEW" : "REQUIRED";
    // Store only candidate diagnostics for UI prefill/review. Do not apply a
    // low-confidence or unsafe mapping as active transcript mapping.
    const diag: AutoMappingTriggerDiagnostics = {
      strategy: suggestion.strategy,
      attempted: true,
      available: true,
      unavailableReason: null,
      uniqueSpeakerCount: labelOrder.length,
      suggestedSpeakerCount: suggestedLabels.length,
      minConfidence,
      appliedStatus: nonAppliedStatus,
      reason,
      computedAt: new Date().toISOString(),
      scoreMatrix: suggestion.scoreMatrix,
      selectedMapping: sanitizedMapping,
      rejectedCandidateMapping: suggestion.rejectedCandidateMapping,
      candidateMapping: sanitizedMapping,
      candidateConfidence: suggestion.confidence,
      safety: {
        oneToOne:
          mappingSafety.rawSpeakerCount <= 1 ||
          mappingSafety.distinctMappedParticipantCount === mappingSafety.rawSpeakerCount,
        safeToApply: false,
        reason,
      },
      isApplied: false,
      rejectedBySafety,
      safetyReason: rejectedBySafety ? mappingSafety.reason ?? null : null,
      mappingSafety,
      telemetryQuality: suggestion.telemetryQuality,
      telemetryHealth: suggestion.telemetryHealth,
      selectedTelemetrySource: suggestion.selectedTelemetrySource,
      fallbackReason: suggestion.fallbackReason,
      sourceDecisionSummary: suggestion.sourceDecisionSummary,
      targetRuntimeDecision: suggestion.targetRuntimeDecision,
      selectedWindowStrategy: suggestion.selectedWindowStrategy,
      windowNormalizationReason: suggestion.windowNormalizationReason,
      providerWindowPathology: suggestion.providerWindowPathology,
      remoteStreamTelemetryAvailable: suggestion.remoteStreamTelemetryAvailable,
      localMicTelemetryAvailable: suggestion.localMicTelemetryAvailable,
      remoteRejectedReason: suggestion.remoteRejectedReason,
      scoreMatrixBySource: suggestion.scoreMatrixBySource,
      sourceWarningsBySource: suggestion.sourceWarningsBySource,
      sourceReasonBySource: suggestion.sourceReasonBySource,
      weakMarginDetected: weakMargin,
      weakMarginOverriddenByGlobalEvidence,
      selectedCoverageBySpeaker,
      globalAssignmentMargin: globalAssignment.margin,
      globalAssignmentBestScore: globalAssignment.best?.totalScore ?? null,
      globalAssignmentSecondBestScore:
        globalAssignment.secondBest?.totalScore ?? null,
      globalMarginOverrideThreshold: AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
      minSelectedCoverageForOverride:
        AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
      effectiveHighConfidence,
    };
    await prisma.transcript.update({
      where: { id: transcript.id },
      data: {
        speakerMapping: Prisma.JsonNull,
        speakerMappingStatus: nonAppliedStatus,
        processingMetadata: {
          ...existingMetadata,
          mappingSuggestion: diag,
        } as Prisma.InputJsonValue,
      },
    });
    return diag;
  }

  // High-confidence, complete, safe suggestion → prefill as AUTO_SUGGESTED and apply.
  const participantDisplayInfo = participants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    type: p.type,
    roleName: p.sessionRole?.name ?? null,
  }));

  const normalizedSegments = transcript.segments.map((segment) => ({
    speakerLabel: segment.speakerLabel,
    displaySpeakerLabel: segment.speakerLabel
      ? getDisplaySpeakerLabel(segment.speakerLabel, labelOrder)
      : null,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    text: segment.text,
    orderIndex: segment.orderIndex,
  }));
  const mappedSegments = applySpeakerMapping(normalizedSegments, sanitizedMapping);
  const diarizedText = buildDiarizedText(
    normalizedSegments,
    sanitizedMapping,
    participantDisplayInfo,
  );

  const diag: AutoMappingTriggerDiagnostics = {
    strategy: suggestion.strategy,
    attempted: true,
    available: true,
    unavailableReason: null,
    uniqueSpeakerCount: labelOrder.length,
    suggestedSpeakerCount: suggestedLabels.length,
    minConfidence,
    appliedStatus: "AUTO_SUGGESTED",
    reason,
    computedAt: new Date().toISOString(),
    scoreMatrix: suggestion.scoreMatrix,
    selectedMapping: sanitizedMapping,
    rejectedCandidateMapping: suggestion.rejectedCandidateMapping,
    candidateMapping: sanitizedMapping,
    candidateConfidence: suggestion.confidence,
    safety: {
      oneToOne: true,
      safeToApply: true,
      reason: null,
    },
    isApplied: true,
    rejectedBySafety: false,
    safetyReason: null,
    mappingSafety,
    telemetryQuality: suggestion.telemetryQuality,
    telemetryHealth: suggestion.telemetryHealth,
    selectedTelemetrySource: suggestion.selectedTelemetrySource,
    fallbackReason: suggestion.fallbackReason,
    sourceDecisionSummary: suggestion.sourceDecisionSummary,
    targetRuntimeDecision: suggestion.targetRuntimeDecision,
    selectedWindowStrategy: suggestion.selectedWindowStrategy,
    windowNormalizationReason: suggestion.windowNormalizationReason,
    providerWindowPathology: suggestion.providerWindowPathology,
    remoteStreamTelemetryAvailable: suggestion.remoteStreamTelemetryAvailable,
    localMicTelemetryAvailable: suggestion.localMicTelemetryAvailable,
    remoteRejectedReason: suggestion.remoteRejectedReason,
    scoreMatrixBySource: suggestion.scoreMatrixBySource,
    sourceWarningsBySource: suggestion.sourceWarningsBySource,
    sourceReasonBySource: suggestion.sourceReasonBySource,
    weakMarginDetected: weakMargin,
    weakMarginOverriddenByGlobalEvidence,
    selectedCoverageBySpeaker,
    globalAssignmentMargin: globalAssignment.margin,
    globalAssignmentBestScore: globalAssignment.best?.totalScore ?? null,
    globalAssignmentSecondBestScore: globalAssignment.secondBest?.totalScore ?? null,
    globalMarginOverrideThreshold: AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
    minSelectedCoverageForOverride: AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
    effectiveHighConfidence,
  };

  await prisma.$transaction(async (tx) => {
    await tx.transcript.update({
      where: { id: transcript.id },
      data: {
        speakerMapping: sanitizedMapping as Prisma.InputJsonValue,
        speakerMappingStatus: "AUTO_SUGGESTED",
        diarizedText,
        processingMetadata: {
          ...existingMetadata,
          mappingSuggestion: diag,
        } as Prisma.InputJsonValue,
      },
    });

    for (const segment of mappedSegments) {
      const dbSegment = transcript.segments.find(
        (item) => item.orderIndex === segment.orderIndex,
      );
      if (!dbSegment || dbSegment.mappingLocked) continue;
      await tx.transcriptSegment.update({
        where: { id: dbSegment.id },
        data: {
          mappedParticipantId: segment.mappedParticipantId,
          mappingSource: "MIC_ACTIVITY",
          mappingConfidence:
            segment.speakerLabel && typeof suggestion.confidence[segment.speakerLabel] === "number"
              ? suggestion.confidence[segment.speakerLabel]
              : null,
        },
      });
    }
  });

  return diag;
}
