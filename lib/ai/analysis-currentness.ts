import { isAiAnalysisCurrentForTranscript } from "@/lib/transcription/speaker-mapping-readiness";

export type AiAnalysisCurrentnessReason =
  | "fingerprint_match"
  | "fingerprint_mismatch"
  | "generation_mismatch"
  | "legacy_current"
  | "legacy_stale"
  | "missing_analysis";

export type AiAnalysisCurrentnessResult = {
  current: boolean;
  reason: AiAnalysisCurrentnessReason;
};

export type AiAnalysisCurrentnessInput = {
  analysis:
    | {
        inputFingerprint?: string | null;
        transcriptId?: string | null;
        transcriptRetranscribeCount?: number | null;
      }
    | null
    | undefined;
  currentFingerprint: string | null;
  transcriptId: string | null | undefined;
  transcriptRetranscribeCount: number | null | undefined;
};

/**
 * A new ASR generation (`transcriptId` + `retranscribeCount`) is a
 * downstream invalidation boundary. Matching fingerprints cannot keep an
 * older generation current.
 *
 * Same-generation fingerprinted rows compare stored SHA-256 against the
 * current canonical material envelope.
 *
 * Historical NULL fingerprints keep transcriptId + retranscribeCount
 * compatibility (PT-22) and are not retroactively staled. That fallback
 * already treats the current transcript generation as an accepted
 * compatibility baseline; it cannot see same-generation lexical/mapping
 * edits.
 *
 * At the first facilitator material write, a still-legacy-current NULL row
 * may be bound to the pre-mutation envelope hash. That hash is currentness
 * identity for the last snapshot PT-22 already treated as current. It is
 * not proven original-provider-prompt identity (PT-19 for new runs). After
 * the mutation, fingerprint comparison makes the old row non-current unless
 * materials later equal that same compatibility baseline.
 */
export function evaluateAiAnalysisCurrentness(
  input: AiAnalysisCurrentnessInput,
): AiAnalysisCurrentnessResult {
  if (!input.analysis) {
    return { current: false, reason: "missing_analysis" };
  }

  const generationCurrent = isAiAnalysisCurrentForTranscript({
    transcriptId: input.transcriptId,
    transcriptRetranscribeCount: input.transcriptRetranscribeCount,
    analysisTranscriptId: input.analysis.transcriptId,
    analysisTranscriptRetranscribeCount:
      input.analysis.transcriptRetranscribeCount,
  });
  if (!generationCurrent) {
    return {
      current: false,
      reason: input.analysis.inputFingerprint?.trim()
        ? "generation_mismatch"
        : "legacy_stale",
    };
  }

  const storedFingerprint = input.analysis.inputFingerprint?.trim() || null;
  if (storedFingerprint) {
    const matches =
      Boolean(input.currentFingerprint) &&
      storedFingerprint === input.currentFingerprint;
    return {
      current: matches,
      reason: matches ? "fingerprint_match" : "fingerprint_mismatch",
    };
  }

  return {
    current: true,
    reason: "legacy_current",
  };
}

/**
 * Active-workflow "older transcript" warning. After a generation rewind the
 * historical row may still exist, but the presented AI stage is already
 * NOT_STARTED. Do not keep reminding the operator about the hidden artifact.
 */
export function shouldPresentAnalysisFromOlderTranscript(input: {
  isFacilitator: boolean;
  analysisCurrent: boolean;
  analysisOutdated: boolean;
}): boolean {
  return input.isFacilitator && input.analysisCurrent && input.analysisOutdated;
}

/**
 * Legacy compatibility upgrade at a facilitator material-write boundary.
 *
 * Bind only when the row is still `legacy_current`. Persist the pre-mutation
 * envelope hash so the subsequent mutation is visible to fingerprinted
 * currentness. Untouched historical rows stay NULL. Already-fingerprinted
 * and already-stale rows are left alone.
 *
 * The bound hash is not reconstructed historical model input. It is the
 * last snapshot PT-22 already accepted as current. Reverting materials to
 * that snapshot can make the old row current again; that is the same
 * compatibility baseline, not proof of the original prompt.
 */
export function decideLegacyNullFingerprintBindOnMaterialChange(input: {
  analysis: AiAnalysisCurrentnessInput["analysis"];
  preMutationFingerprint: string | null;
  transcriptId: string | null | undefined;
  transcriptRetranscribeCount: number | null | undefined;
}): string | null {
  if (!input.preMutationFingerprint) {
    return null;
  }
  const currentness = evaluateAiAnalysisCurrentness({
    analysis: input.analysis,
    currentFingerprint: input.preMutationFingerprint,
    transcriptId: input.transcriptId,
    transcriptRetranscribeCount: input.transcriptRetranscribeCount,
  });
  if (currentness.reason !== "legacy_current") {
    return null;
  }
  return input.preMutationFingerprint;
}
