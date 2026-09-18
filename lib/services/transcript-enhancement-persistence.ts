import type { TranscriptEnhancementOverallStatus } from "@/lib/services/yandex-transcript-enhancement";

export type PersistableTranscriptSegment = {
  id: string;
  orderIndex: number;
  text: string;
  qualityText: string | null;
};

/**
 * Transient enhancement provider input. Manual segments have no SpeechKit
 * raw source, so current `text` may be sent to the model. This fallback is
 * never persisted as `qualityText`.
 */
export function resolveEnhancementOriginalText(segment: {
  qualityText: string | null;
  text: string;
}): string {
  return segment.qualityText ?? segment.text;
}

/**
 * Authoritative SpeechKit raw/original lexical evidence. `null` means the
 * segment has no raw source (new manual insert) and must stay null through
 * enhancement publication.
 */
export function resolvePersistedEnhancementQualityText(segment: {
  qualityText: string | null;
}): string | null {
  return segment.qualityText;
}

export function resolveInitialQualityText(providerText: string, existingQualityText: string | null): string {
  return existingQualityText ?? providerText;
}

export function shouldPersistEnhancedText(
  status: TranscriptEnhancementOverallStatus,
): boolean {
  return status === "COMPLETED";
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
      // Do not fabricate SpeechKit raw from current/manual text. Provider
      // input may use `qualityText ?? text`; persisted raw authority may stay
      // null.
      qualityText: resolvePersistedEnhancementQualityText(segment),
    });
  }
  return updates;
}

export const MODE_SWITCH_REVERTS_PERSISTED_TEXT = false;
