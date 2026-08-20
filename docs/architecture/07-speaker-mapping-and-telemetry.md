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
  Mapping writers reread `processingMetadata` and merge only the
  `mappingSuggestion` namespace so enhancement/unknown keys survive.
- Persist mapping and mapping status transitions in transcript record.
  Persisted `diarizedText` uses `buildCanonicalDiarizedText` (lexical segment
  text + current mapping). Mapping must not rewrite lexical text.
  Auto-mapping triggered from a transcription run is bound to that run's
  `transcriptId` + `retranscribeCount`. A stale run cannot attach mapping to a
  newer generation. Confidence/margin thresholds and the 2x2 global-margin
  override are unchanged.

## Candidate Selection

Automatic mapping and facilitator review use the same canonical population.

1. Historical room presence is resolved by `resolveSpeakerMappingCandidates`
   using the existing recording/session/transcript evidence interval.
   Invitation alone is not enough. A participant who entered and later
   disconnected remains a candidate if their connection overlapped that
   interval.
2. Negotiation speaker eligibility then keeps `ParticipantType.PARTICIPANT`
   only via `selectNegotiationSpeakerMappingCandidates`. Facilitator and
   Observer rows do not become speaker candidates merely because they were
   present.

Both `autoTriggerSpeakerMappingAfterTranscription` and
`GET /api/sessions/[sessionId]/speaker-mapping` load that set through
`loadCanonicalSpeakerMappingCandidates`. Candidate selection happens before
scoring and coverage evaluation. Confidence, margin, override, many-to-one,
and remote→local fallback thresholds are unchanged.

## Key Modules

- Mapping orchestration: `lib/transcription/auto-speaker-mapping.ts`.
- Core matrix logic: `lib/transcription/auto-speaker-mapping-core.ts`.
- Candidate selection: `lib/transcription/speaker-mapping-candidates.ts`,
  `lib/transcription/speaker-mapping-candidate-load.ts`.
- Safety/readiness: `lib/transcription/mapping-safety.ts`, `lib/transcription/speaker-mapping-readiness.ts`, `lib/transcription/speaker-mapping-completeness.ts`.
- Shared post-processing projection: `lib/post-processing/projection.ts`.
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
- Structural completeness is one server invariant
  (`evaluateSpeakerMappingStructuralCompleteness`). Every spoken segment must
  have text, a speaker label when diarization requires mapping, and a
  `mappedParticipantId` that resolves to a same-session eligible
  `PARTICIPANT`. `mappingSuggestion.isApplied`, cluster JSON, a client draft,
  and the `AUTO_SUGGESTED` string alone are not completeness.
- A structurally complete `AUTO_SUGGESTED` mapping is `informational` on the
  rail, materials, `/sessions`, and dashboard. It is not an unresolved
  blocker. `REQUIRED` / `NEEDS_REVIEW` / incomplete mapping is
  `action_required` and blocks AI.
- Only automatic application may persist `AUTO_SUGGESTED`. A complete human
  mapping/transcript save persists `CONFIRMED` and must not create or revert
  to `AUTO_SUGGESTED`. Successful Start AI admission then confirms a
  structurally complete `AUTO_SUGGESTED` mapping (`speakerMappingConfirmedAt` /
  `By`) via `shouldConfirmAutoSuggestedMappingAfterAiAdmission`. Incomplete
  `AUTO_SUGGESTED` still fails AI admission. The pre-AI advisory is
  informational; after AI admission the confirm-later banner is hidden.
- While transcript enhancement is `RUNNING` inside the configured timeout
  window, speaker-mapping and manual attribution writes are rejected (409).
  After timeout/`SKIPPED` or any other terminal enhancement state, mapping
  unlocks. Transcript view remains allowed.
- Mapping, manual attribution, and transcript saves use
  `applyFacilitatorMaterialInputChange`. After a confirmed retranscription the
  old analysis is already non-current, so those saves do not warn about
  invalidating it. A later save after a new current AI analysis does warn.
- Enhancement fallback/partial/failed states are exposed explicitly; UI must retain truthful status while preserving raw transcript availability.

## Source Notes

- `lib/post-processing/projection.ts`, `lib/post-processing/enhancement-effective-state.ts`
- `lib/transcription/auto-speaker-mapping.ts`
- `app/api/sessions/[sessionId]/speaker-mapping/route.ts`
- `lib/telemetry/**/*.ts`
- `tests/e2e/diarization-speaker-mapping.spec.ts`
