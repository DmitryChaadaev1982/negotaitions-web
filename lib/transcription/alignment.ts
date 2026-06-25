/**
 * Two-pass transcript alignment.
 *
 * Aligns text from the quality transcription pass back to diarized segments,
 * preserving speaker labels and timestamps from the diarization pass.
 *
 * The diarization pass provides accurate speaker labels and timestamps but
 * may produce lower-quality text. The quality pass produces better text but
 * has no speaker labels. This module merges the two.
 */

export type DiarizedSegmentInput = {
  speakerLabel: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
  orderIndex: number;
};

export type AlignedSegment = DiarizedSegmentInput & {
  qualityText: string | null;
  finalText: string;
  alignmentSource: "DIARIZED" | "QUALITY" | "FALLBACK";
  alignmentConfidence: number;
  alignmentWarnings: string[];
};

export type AlignmentResult = {
  segments: AlignedSegment[];
  alignmentStatus: "ALIGNED" | "PARTIAL" | "FAILED" | "SKIPPED";
  overallConfidence: number;
  lowConfidenceSegmentCount: number;
  warnings: string[];
};

/** Thresholds from spec */
const CONFIDENCE_ACCEPT = 0.75;
const CONFIDENCE_REVIEW = 0.50;

// ---------------------------------------------------------------------------
// Text normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise ё → е (common in Russian OCR/STT output variation).
 */
function normalizeYo(text: string): string {
  return text.replace(/ё/g, "е").replace(/Ё/g, "Е");
}

/**
 * Produce a normalised comparison form: lowercase, ё→е, strip punctuation,
 * collapse whitespace.
 */
