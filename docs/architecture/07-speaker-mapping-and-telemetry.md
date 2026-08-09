# 07 Speaker Mapping And Telemetry

## Goal

Map diarized transcript speakers (for example `speaker_1`) to actual session participants with confidence-aware, reviewable logic.

## Inputs

- Transcript segments with timing and speaker labels.
- Session participant audio activity windows.
- Telemetry source candidates (remote stream activity and local mic activity).

## Mapping Strategy

- Build overlap score matrix between transcript windows and telemetry windows.
- Pause handling depends on transcript pause processing mode:
  - `source_audio_cut` (production default): transcript is already on active timeline; no additional pause-window transcript filtering is applied.
  - `transcript_interval_filter` (legacy/deprecated fallback): exclude transcript windows that overlap persisted pause intervals.
- For `source_audio_cut`, telemetry rows are normalized from real timeline to active timeline before overlap scoring:
  - rows fully inside pause gaps are excluded;
  - rows crossing active/pause boundaries are split;
  - normalized windows preserve telemetry source preference (remote stream first, local mic fallback).
- Select one-to-one mapping candidate with margin/confidence constraints.
- Expose suggested mapping for facilitator confirmation.
- Persist auto-suggestion diagnostics in transcript metadata so materials status
  can show stable localized failure reasons such as `no_audio_activity`.
- Persist mapping and mapping status transitions in transcript record.

## Key Modules

- Mapping orchestration: `lib/transcription/auto-speaker-mapping.ts`.
- Core matrix logic: `lib/transcription/auto-speaker-mapping-core.ts`.
- Safety/readiness: `lib/transcription/mapping-safety.ts`, `lib/transcription/speaker-mapping-readiness.ts`.
- Telemetry processors:
  - `lib/telemetry/audio-activity-event-processor.ts`
  - `lib/telemetry/voximplant-speaking-tracker.ts`
  - `lib/telemetry/voximplant-remote-speaking-tracker.ts`

## API Surface

- `app/api/sessions/[sessionId]/speaker-mapping/route.ts`.
- `app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts`.
- `app/api/sessions/[sessionId]/materials/status/route.ts` (canonical readiness + polling contract).

## Readiness And Refresh Contract

- Transcript/mapping readiness is derived server-side in materials status DTO; clients should poll using `processing.shouldPoll` and stop when terminal.
- Facilitator mapping controls enable only from canonical backend readiness fields (no client-only guessing).
- Enhancement fallback/partial/failed states are exposed explicitly; UI must retain truthful status while preserving raw transcript availability.

## Source Notes

- `lib/transcription/auto-speaker-mapping.ts`
- `app/api/sessions/[sessionId]/speaker-mapping/route.ts`
- `lib/telemetry/**/*.ts`
- `tests/e2e/diarization-speaker-mapping.spec.ts`
