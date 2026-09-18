# Transcription observability (stage 1)

Deliverable note for Phase 1. Describes what is now logged/stored and where.

## No migration required

All new data is stored in the existing `Transcript.processingMetadata` (`Json?`)
column. No Prisma schema change and no migration were added for Phase 1.
Per-segment forensic metadata (confidence, raw speaker labels) is stored inside
`processingMetadata.segmentQuality` rather than as new `TranscriptSegment`
columns, to avoid a risky migration this stage (documented limitation).

## 1. Structured run log

`lib/observability/transcription-observability.ts::logTranscriptionRun` emits a
single greppable JSON line prefixed `[transcription-run]` from
`lib/services/transcription-runner.ts` after each successful run. Fields:
`sessionId`, `recordingId`, `transcriptId`, `provider`, source file metadata,
preprocessing decision, SpeechKit request mode, diarization enabled/status,
raw result count, normalized segment count, transcript chars, speaker label
count, mapping status, AI-analysis readiness, whether a raw snapshot was stored,
and quality warnings.

## 2. Preprocessing / ffmpeg decision log

`processingMetadata.preprocessDecision` records: `originalSizeBytes`,
`thresholdBytes`, `mimeType`, `container`, `compatibleContainer`, `skipped`,
`reason` (`under_threshold_and_compatible_container` | `over_size_threshold` |
`incompatible_container` | `transcoded`), `outputCodec`, `outputFormat`.

## 3. Raw provider response snapshot

`processingMetadata.rawProviderSnapshot` stores a **sanitized, size-bounded**
(≤256 KB) copy of the Yandex SpeechKit `getRecognition` response for forensic
debugging. `sanitizeRawProviderSnapshot` strips base64 audio (`content`) and
any auth/secret-looking keys and truncates over-long strings. It is linked to
`sessionId`/`recordingId`/`transcriptId` via the row it lives on. It is stored
in DB (not a file) because `processingMetadata` is already the canonical place
for run diagnostics. Truncation is flagged (`truncated: true`) when the payload
exceeds the cap.

Never stored: tokens, `Api-Key`, `x-folder-id`, signed URLs, base64 audio.

## 4. Segment-level metadata

- `NormalizedSegment` gained optional `confidence` and `rawSpeakerLabel`.
- Yandex SpeechKit now populates both (confidence from the chosen alternative,
  raw channel/speaker tag before `speaker_N` normalization).
- `processingMetadata.segmentQuality[]` preserves per-segment `orderIndex`,
  normalized `speakerLabel`, `rawSpeakerLabel`, `confidence`, timestamps, and
  char count (capped at 2000 segments).
- Timestamps and normalized labels remain in `TranscriptSegment` rows as before.

## 5. Transcript quality counters + warnings

`processingMetadata.qualityReport` (`computeTranscriptQualityReport`):
`totalSegments`, `emptySegments`, `averageConfidence`, `lowConfidenceSegments`,
`speakerCount`, `transcriptChars`, `transcriptWords`, `durationSeconds`,
`charsPerMinute`, `wordsPerMinute`, and `warnings`:
`low_sample_rate`, `mono_source`, `no_raw_provider_snapshot`,
`no_speaker_activity`, `low_confidence`, `suspiciously_short_transcript`.

`no_speaker_activity` is derived from a live count of
`SessionParticipantAudioActivity` rows for the session (also stored as
`processingMetadata.audioActivityRowCount`). `low_sample_rate` / `mono_source`
are emitted only when the actual source sample rate / channel count is known;
Phase 7 wires the ffprobe metadata source that will populate those inputs.

## Not done this stage (intentional)

- AI analysis is **not** blocked by the quality gate — warnings are advisory
  only (per prompt: add quality status/warnings first).
- Raw snapshot is stored in DB JSON, not a separate table/file archive.
- Actual `sourceSampleRate` / `sourceChannels` inputs are `null` until Phase 7
  metadata capture runs on a real recording.
