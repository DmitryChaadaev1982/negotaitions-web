# Speaker Mapping Data Lineage

## Entry points

- Suggestion engine: `lib/transcription/auto-speaker-mapping.ts` -> `suggestSpeakerMapping()` (`246-959`).
- Core one-to-one selection: `lib/transcription/auto-speaker-mapping-core.ts` -> `selectOneToOneMappingFromScoreMatrix()` (`20-95`).
- Telemetry source arbitration: `lib/transcription/speaker-mapping-telemetry-source-selection.ts` (`111-193`).
- Persistence API: `app/api/sessions/[sessionId]/speaker-mapping/route.ts` (`141-401`).

## Inputs

- Transcript windows (`speakerLabel`, `startSeconds`, `endSeconds`, `orderIndex`) from transcript segments.
- Audio activity intervals from `SessionParticipantAudioActivity`.
- Pause processing metadata (`source_audio_cut` vs legacy filter) from transcript metadata.

## Window handling

- Raw provider windows are used first.
- Pathology detector can trigger order-normalized windows:
  - `buildOrderNormalizedTranscriptWindows()` (`22-59` in `lib/transcription/order-normalized-transcript-windows.ts`)
  - used in mapping orchestration (`367-373`, `837-912` in `auto-speaker-mapping.ts`).

## Scoring formula

- For each `speakerLabel` and participant:
  - compute overlap duration between transcript windows and participant activity intervals.
  - compute coverage = overlap / total_speaker_duration.
- Stored per pair as:
  - `overlapMs`
  - `speakerDurationMs`
  - `coverage`
  in `buildScoreMatrixFromScoringWindows()` (`138-189` in `auto-speaker-mapping.ts`).

## Assignment logic

- Enumerates one-to-one assignments maximizing total coverage score (`32-59` in core file).
- Per speaker:
  - selected mapping participant id
  - confidence = selected coverage rounded (`82`)
  - margin = selected coverage - runner-up coverage (`84-92`).

## Source priority and fallback

- Preferred source: remote stream telemetry, unless disabled or unsafe.
- Fallback: local mic telemetry when remote unusable and local passes safety.
- Otherwise: `NONE` + manual review.
- Implemented in `selectTelemetrySourceForSpeakerMapping()` (`111-193`).

## Ambiguity and safety gates

Candidate is usable only if all conditions pass:
- complete speaker coverage
- minimum selected coverage threshold
- strictly positive margins
- one-to-one uniqueness (when >1 speaker)
- no blocking telemetry warnings

Defined in `candidateIsUsable()` (`78-89`) and helper functions in `speaker-mapping-telemetry-source-selection.ts`.

## Simultaneous speech handling

- Overlap is additive per interval; simultaneous participant activity reduces margin and often causes ambiguous/no-selection outcome.
- In such cases, output is intentionally `manual_review` with diagnostics.

## Persistence semantics

- Mapping is persisted in two places:
  - `Transcript.speakerMapping` cluster-level map
  - `TranscriptSegment.mappedParticipantId` per segment (`339-346` speaker-mapping API route)
- `speakerLabel` remains unchanged technical label (`speaker_N`).
- Mapping source metadata on segment is updated to `CLUSTER_MAPPING`.


