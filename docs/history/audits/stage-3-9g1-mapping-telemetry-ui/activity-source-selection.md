# Activity Source Selection

Selection logic is implemented in:

- `lib/transcription/auto-speaker-mapping.ts` (build/evaluate candidates per source)
- `lib/transcription/speaker-mapping-telemetry-source-selection.ts` (final source choice)
- `lib/transcription/windowed-source-selection.ts` (raw vs order-normalized transcript windows)

## Priority

- Default preference is remote stream telemetry (`SPEAKER_MAPPING_PREFER_REMOTE_STREAM_TELEMETRY !== false`).
- If remote is unusable and local is usable, local fallback is selected.
- If both are usable and agree, remote is kept.
- If both usable but disagree without clear winner, selection returns `NONE` and forces manual review.

## Usability gates per source candidate

A source is usable only if all are true:

- candidate available;
- all labels covered;
- selected coverage per label meets minimum threshold;
- strictly positive margins;
- one-to-one safe (for multi-label cases);
- no blocking telemetry warnings.

Blocking warnings include: `missing_participant_coverage`, `participant_low_activity`, `telemetry_imbalanced`, `alignment_unreliable`, `no_activity_for_participant`, `low_activity_for_participant`, `row_imbalance`, `duration_imbalance`.

## Behavior in requested edge cases

1. Only one participant has telemetry:
   - warning set includes missing/low coverage;
   - source becomes unusable for auto-apply;
   - decision falls to manual review (`NONE`) or non-applied suggestion path.
2. One participant has mic and another only remote:
   - evaluated as separate source candidates;
   - if disagreement/no clear winner -> `NONE` with `sources_disagree_without_clear_winner`.
3. Combining source types:
   - no mixed-source composite matrix is built for one mapping run;
   - one source is selected globally per run.
4. Double counting risk:
   - same underlying speech can be observed in both source families if both are persisted;
   - selection chooses one source, but diagnostics still carry both score matrices.
5. Remote activity identity semantics:
   - persisted under observed remote participant id, not facilitator reporter id (authorization enforces this).

## Diagnostics storage and UI exposure

- Stored under `Transcript.processingMetadata.mappingSuggestion`:
  - `selectedTelemetrySource`, `fallbackReason`, `sourceDecisionSummary`,
  - per-source score matrices/warnings/reasons,
  - telemetry quality/health.
- Exposed via recording/materials APIs as mapping diagnostics fields and failure reason resolution.

## Selection granularity

- Source selection is global per mapping run (session/transcript scope), not per segment.
- Candidate scoring is label-level (speaker cluster), not per individual segment.

