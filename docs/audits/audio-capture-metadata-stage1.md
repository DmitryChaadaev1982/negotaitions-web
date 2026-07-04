# Audio capture metadata & 8 kHz origin (stage 1, Phase 7)

Observability-only. No recording-format redesign was performed this stage.

## Where the recording format is configured

The Voximplant recording profile is **not** driven by app env at runtime. It is
set inside the manually-pasted VoxEngine scenario
(`docs/voximplant/neg-conf.main-room.scenario.js`):

- `VoxEngine.createConference({ hd_audio: true })` — conference mix.
- `VoxEngine.createRecorder({ video: false, lossless: true })` — recorder.
- `conference.sendMediaTo(recorder)` — records the conference mix.

The env vars `VOXIMPLANT_RECORDING_AUDIO_MODE`, `VOXIMPLANT_RECORDING_VIDEO`,
`VOXIMPLANT_RECORDING_AUDIO_ONLY` and `AUDIO_RECORDING_TARGET_BITRATE_KBPS` do
**not** change what the recorder produces (see
`docs/audits/env-config-trace-stage1.md`). The scenario constants do.

## Where 8 kHz mono most likely originates

Ranked by likelihood, from the trace + code:

1. **Voximplant conference mix / recorder output (most likely).** The recorder
   captures the conference mix; the app cannot set the Vox recorder sample
   rate/channels. `lossless` selects FLAC but does not guarantee 48 kHz stereo —
   the conference mix codec/profile governs that.
2. Not our ffmpeg transcode: it targets 48 kHz mono (`AUDIO_TRANSCRIPTION_*`) and
   is **skipped** for small compatible files; even when it runs, resampling
   8 kHz → 48 kHz adds no information.
3. Not the S3 download step (byte-for-byte).
4. Not SpeechKit output (that is transcript text, not the stored recording).

Conclusion: **8 kHz mono is an upstream Voximplant capture characteristic**, not
an artifact of our transcription config. A definitive per-recording answer now
comes from the metadata hook below.

## Metadata hook added this stage

`lib/observability/audio-metadata.ts::probeAudioBuffer` runs `ffprobe` on the
downloaded original recording during each transcription run and records, into
`Transcript.processingMetadata.sourceAudioMetadata` and the
`[transcription-run]` structured log:

- container, codec, sample rate, channels, bitrate, duration, file size
- `isLowSampleRate` (≤16 kHz), `isMono`
- `probeAvailable` / `probeError` (graceful when ffprobe is missing)

These real values now drive the `low_sample_rate` / `mono_source` transcript
quality warnings (previously they could not fire because inputs were null).

## Acceptance

For each future recording, logs + `processingMetadata` show codec, sample rate,
channels, duration, file size, and the preprocessing decision — enough to
confirm the 8 kHz origin on the next real recording without code changes.

## Deferred (documented)

Switching the production recording format (e.g. forcing 48 kHz stereo) is
**not** done here: it requires editing + re-pasting the VoxEngine scenario and
re-validating webhook/storage/transcription compatibility. Recommended as a
follow-up once the ffprobe metadata confirms the exact Vox capture profile.
