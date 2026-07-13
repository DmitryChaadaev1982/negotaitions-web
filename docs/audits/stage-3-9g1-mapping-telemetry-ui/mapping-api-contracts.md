# Mapping API Contracts

## `GET /api/sessions/[sessionId]/speaker-mapping`

- Auth: room participant; edit rights only for facilitator.
- Response fields:
  - `transcriptId`
  - `speakerMappingStatus`
  - `speakerMappingConfirmedAt`, `speakerMappingConfirmedBy`
  - `hasSpeakerDiarization`, `diarizationStatus`
  - `detectedSpeakers[] { speakerLabel, displaySpeakerLabel, suggestedParticipantId, mappedParticipantId }`
  - `participants[] { sessionParticipantId, displayName, participantType, roleName }`
  - `canEdit`
- Source for mapping prefill: `resolveSpeakerMappingForUi()`.

## `POST /api/sessions/[sessionId]/speaker-mapping`

- Auth: facilitator only.
- Request fields:
  - `mapping: Record<label, participantId|null>`
  - `confirm: boolean`
  - `applyToTranscript: boolean`
  - `suggestAutomatically: boolean`
  - `forceOverrideLocked: boolean`
  - `applyOnly: boolean` (legacy re-apply diarized text path)
- Behaviors:
  - `suggestAutomatically=true`: returns suggestion only (`suggestedMapping`, `confidence`, `telemetryQuality`, `telemetryHealth`, `available`, `unavailableReason`).
  - otherwise saves/confirms mapping and updates segments.
- Response includes updated transcript and segments with:
  - `speakerMapping`, `speakerMappingStatus`, `speakerMappingConfirmedAt`
  - segment-level `speakerLabel`, `mappedParticipantId`, `mappingSource`, `mappingLocked`, `mappingConfidence`.

## `GET /api/sessions/[sessionId]/recording`

- Facilitator-gated endpoint for full mapping diagnostics in this workflow.
- Mapping fields exposed:
  - `transcript.speakerMappingStatus`
  - resolved `transcript.speakerMapping`
  - `mappingFailureReason`, `mappingFailureI18nKey`, `mappingFailureCompactI18nKey`
  - `mappingFailureDetails`
  - `mappingSuggestionDiagnostics`
  - segment list with `speakerLabel`, `mappedParticipantId`.

## `GET /api/sessions/[sessionId]/materials/status`

- Exposes processing and mapping readiness for post-processing UI.
- Mapping-related fields:
  - `transcription.speakerMappingStatus`
  - `transcription.speakerMappingRequired`
  - `transcription.speakerMappingConfirmed`
  - same mapping failure fields as recording API
  - `processingMetadata` (facilitator).

## `POST /api/sessions/[sessionId]/manual-speaker-attribution`

- Auth: facilitator only.
- Request: `turns[] { participantId, text, startSeconds?, endSeconds? }`.
- Behavior:
  - upsert manual transcript;
  - rebuild segments;
  - set mapping status `CONFIRMED`.

## `POST /api/sessions/[sessionId]/audio-activity`

- Request supports `SPEAKING_START`, `SPEAKING_END`, `speaking_interval`.
- Fields include `source`, `sessionParticipantId`, timestamps/offsets, `audioLevel`, telemetry calibration.
- Authorization and target semantics enforced by source.
- Mutation persists rows in `SessionParticipantAudioActivity` or closes open interval.

## UI-ready mapping data already available

- Global mapping status and confirmation metadata.
- Label-level mapping (resolved persisted or suggestion prefill).
- Suggestion availability/unavailability reasons.
- Confidence, margins, telemetry quality/warnings inside diagnostics.
- Failure i18n keys for compact/full warning text.
- Participant names and technical labels for selectors and rendering.

