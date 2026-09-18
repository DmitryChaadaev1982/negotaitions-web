# Activity Source Lineage

## Source constants

- Defined in `lib/telemetry/audio-activity-sources.ts` (`1-18`):
  - `LIVEKIT_ACTIVE_SPEAKER`
  - `VOXIMPLANT_MIC_ACTIVITY`
  - `VOX_REMOTE_STREAM_ACTIVITY`

## Who emits what

### `VOXIMPLANT_MIC_ACTIVITY`
- Client emitter: local mic tracker (`lib/telemetry/voximplant-speaking-tracker.ts` `164-181`, `183-205`).
- Semantic: local participant speaking interval for the caller participant.
- Authorization: non-remote sources resolve to caller identity (`accepted -> targetSessionParticipantId=caller`) in `lib/telemetry/audio-activity-authorization.ts` (`34-59`).
- API path: `app/api/sessions/[sessionId]/audio-activity/route.ts` (`132-173`).

### `VOX_REMOTE_STREAM_ACTIVITY`
- Client emitter: facilitator-side remote-stream tracker (`lib/telemetry/voximplant-remote-speaking-tracker.ts` lifecycle at `45-108`).
- Semantic: observed remote participant stream, not reporter.
- Authorization enforcement:
  - facilitator required (`62-68`)
  - explicit target participant required (`69-75`)
  - target must be session participant and type PARTICIPANT (`77-91`)
  - target cannot be reporter (`92-99`)
  - then stores `targetSessionParticipantId` (`100-103`)
  in `lib/telemetry/audio-activity-authorization.ts`.

### `LIVEKIT_ACTIVE_SPEAKER`
- Present as default constant (`14` in `audio-activity-sources.ts`).
- In this primary sample, persisted rows are Voximplant mic/remote sources.

## Clock, units, normalization

- Server parser/normalizer: `lib/telemetry/audio-activity-event-processor.ts`.
- Units: seconds for offsets; milliseconds used internally for interval durations.
- Offset derivation:
  - `deriveOffsetSeconds(eventAt, recordingStart)` (`59-62`)
  - clamps negative to zero.
- Offset clamping:
  - `normalizeOffsetSeconds(offset, recordingDuration)` (`64-68`).
- Interval clamp to recording window:
  - `clampIntervalToRecording()` (`76-127`).
- Persisted fields:
  - `startedAt`, `endedAt`, `startedOffsetSeconds`, `endedOffsetSeconds`, `source`, `confidence`.

## Debounce / min interval / thresholds

- Mic tracker thresholds and debounce are client-side constants used before posting intervals:
  - `VOX_SPEAKING_ON_LEVEL`, `VOX_SPEAKING_OFF_LEVEL`, `VOX_END_DEBOUNCE_MS`, `VOX_MIN_INTERVAL_MS` in `voximplant-speaking-tracker.ts` (`5-9`, `89-93`, `141-147`).
- Remote tracker uses debounce/min interval similarly (`55-57`, `99-104` in `voximplant-remote-speaking-tracker.ts`).

## Pause/Resume timeline interaction

- Activity rows are initially recorded in real recording timeline.
- During mapping in `source_audio_cut`, activity is normalized to active timeline using:
  - `getActiveTimelineFromMetadata` and
  - `normalizeAudioActivityToActiveTimeline`
  in `lib/transcription/auto-speaker-mapping.ts` (`324-327`, `565-585`).

## Inversion investigation result

- Code-level semantics are correct (remote target is explicit remote participant, not observer).
- Primary sample DB rows are consistent with these semantics; no direct inversion defect found.
- Remaining ambiguity comes from overlap/coarse windows and mixed-mono diarization limitations, not authorization semantic inversion.

