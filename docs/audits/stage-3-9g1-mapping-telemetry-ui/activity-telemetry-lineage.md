# Activity Telemetry Lineage

## Sources used by current mapping stack

- `VOXIMPLANT_MIC_ACTIVITY`: local participant mic-activity intervals produced in browser by `VoximplantSpeakingActivityTracker`.
- `VOX_REMOTE_STREAM_ACTIVITY`: remote participant speaking intervals observed by facilitator browser via `VoximplantRemoteSpeakingActivityTracker`.
- `LIVEKIT_ACTIVE_SPEAKER`: default/legacy source accepted by ingestion endpoint (used as default source constant).

No server-generated synthetic speaking source was found in mapping input path. Activity rows are persisted and later read from `SessionParticipantAudioActivity`.

## Semantics by source

- `VOXIMPLANT_MIC_ACTIVITY`
  - Emitter: participant browser (role-gated; facilitator/observer blocked).
  - `sessionParticipantId`: microphone owner (must be caller self).
  - Clock origin: browser wall clock (`Date`), plus optional offsets.
  - Interval lifecycle: open on mic level above `VOX_SPEAKING_ON_LEVEL`, close on debounce below `VOX_SPEAKING_OFF_LEVEL`.
- `VOX_REMOTE_STREAM_ACTIVITY`
  - Emitter: facilitator browser only.
  - `sessionParticipantId`: observed remote participant (target), not observer/facilitator id.
  - Clock origin: browser wall clock.
  - Interval lifecycle: per remote target speaking flag from remote audio stream analysis; close with debounce.
- `LIVEKIT_ACTIVE_SPEAKER`
  - Ingestion accepts it as default source; no active browser emitter in current Voximplant room path.
  - Meaning follows generic activity event semantics (`resolvedSessionParticipantId` target).

## Interval processing and normalization

- Ingestion route: `POST /api/sessions/[sessionId]/audio-activity`.
- Authorization: `authorizeAudioActivitySubmission()`:
  - local source: participant-only, self-only;
  - remote source: facilitator-only, target must be session participant of type `PARTICIPANT`, and not reporter.
- Processor: `processAudioActivityEvent()`:
  - supports start/end events and full `speaking_interval`;
  - clamps intervals to recording window when recording bounds exist;
  - computes or derives offsets relative to recording start;
  - rejects out-of-window or invalid intervals without DB write.

## Threshold/debounce/merge/min duration

- Client trackers:
  - `VOX_SPEAKING_ON_LEVEL=10`
  - `VOX_SPEAKING_OFF_LEVEL=6`
  - `VOX_END_DEBOUNCE_MS=800`
  - `VOX_MIN_INTERVAL_MS=50`
- Mapping normalization (`suggestSpeakerMapping()`):
  - drops short intervals (< `TELEMETRY_MIN_INTERVAL_MS=300`) unless overlapping diarized windows;
  - merges nearby intervals with gap <= `TELEMETRY_NORMALIZE_MERGE_GAP_MS=1200`.

## Pause/Resume behavior

- In `source_audio_cut` mode, transcript is already active-timeline based.
- Activity rows are normalized to active timeline via `normalizeAudioActivityToActiveTimeline()`:
  - rows in pause gaps excluded;
  - boundary-crossing rows split.
- In legacy `transcript_interval_filter`, transcript windows are filtered by pause intervals instead.

## Missing/duplicate/discontinuity behavior

- Missing telemetry produces warnings (`missing_participant_coverage`, `no_activity_for_participant`, etc.) and blocks auto-apply.
- Duplicate remote observations:
  - multiple facilitator clients can theoretically emit overlapping remote rows for same target (no DB uniqueness guard by source/interval/target);
  - mapping pipeline mitigates via merge/quality warnings, not dedup by reporter identity.
- Rejoin/reload discontinuities:
  - client timestamps may jump; server clamps to recording window and can derive offsets from absolute times.

## Persistence timing

- Activity rows are persisted during session runtime and can continue while recording statuses are active.
- Mapping reads all persisted activity rows at mapping time (post-transcription).

