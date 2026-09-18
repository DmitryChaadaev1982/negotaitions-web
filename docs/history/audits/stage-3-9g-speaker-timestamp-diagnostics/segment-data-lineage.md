# Segment Data Lineage

Primary subject:
- sessionId: `cmrhs7ms80003mvm1tc8jv7ks`
- recordingId: `cmrhsdmei004nmvm1m0e8dme6`
- transcriptId: `cmrhsg3fd0071mvm17z8j9oum`

## Field-level lineage (provider -> parser -> normalization -> DB -> API -> UI)

### `start timestamp`
- Provider field: alternative-level `start_time_ms` / `startTimeMs`, fallback `start_time_seconds` / `startTimeSeconds`.
- Parsing: `toSeconds()` and `toNumber()` in `lib/services/yandex-speechkit-transcription.ts` (`159-181`, `434-439`).
- Normalization: `extractSegmentsFromRecognition()` builds `NormalizedSegment.startSeconds` (`411-526`).
- Timeline conversion:
  - `source_audio_cut` mode creates active-audio timeline before ASR in `runRealTranscription()` (`423-457` in `lib/services/transcription-runner.ts`).
  - No post-ASR timestamp restoration is applied before persistence in this mode.
- Persistence: `tx.transcriptSegment.createMany({ startSeconds: segment.startSeconds })` in `lib/services/transcription-runner.ts` (`951-969`).
- Serializer:
  - recording API: `segments` selected with `orderBy { orderIndex: "asc" }`, serialized with `startSeconds` unchanged (`49-51`, `155-166` in `app/api/sessions/[sessionId]/recording/route.ts`).
  - speaker-mapping API: same ordering/field passthrough (`60`, `184`, `386-397` in `app/api/sessions/[sessionId]/speaker-mapping/route.ts`).
- UI formatter: `formatTurnTime()` uses `Math.floor` whole-second display (`318-339` in `components/recording-transcription-section.tsx`).

### `end timestamp`
- Provider field: alternative-level `end_time_ms` / `endTimeMs`, fallback `end_time_seconds` / `endTimeSeconds`.
- Parsing/normalization: same path as `start` (`434-439`, `451-458` in `lib/services/yandex-speechkit-transcription.ts`).
- Persistence/API/UI: same path as `start` (`958-959` in runner, `160` in recording route, `318-339` UI).

### `speaker label` (technical)
- Provider field: `speaker_tag` / `speakerTag` or `channel_tag` / `channelTag` on record/alternative (`422-447` in `lib/services/yandex-speechkit-transcription.ts`).
- Parser: `extractLabel()` (`183-191`) extracts raw provider label (for this subject, raw labels are `"0"` and `"1"` per metadata segmentQuality).
- Normalization: `normalizeSpeakerLabel(raw, labelOrder)` maps first-seen raw label to `speaker_1`, next to `speaker_2` (`403-409`).
- Persistence: `speakerLabel: segment.speakerLabel` in createMany (`956` in `lib/services/transcription-runner.ts`).
- API serialization: direct passthrough (`157-158` in recording route, `388-389` in speaker-mapping route).
- UI display alias:
  - `getDisplaySpeakerLabel()` renders `Speaker N` from label order (`57-63` in `lib/transcription/speaker-labels.ts`).
  - Recording API attaches `displaySpeakerLabel` (`163-165` in recording route).

### `text`
- Provider parse: best alternative text from normalized/text/utterance/words via `extractAlternativeText()` and `selectBestAlternative()` (`310-360`, `428-433` in `lib/services/yandex-speechkit-transcription.ts`).
- Pre-persistence: pause-mode filtering may drop segments only in legacy mode; in `source_audio_cut`, kept as-is (`33-40` in `lib/transcription/pause-segment-processing.ts`).
- Persistence: `text: segment.text` (`960` in transcription runner).
- Enhancement update path: only `text`/`qualityText` are updated, not timestamps/speaker labels (`441-449` and `471-479` in `lib/services/transcript-enhancement-orchestration.ts`).

### `confidence`
- Provider parse: `confidence` / `confidence_score` via `toNumber()` (`449-450` in `lib/services/yandex-speechkit-transcription.ts`).
- Stored in metadata only (`segmentQuality` object at runner `777-785`); not persisted to `TranscriptSegment.confidence` column (no such column in schema).

### `provider order` and `orderIndex`
- Initial provider traversal order: nested records with alternatives in `extractSegmentsFromRecognition()` (`416-485`).
- Dedup pass preserves encountered order and resets contiguous `orderIndex` (`489-523`).
- Persistence and API ordering remain `orderIndex asc` (`951-969` runner; `49-51` recording API; `60` and `184` speaker-mapping API).

### `timeline type`
- Current subject mode from metadata: `pauseProcessing.mode = source_audio_cut`.
- This means persisted transcript timestamps are active-audio timeline seconds (post-cut), not original full-recording wall-clock offsets.

### `participant assignment`
- Mapping field storage:
  - `Transcript.speakerMapping` cluster map.
  - `TranscriptSegment.mappedParticipantId` per segment (`588-603` schema; updates in `339-346` speaker-mapping API route).
- `speakerLabel` is not rewritten during mapping; assignment is stored separately.

## Primary session factual values

- Persisted segment count: `22`.
- Persisted `orderIndex`: `0..21`.
- Adjacent overlaps by `orderIndex`: `19` pairs.
- Floor-rounded zero-length displays: `1` row (`0.000-0.700s` rendered as `00:00:00-00:00:00`).

## DeepSeek enhancement effect (Part G)

Observed and code-confirmed behavior:
- Enhancement input contains segment identity and timing (`index`, `segmentId`, `startMs`, `endMs`) (`146-156` in `lib/services/transcript-enhancement-orchestration.ts`).
- Persistence updates only text fields (`443-449`, `471-479`).
- No writes to:
  - `TranscriptSegment.startSeconds`
  - `TranscriptSegment.endSeconds`
  - `TranscriptSegment.speakerLabel`
  - `TranscriptSegment.orderIndex`
  - `TranscriptSegment.mappedParticipantId`

Conclusion: enhancement does **not** contribute to timestamp overlap, ordering, or technical speaker-label issues.