export function normalizeText(text: string): string {
  return normalizeYo(text)
    .toLowerCase()
    .replace(/[.,!?;:«»"'""''()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenise normalised text into words.
 */
function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter((t) => t.length > 0);
}

/**
 * Token-overlap similarity (Jaccard-like): |intersection| / |union|.
 * Returns 0..1.
 */
export function tokenOverlapSimilarity(a: string, b: string): number {
  const tokA = new Set(tokenize(a));
  const tokB = new Set(tokenize(b));

  if (tokA.size === 0 && tokB.size === 0) return 1;
  if (tokA.size === 0 || tokB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokA) {
    if (tokB.has(t)) intersection++;
  }

  const union = tokA.size + tokB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ---------------------------------------------------------------------------
// Candidate splitting
// ---------------------------------------------------------------------------

/**
 * Split a quality transcript into candidate utterances.
 *
 * Strategy (in order of preference):
 * 1. Split on newlines (double or single) — models often produce line-per-turn.
 * 2. Split on sentence-ending punctuation followed by whitespace.
 * 3. If neither produces multiple candidates, return single candidate.
 */
function splitQualityTranscript(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Double-newline paragraph split first
  const byDoubleNewline = trimmed
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (byDoubleNewline.length > 1) {
    // Further split each paragraph by single newline
    const result: string[] = [];
    for (const block of byDoubleNewline) {
      const byNewline = block
        .split(/\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      result.push(...byNewline);
    }
    return result.length > 1 ? result : byDoubleNewline;
  }

  // Single-newline split
  const bySingleNewline = trimmed
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (bySingleNewline.length > 1) return bySingleNewline;

  // Sentence-boundary split (. ! ? followed by space and uppercase or digit)
  const bySentence = trimmed
    .split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ\d])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (bySentence.length > 1) return bySentence;

  return [trimmed];
}

// ---------------------------------------------------------------------------
// Core alignment
// ---------------------------------------------------------------------------

/**
 * Align quality transcript text to diarized segments.
 *
 * Algorithm:
 * 1. Split quality text into candidates.
 * 2. If candidate count === segment count → pair by order, compute confidence.
 * 3. If counts differ → greedy alignment by order + similarity window.
 * 4. Apply confidence thresholds to determine finalText per segment.
 */
export function alignQualityTranscriptToDiarizedSegments(
  diarizedSegments: DiarizedSegmentInput[],
  qualityTranscriptText: string,
): AlignmentResult {
  const warnings: string[] = [];

  if (diarizedSegments.length === 0) {
    return {
      segments: [],
      alignmentStatus: "SKIPPED",
      overallConfidence: 0,
      lowConfidenceSegmentCount: 0,
      warnings: ["No diarized segments to align against."],
    };
  }

  const candidates = splitQualityTranscript(qualityTranscriptText);

  if (candidates.length === 0) {
    // No quality text — keep all diarized as-is
    const segments = diarizedSegments.map((seg) =>
      makeAlignedSegment(seg, null, 0, "DIARIZED", ["No quality transcript text."]),
    );
    return {
      segments,
      alignmentStatus: "FAILED",
      overallConfidence: 0,
      lowConfidenceSegmentCount: segments.length,
      warnings: ["Quality transcript was empty; keeping diarized text."],
    };
  }

  let pairedCandidates: (string | null)[];

  if (candidates.length === diarizedSegments.length) {
    // Perfect count match — pair by order
    pairedCandidates = candidates;
  } else {
    // Greedy alignment
    pairedCandidates = greedyAlign(diarizedSegments, candidates, warnings);
  }

  const segments: AlignedSegment[] = diarizedSegments.map((seg, i) => {
    const candidate = pairedCandidates[i] ?? null;
    if (candidate === null) {
      return makeAlignedSegment(
        seg,
        null,
        0,
        "DIARIZED",
        ["No quality candidate matched this segment."],
      );
    }

    const confidence = tokenOverlapSimilarity(seg.text, candidate);
    const segWarnings: string[] = [];

    if (confidence >= CONFIDENCE_ACCEPT) {
      return makeAlignedSegment(seg, candidate, confidence, "QUALITY", segWarnings);
    }

    if (confidence >= CONFIDENCE_REVIEW) {
      segWarnings.push("NEEDS_REVIEW");
      return makeAlignedSegment(seg, candidate, confidence, "QUALITY", segWarnings);
    }

    // Low confidence — keep diarized
    segWarnings.push("LOW_CONFIDENCE");
    return makeAlignedSegment(seg, candidate, confidence, "DIARIZED", segWarnings);
  });

  const lowCount = segments.filter((s) => s.alignmentConfidence < CONFIDENCE_REVIEW).length;
  const total = segments.length;
  const avgConfidence =
    total > 0
      ? segments.reduce((sum, s) => sum + s.alignmentConfidence, 0) / total
      : 0;

  let alignmentStatus: AlignmentResult["alignmentStatus"];
  if (lowCount === 0) {
    alignmentStatus = "ALIGNED";
  } else if (lowCount < total) {
    alignmentStatus = "PARTIAL";
  } else {
    alignmentStatus = "FAILED";
  }

  return {
    segments,
    alignmentStatus,
    overallConfidence: avgConfidence,
    lowConfidenceSegmentCount: lowCount,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Greedy alignment (counts differ)
// ---------------------------------------------------------------------------

/**
 * Greedy alignment when candidate count differs from segment count.
 *
 * For each segment, find the best-matching candidate within a sliding window
 * of ±2 positions from the expected order position, scaled by candidate count.
 * Each candidate can be used at most once.
 */
function greedyAlign(
  segments: DiarizedSegmentInput[],
  candidates: string[],
  warnings: string[],
): (string | null)[] {
  const used = new Set<number>();
  const result: (string | null)[] = [];

  const ratio = candidates.length / segments.length;

  for (let i = 0; i < segments.length; i++) {
    const expectedIdx = Math.round(i * ratio);
    const windowStart = Math.max(0, expectedIdx - 2);
    const windowEnd = Math.min(candidates.length - 1, expectedIdx + 2);

    let bestIdx = -1;
    let bestScore = -1;

    for (let j = windowStart; j <= windowEnd; j++) {
      if (used.has(j)) continue;
      const score = tokenOverlapSimilarity(segments[i].text, candidates[j]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0 && bestScore > 0) {
      used.add(bestIdx);
      result.push(candidates[bestIdx]);
    } else {
      result.push(null);
    }
  }

  if (candidates.length !== segments.length) {
    warnings.push(
      `Candidate count (${candidates.length}) differs from segment count (${segments.length}); used greedy alignment.`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Segment factory
// ---------------------------------------------------------------------------

function makeAlignedSegment(
  seg: DiarizedSegmentInput,
  qualityText: string | null,
  confidence: number,
  source: AlignedSegment["alignmentSource"],
  alignmentWarnings: string[],
): AlignedSegment {
  const finalText = source === "QUALITY" && qualityText ? qualityText : seg.text;
  return {
    ...seg,
    qualityText,
    finalText,
    alignmentSource: source,
    alignmentConfidence: confidence,
    alignmentWarnings,
  };
}
