import type { TranscriptEnhancementResult } from "@/lib/services/yandex-transcript-enhancement";

import type { BenchSegment, QualityReport, QualityVerdict } from "./types";

const CATASTROPHIC_SHRINK_MIN_SOURCE_CHARS = 40;
const CATASTROPHIC_SHRINK_RATIO = 0.35;
const CATASTROPHIC_SHRINK_MIN_REMOVED_CHARS = 30;
const EXPANSION_RATIO = 2.5;

function isCatastrophicShrink(originalText: string, cleanedText: string): boolean {
  if (originalText.length < CATASTROPHIC_SHRINK_MIN_SOURCE_CHARS) {
    return false;
  }
  const removed = originalText.length - cleanedText.length;
  return (
    cleanedText.length / originalText.length < CATASTROPHIC_SHRINK_RATIO &&
    removed >= CATASTROPHIC_SHRINK_MIN_REMOVED_CHARS
  );
}

function extractDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function cyrillicRatio(value: string): number {
  const letters = value.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
  if (!letters) return 0;
  const cyr = letters.replace(/[^А-Яа-яЁё]/g, "").length;
  return cyr / letters.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? null;
}

export function scoreEnhancementQuality(params: {
  original: BenchSegment[];
  result: TranscriptEnhancementResult;
}): QualityReport {
  const { original, result } = params;
  const byIndex = new Map(result.segments.map((segment) => [segment.index, segment.cleanedText]));
  const originalIndexes = original.map((segment) => segment.index);
  const resultIndexes = result.segments.map((segment) => segment.index);
  const originalSet = new Set(originalIndexes);
  const resultSet = new Set(resultIndexes);
  const missingIndexes = originalIndexes.filter((index) => !resultSet.has(index));
  const extraIndexes = resultIndexes.filter((index) => !originalSet.has(index));
  const emptyReplacements: number[] = [];
  const obviousDistortion: string[] = [];
  const rejectReasons: string[] = [];
  const lengthRatios: number[] = [];
  let catastrophicShrinkCount = 0;
  let expansionAnomalyCount = 0;
  let changedSegmentCount = 0;
  let unchangedSegmentCount = 0;

  for (const segment of original) {
    const enhanced = byIndex.get(segment.index);
    if (enhanced === undefined) {
      continue;
    }
    const cleaned = enhanced.trim();
    if (!cleaned && segment.originalText.trim()) {
      emptyReplacements.push(segment.index);
    }
    if (isCatastrophicShrink(segment.originalText, cleaned)) {
      catastrophicShrinkCount += 1;
    }
    if (
      segment.originalText.length >= 20 &&
      cleaned.length / Math.max(1, segment.originalText.length) > EXPANSION_RATIO
    ) {
      expansionAnomalyCount += 1;
    }
    if (cleaned === segment.originalText.trim()) {
      unchangedSegmentCount += 1;
    } else {
      changedSegmentCount += 1;
    }
    if (segment.originalText.length > 0) {
      lengthRatios.push(cleaned.length / segment.originalText.length);
    }
    const sourceDigits = extractDigits(segment.originalText);
    const enhancedDigits = extractDigits(cleaned);
    if (sourceDigits.length >= 3 && !enhancedDigits.includes(sourceDigits.slice(0, 3))) {
      obviousDistortion.push(`digit-loss:${segment.index}`);
    }
    if (
      segment.originalText.length >= 40 &&
      cyrillicRatio(segment.originalText) > 0.7 &&
      cyrillicRatio(cleaned) < 0.25
    ) {
      obviousDistortion.push(`script-shift:${segment.index}`);
    }
    if (/speaker_\d+/i.test(cleaned)) {
      obviousDistortion.push(`speaker-leak:${segment.index}`);
    }
  }

  const overallStatus = result.meta?.overallStatus ?? "FAILED";
  const schemaValid =
    overallStatus !== "FAILED" &&
    (result.meta?.schemaChunkCount ?? 0) >= 0 &&
    missingIndexes.length === 0 &&
    extraIndexes.length === 0;
  const indexPreservation = missingIndexes.length === 0 && extraIndexes.length === 0;
  const noLoss = emptyReplacements.length === 0 && missingIndexes.length === 0;

  if (!schemaValid) rejectReasons.push("schema_or_status_invalid");
  if (!indexPreservation) rejectReasons.push("target_index_error");
  if (!noLoss) rejectReasons.push("segment_loss");
  if (catastrophicShrinkCount > 0) rejectReasons.push("catastrophic_shrink");
  if (obviousDistortion.length > 0) rejectReasons.push("obvious_lexical_distortion");
  if (overallStatus === "FAILED") rejectReasons.push("overall_failed");

  const uniqueRejects = [...new Set(rejectReasons)];
  const verdict: QualityVerdict = uniqueRejects.length === 0 ? "PASS" : "REJECT";

  return {
    verdict,
    schemaValid,
    indexPreservation,
    noLoss,
    missingIndexes,
    extraIndexes,
    emptyReplacements,
    catastrophicShrinkCount,
    expansionAnomalyCount,
    changedSegmentCount,
    unchangedSegmentCount,
    medianLengthRatio: median(lengthRatios),
    obviousDistortion,
    rejectReasons: uniqueRejects,
  };
}
