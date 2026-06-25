import { prisma } from "@/lib/prisma";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export type AutoMappingSuggestion = {
  available: boolean;
  unavailableReason: string | null;
  mapping: SpeakerMapping;
  confidence: Record<string, number>;
};

type TranscriptWithSegments = {
  id: string;
  segments: Array<{
    speakerLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
  }>;
};

/**
 * Attempt to suggest speaker mapping using SessionParticipantAudioActivity
 * overlap with transcript segment timestamps.
 *
 * If no audio activity data exists, returns available=false with an explanation.
 * Never silently applies mapping — facilitator must confirm.
 */
export async function suggestSpeakerMapping(
  sessionId: string,
  transcript: TranscriptWithSegments,
): Promise<AutoMappingSuggestion> {
  // Check if timestamps are available in segments
  const segmentsWithTimestamps = transcript.segments.filter(
    (s) => s.speakerLabel && s.startSeconds != null && s.endSeconds != null,
  );

  if (segmentsWithTimestamps.length === 0) {
    return {
      available: false,
      unavailableReason: "no_timestamps",
      mapping: {},
      confidence: {},
    };
  }

  // Load audio activity for this session
  const activities = await prisma.sessionParticipantAudioActivity.findMany({
    where: { sessionId },
    orderBy: { startedAt: "asc" },
  });

  if (activities.length === 0) {
    return {
      available: false,
      unavailableReason: "no_audio_activity",
      mapping: {},
      confidence: {},
    };
  }

  // Load participants to map activity to displayNames
  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: { id: true, displayName: true, type: true },
  });

  const participantById = new Map(participants.map((p) => [p.id, p]));

  // Load recording start time so we can compute offsets for activities
  // that were stored with absolute timestamps only (no startedOffsetSeconds)
  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: { startedAt: true },
  });
  const recordingStartMs = recording?.startedAt?.getTime() ?? null;

  // Group activities by sessionParticipantId
  const activityByParticipant = new Map<
    string,
    Array<{ start: number; end: number }>
  >();

  for (const activity of activities) {
    let start = activity.startedOffsetSeconds;
    let end = activity.endedOffsetSeconds;

    // Fall back to computing offsets from recording start using absolute timestamps
    if (start == null && recordingStartMs != null) {
      start = (activity.startedAt.getTime() - recordingStartMs) / 1000;
    }
    if (end == null && recordingStartMs != null && activity.endedAt != null) {
      end = (activity.endedAt.getTime() - recordingStartMs) / 1000;
    }

    if (start == null) continue;
    const safeEnd = end ?? start + 1;

    const existing = activityByParticipant.get(activity.sessionParticipantId) ?? [];
    existing.push({ start, end: safeEnd });
    activityByParticipant.set(activity.sessionParticipantId, existing);
  }

  if (activityByParticipant.size === 0) {
    return {
      available: false,
      unavailableReason: "no_audio_activity_with_offsets",
      mapping: {},
      confidence: {},
    };
  }

  // Get unique speaker labels from transcript
  const speakerLabels = [
    ...new Set(
      segmentsWithTimestamps
        .map((s) => s.speakerLabel)
        .filter((l): l is string => Boolean(l)),
    ),
  ];

  // For each speaker label, compute overlap with each participant's activity
  const mapping: SpeakerMapping = {};
  const confidence: Record<string, number> = {};

  for (const speakerLabel of speakerLabels) {
    const speakerSegments = segmentsWithTimestamps.filter(
      (s) => s.speakerLabel === speakerLabel,
    );

    const totalSpeakerDuration = speakerSegments.reduce((sum, s) => {
      return sum + ((s.endSeconds ?? 0) - (s.startSeconds ?? 0));
    }, 0);

    if (totalSpeakerDuration === 0) continue;

    let bestParticipantId: string | null = null;
    let bestOverlap = 0;

    for (const [participantId, intervals] of activityByParticipant) {
      let overlap = 0;

      for (const segment of speakerSegments) {
        const segStart = segment.startSeconds ?? 0;
        const segEnd = segment.endSeconds ?? 0;

        for (const interval of intervals) {
          const overlapStart = Math.max(segStart, interval.start);
          const overlapEnd = Math.min(segEnd, interval.end);
          if (overlapEnd > overlapStart) {
            overlap += overlapEnd - overlapStart;
          }
        }
      }

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestParticipantId = participantId;
      }
    }

    if (bestParticipantId && participantById.has(bestParticipantId)) {
      const conf = bestOverlap / totalSpeakerDuration;
      mapping[speakerLabel] = bestParticipantId;
      confidence[speakerLabel] = Math.round(conf * 100) / 100;
    }
  }

  return {
    available: true,
    unavailableReason: null,
    mapping,
    confidence,
  };
}
