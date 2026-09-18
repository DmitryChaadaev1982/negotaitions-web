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
  Mapping persistence takes the Transcript row lock, rereads current
  `TranscriptSegment.text`, patches only mapping-owned columns, and
  rebuilds `diarizedText` from that current lexical text plus the mapping
  being saved. A pre-lock diarized snapshot is not persisted. Mapping
  remains editable while enhancement is `RUNNING` and does not revoke
  `publicationEligible`. Facilitator GET returns `transcriptId` +
  `retranscribeCount`. Facilitator POST must carry `transcriptId` +
  `expectedRetranscribeCount` as required currentness identity, not optional
  hints. Persistence locks Transcript, verifies locked `Transcript.id` and
  `retranscribeCount` against that payload, sanitizes the requested mapping
  against current speaker labels, and writes mapping-owned fields only.
  A stale generation N save against N+1 returns HTTP 409 `generation_mismatch`
  and writes nothing. Auto-mapping uses the same generation fence. The UI
  refreshes current mapping/transcript state in place and does not remount
  the transcript section for mapping or enhancement status changes. A new
  transcript `retranscribeCount` is generation identity and may remount so
  `/recording` hydrates that generation.
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
- Mapping-owned Transcript persist: `lib/transcription/mapping-persistence.ts`.
- Shared Transcript/AiAnalysis row locks: `lib/transcription/transcript-row-lock.ts`.
- Core matrix logic: `lib/transcription/auto-speaker-mapping-core.ts`.
- Candidate selection: `lib/transcription/speaker-mapping-candidates.ts`,
  `lib/transcription/speaker-mapping-candidate-load.ts`.
- Safety/readiness: `lib/transcription/mapping-safety.ts`, `lib/transcription/speaker-mapping-readiness.ts`, `lib/transcription/speaker-mapping-completeness.ts`.
- Shared post-processing projection: `lib/post-processing/projection.ts`.
- Transcript-generation currentness: `lib/post-processing/transcript-generation-currentness.ts`.
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
-   A structurally complete `AUTO_SUGGESTED` mapping is `informational` on
  materials, `/sessions`, and dashboard (not CONFIRMED, not a required
  blocker). The five-card rail still uses the shared completed/green success
  chrome and concise Ready/Готово status, because the mapping is already
  applied. The in-transcript success notice is one short line
  («Сопоставление выполнено автоматически») with a compact
  «Проверить / изменить» action that opens the same mapping editor and
  the `POST /api/sessions/:id/speaker-mapping` save used for required mapping.
  Authoritative transcript generation
  (`isActiveTranscriptGenerationStage`) is a mapping currentness lock for
  every view, including a refreshed tab that never set local `rerunBusy`.
  Prior `CONFIRMED` / `AUTO_SUGGESTED` chrome must not appear current while
  retranscription is active; edit/remap controls lock; prior transcript text
  may stay readable as the previous generation. Detailed diarized turns use
  `resolveDetailedTranscriptGenerationPresentation`: mapped names and
  provenance are current only when transcription is not active, the
  mounted `/recording` payload `retranscribeCount` matches materials/status,
  and that payload is not still an active generation snapshot after the
  same generation has completed.
  After the new generation is
  ready, mapping becomes current only when that generation’s mapping is
  valid. Ordinary Repeat Improve does not use this lock.
  Enhancement `QUEUED` / `RUNNING` does not hide that action. `REQUIRED` /
  `NEEDS_REVIEW` / incomplete mapping is `action_required` (non-completed
  rail) and blocks AI.
- Only automatic application may persist `AUTO_SUGGESTED`. A complete human
  mapping/transcript save persists `CONFIRMED` and must not create or revert
  to `AUTO_SUGGESTED`. Successful Start AI admission then confirms a
  structurally complete `AUTO_SUGGESTED` mapping (`speakerMappingConfirmedAt` /
  `By`) through the same `persistMappingOwnedTranscriptUpdate` authority as
  facilitator mapping, while the Transcript lock is held. If mapping is no
  longer `AUTO_SUGGESTED`, Analyze does not overwrite the newer mapping.
  There is no secondary direct `transcript.update` mapping writer.
  Incomplete `AUTO_SUGGESTED` still fails AI admission. The pre-AI advisory is
  informational; after AI admission the confirm-later banner is hidden.
- Speaker mapping is allowed while transcript enhancement is `QUEUED` or
  `RUNNING`. Mapping controls stay mounted across enhancement progress
  ticks, Continue, and in-place COMPLETED publication. The transcript
  section React identity does not include enhancement or mapping-required
  flags, so a mapping draft is not reset solely because enhancement status
  changed. Mapping and enhancement are distinct data planes. Enhancement
  provider output must not write `speakerLabel`, `mappedParticipantId`,
  `speakerMapping`, timestamp, or `orderIndex`. Atomic enhancement
  publication rereads the latest mapping inside the persist transaction.
- Manual speaker-attribution may change lexical text and therefore fences
  enhancement `publicationEligible` like a transcript save. Existing
  segments submit their persisted `TranscriptSegment.id`; newly inserted
  turns omit identity. Duplicate or unknown IDs fail closed. Same-structure
  attribution saves (including speaker-only participant changes) are
  those whose submitted IDs match the existing sequence 1:1 in order.
  Count equality is not sufficient. Those saves do not rewrite enhancement
  publication identity or unrelated per-segment digests. Any other
  structural change invalidates current applicability of order-index digest
  evidence. Mapping-only saves do not revoke eligibility.
- While Repeat transcription is running, leftover CONFIRMED / AUTO_SUGGESTED
  mapping is not projected as current for the new generation. The historical
  mapping row is kept; rail/cards wait until the new generation is mapped.
- Mapping, manual attribution, and transcript saves use
  `applyFacilitatorMaterialInputChange`. Mapping passes
  `fenceEnhancementPublication: false`. After a confirmed retranscription the
  old analysis is already non-current, so those saves do not warn about
  invalidating it. A later save after a new current AI analysis does warn.
- Enhancement fallback/partial/failed states are exposed explicitly; UI must retain truthful status while preserving raw transcript availability.

## Source Notes

- `lib/post-processing/projection.ts`, `lib/post-processing/enhancement-effective-state.ts`,
  `lib/post-processing/enhancement-ux-presentation.ts`
- `lib/post-processing/rail-tile-tone.ts`
- `lib/transcription/transcription-section-key.ts`
- `lib/transcription/auto-speaker-mapping.ts`
- `lib/transcription/mapping-persistence.ts`
- `lib/transcription/manual-speaker-turn-edits.ts`
- `lib/services/transcript-enhancement-publication.ts`
- `lib/transcription/transcript-row-lock.ts`
- `app/api/sessions/[sessionId]/speaker-mapping/route.ts`
- `lib/telemetry/**/*.ts`
- `tests/e2e/diarization-speaker-mapping.spec.ts`
