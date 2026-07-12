import type { TranscriptEnhancementOverallStatus } from "@/lib/services/yandex-transcript-enhancement";

export type PersistableTranscriptSegment = {
  id: string;
  orderIndex: number;
  text: string;
  qualityText: string | null;
};

export function resolveEnhancementOriginalText(segment: {
  qualityText: string | null;
  text: string;
}): string {
  return segment.qualityText ?? segment.text;
}

export function shouldPersistEnhancedText(
  status: TranscriptEnhancementOverallStatus,
): boolean {
  return status === "COMPLETED" || status === "PARTIAL";
}

export function buildSegmentEnhancementUpdates(
  segments: PersistableTranscriptSegment[],
  replacementByIndex: Map<number, string>,
): Array<{
  id: string;
  text: string;
  qualityText: string | null;
}> {
  const updates: Array<{ id: string; text: string; qualityText: string | null }> = [];
  for (const segment of segments) {
    const replacementText = replacementByIndex.get(segment.orderIndex);
    if (replacementText === undefined) {
      continue;
    }
    const nextText = replacementText.trim() || segment.text;
    updates.push({
      id: segment.id,
      text: nextText,
      // Preserve the first known provider/original segment text once.
      // Do not overwrite if a historical pre-enhancement backup already exists.
      qualityText: segment.qualityText ?? segment.text,
    });
  }
  return updates;
}

export const MODE_SWITCH_REVERTS_PERSISTED_TEXT = false;
