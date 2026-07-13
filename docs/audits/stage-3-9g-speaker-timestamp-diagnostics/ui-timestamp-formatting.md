# UI Timestamp Formatting

## Exact formatter path

1. Backend serializes `TranscriptSegment.startSeconds` and `endSeconds` unchanged:
   - `app/api/sessions/[sessionId]/recording/route.ts` (`155-166`)
2. UI consumes these numeric seconds.
3. Timestamp formatter:
   - `components/recording-transcription-section.tsx` -> `formatTurnTime()` (`318-339`)
   - conversion uses `Math.floor(value)` for both start and end (`320-327`).
4. Diarized text formatter (server-side display string path) also uses `Math.floor`:
   - `lib/transcription/speaker-labels.ts` -> `formatSecondsAsTimestamp()` (`27-35`)
   - range builder `formatSegmentTimeRange()` (`37-49`)

## Behavior

- Input unit: seconds (floating-point).
- Rounding mode: floor/truncation to whole seconds.
- Start and end use the same rule.
- Display precision: `HH:MM:SS` only.
- `<1s` intervals:
  - valid DB interval `0.000-0.700` becomes `00:00:00-00:00:00`.
- Overlaps:
  - display can visually amplify overlap when both boundaries floor into the same/earlier second.
- Timeline basis:
  - for this subject transcript (`source_audio_cut`), these seconds are active-audio timeline values (not full recording wall-clock).

## Reproduction result for primary transcript

See `ui-timestamp-reproduction.csv`.

Key outcome:
- `[00:00:00-00:00:00]` is **not** a DB-invalid row.
- It is a valid sub-second interval rendered with whole-second floor precision.

