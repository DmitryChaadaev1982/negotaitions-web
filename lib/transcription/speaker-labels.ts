import type { TranscriptionDiarized } from "openai/resources/audio/transcriptions";

export type NormalizedSegment = {
  speakerLabel: string | null;
  displaySpeakerLabel: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
  orderIndex: number;
};

export type SpeakerMapping = Record<string, string | null>;

export type ParticipantDisplayInfo = {
  id: string;
  displayName: string;
  type: string;
  roleName: string | null;
};

function formatSecondsAsTimestamp(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatSegmentTimeRange(
  startSeconds: number | null,
  endSeconds: number | null,
): string {
  if (startSeconds == null && endSeconds == null) {
    return "00:00:00";
  }

  if (startSeconds != null && endSeconds != null) {
    return `${formatSecondsAsTimestamp(startSeconds)}-${formatSecondsAsTimestamp(endSeconds)}`;
  }

  return formatSecondsAsTimestamp(startSeconds ?? endSeconds ?? 0);
}

function speakerLabelToDisplayIndex(rawLabel: string, labelOrder: string[]) {
  const index = labelOrder.indexOf(rawLabel);
  return index >= 0 ? index + 1 : labelOrder.length + 1;
}

export function getDisplaySpeakerLabel(
  rawLabel: string,
  labelOrder: string[],
): string {
  const index = speakerLabelToDisplayIndex(rawLabel, labelOrder);
  return `Speaker ${index}`;
}

export function normalizeDiarizationResponse(
  response: TranscriptionDiarized,
): NormalizedSegment[] {
  const labelOrder: string[] = [];

  for (const segment of response.segments) {
    if (!labelOrder.includes(segment.speaker)) {
      labelOrder.push(segment.speaker);
    }
  }

  return response.segments.map((segment, orderIndex) => ({
    speakerLabel: segment.speaker,
    displaySpeakerLabel: getDisplaySpeakerLabel(segment.speaker, labelOrder),
    startSeconds: segment.start,
    endSeconds: segment.end,
    text: segment.text.trim(),
    orderIndex,
  }));
}

export function getUniqueSpeakerLabels(
  segments: Pick<NormalizedSegment, "speakerLabel" | "displaySpeakerLabel">[],
): Array<{ speakerLabel: string; displaySpeakerLabel: string }> {
  const seen = new Set<string>();
  const labels: Array<{ speakerLabel: string; displaySpeakerLabel: string }> =
    [];

  for (const segment of segments) {
    if (!segment.speakerLabel || seen.has(segment.speakerLabel)) {
      continue;
    }

    seen.add(segment.speakerLabel);
    labels.push({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel:
        segment.displaySpeakerLabel ??
        getDisplaySpeakerLabel(segment.speakerLabel, labels.map((l) => l.speakerLabel)),
    });
  }

  return labels;
}

function resolveSpeakerDisplayName(
  speakerLabel: string | null,
  displaySpeakerLabel: string | null,
  mapping: SpeakerMapping | null | undefined,
  participantsById: Map<string, ParticipantDisplayInfo>,
  labelOrder: string[],
): string {
  if (!speakerLabel) {
    return displaySpeakerLabel ?? "Speaker";
  }

  const mappedParticipantId = mapping?.[speakerLabel] ?? null;
  if (mappedParticipantId) {
    const participant = participantsById.get(mappedParticipantId);
    if (participant) {
      if (participant.roleName) {
        return `${participant.displayName} / ${participant.roleName}`;
      }
      return participant.displayName;
    }
  }

  return displaySpeakerLabel ?? getDisplaySpeakerLabel(speakerLabel, labelOrder);
}

export function buildDiarizedText(
  segments: NormalizedSegment[],
  speakerMapping?: SpeakerMapping | null,
  participants?: ParticipantDisplayInfo[],
): string {
  if (segments.length === 0) {
    return "";
  }

  const labelOrder = getUniqueSpeakerLabels(segments).map(
    (label) => label.speakerLabel,
  );
  const participantsById = new Map(
    (participants ?? []).map((participant) => [participant.id, participant]),
  );

  return segments
    .map((segment) => {
      const speakerName = resolveSpeakerDisplayName(
        segment.speakerLabel,
        segment.displaySpeakerLabel,
        speakerMapping,
        participantsById,
        labelOrder,
      );
      const timeRange = formatSegmentTimeRange(
        segment.startSeconds,
        segment.endSeconds,
      );
      return `[${timeRange}] [${speakerName}] ${segment.text}`;
    })
    .join("\n\n");
}

export function applySpeakerMapping(
  segments: NormalizedSegment[],
  mapping: SpeakerMapping,
): Array<NormalizedSegment & { mappedParticipantId: string | null }> {
  return segments.map((segment) => ({
    ...segment,
    mappedParticipantId: segment.speakerLabel
      ? (mapping[segment.speakerLabel] ?? null)
      : null,
  }));
}

export function buildParticipantOptionLabel(
  participant: ParticipantDisplayInfo,
  typeLabels: Record<string, string>,
): string {
  const typeLabel = typeLabels[participant.type] ?? participant.type;
  if (participant.roleName) {
    return `${participant.displayName} — ${typeLabel} — ${participant.roleName}`;
  }
  return `${participant.displayName} — ${typeLabel}`;
}
