# Stage 3.8 Recording Audio Quality Audit

## 1. Executive summary

Verdict: **safe with minor observability optimization opportunity**.

- `source_audio_cut` did **not** introduce additional lossy compression in the analyzed latest production session.
- Active audio is generated as explicit PCM WAV (`pcm_s16le`, mono, 48 kHz), which is safe and compatible for current SpeechKit ingestion flow.
- No urgent code change is required for quality protection now.
- Optional low-risk hardening: persist structured pre-cut and post-cut ffprobe metadata in `Transcript.processingMetadata` to improve future audits and regressions triage.

## 2. Latest server session analyzed

- Session id: `cmrdgeetw0004ppm1c8dvn9vd`
- Session title: "Тест 55 — Переговоры на рынке"
- Session state/status: `FINISHED` / `READY`
- Recording id/status: `cmrdgfd9z000eppm1v7ysjj02` / `COMPLETED`
- Transcript id/status: `cmrdgg727000lppm1vil9ykp6` / `COMPLETED`
- Pause processing mode: `source_audio_cut`
- Pause intervals: 1 interval (`2026-07-09 12:00:04.395` -> `2026-07-09 12:00:08.706`)
- Duration metadata:
  - Source recording duration: `33977 ms`
  - Active audio duration: `29666 ms`
  - Removed pause duration: `4311 ms`
  - Active intervals count: `2`
- Storage references are present in DB/artifacts; sensitive key material and signed credentials are intentionally omitted here.

## 3. Source recording parameters

Evidence sources:
- `source-recording-info.json` artifact (source file identity and size)
- ffmpeg input diagnostics in `diagnostics.json` / `ffmpeg-command.txt` (because local source temp file was removed after processing)

Observed source characteristics for analyzed run:
- Container/file: `FLAC` (`source-recording.flac`)
- Codec: `flac`
- Sample rate: `8000 Hz`
- Channels: `mono (1)`
- Bit depth: `s16` (from ffmpeg input decode line)
- Duration: `00:00:33.91`
- Approx bitrate: `59 kb/s` (ffmpeg input line)
- Local source availability at audit time: not available (temp source cleaned up as designed)

Confidence level: **medium-high** (derived from ffmpeg runtime diagnostics rather than separate post-run ffprobe of source temp file).

## 4. FFmpeg/source_audio_cut behavior

The active-audio build command for the analyzed session:

- Input: `/tmp/pause-source-audio-.../source-recording.flac`
- Filter: `atrim + asetpts` per active interval, then `concat=n=2:v=0:a=1`
- Output flags: `-ar 48000 -ac 1 -acodec pcm_s16le -f wav .../active-audio.wav`

Behavior assessment:
- Pauses are removed by timeline trimming and concatenation, not by muting.
- Output codec/sample rate/channels are already explicit in code and runtime command.
- Output is linear PCM WAV (lossless PCM encoding at output stage).
- No evidence of fallback to legacy transcript-level filtering in this run.

## 5. Active audio parameters

From `ffprobe` on `active-audio.wav`:

- Container: `wav`
- Codec: `pcm_s16le`
- Sample rate: `48000 Hz`
- Channels: `1` (mono)
- Bit depth: `16-bit` (`sample_fmt=s16`, `bits_per_sample=16`)
- Bitrate: `~768 kb/s`
- Duration: `29.601 s`
- File size: `2,841,774 bytes`

Volume/clipping checks (`volumedetect`):
- Mean volume: `-23.0 dB`
- Max volume: `-0.0 dB`
- `histogram_0db` present (45 samples), indicating peaks reach full scale.

Interpretation:
- No aggressive low-volume risk (overall not too quiet).
- There is headroom concern only at peaks (near-0 dBFS), but no evidence this was introduced by a lossy compressor in this stage.

## 6. SpeechKit input compatibility

For this run, transcript metadata indicates:
- `selectedInputForSpeechKit = "original"` where "original" is already the `active-audio.wav` transcription source in `source_audio_cut` flow.
- `originalCompatibleWithSpeechKit = true`
- `transcriptionProvider = yandex_speechkit`
- `yandexSpeechKitModel = general:rc`

Suitability:
- WAV PCM mono is fully compatible with current SpeechKit request container inference.
- Current input format is safe and practical for recognition.

## 7. Quality-loss assessment

- Unavoidable upstream limitation: source recording in this run is narrowband-like (`8 kHz mono`) from provider path.
- `source_audio_cut` step itself does **not** add lossy codec compression:
  - Input decode from FLAC (lossless compressed source container),
  - Output to PCM WAV (`pcm_s16le`) without opus/mp3 transcode path.
- Sample rate changes from `8 kHz` to `48 kHz` (upsampling). This does not restore lost bandwidth but is not lossy by itself.
- Channels remain mono (no downmix event in this run because source is already mono).
- No repeated lossy re-encoding observed in this path.
- Diarization/transcription quality risk remains primarily from low-fidelity source capture profile, not from pause-cut ffmpeg stage.

## 8. Risks and edge cases

- Source ffprobe artifact was unavailable after run (temp cleanup expected), so source format confirmation relied on ffmpeg runtime logs.
- Mono + 8 kHz source can limit ASR detail and diarization separation quality.
- Resampling to 48 kHz may hide that true information content remains narrowband.
- Peak values close to 0 dBFS merit passive monitoring for clipping regression (no action required yet).
- Pause boundary trimming can still remove/clip tiny boundary phonemes in edge cases if pause timestamps are imprecise.
- FFmpeg command is explicit for codec/rate/channels (good), but structured original-vs-active audio metadata is not yet first-class in transcript JSON.

## 9. Recommendations

### 9.1 Leave as-is if safe

Recommended immediate action: **leave as-is**.

Why:
- No additional lossy compression in `source_audio_cut` output.
- Active audio format is deterministic and SpeechKit-compatible.
- Current pipeline is stable and explicit in codec/rate/channel controls.

### 9.2 Low-risk hardening if useful

Optional (not urgent):

1. Persist structured **pre-cut source ffprobe** metadata in `Transcript.processingMetadata` (container/codec/sampleRate/channels/bitDepth/bitrate/duration).
2. Persist structured **post-cut active-audio ffprobe** metadata alongside existing `ffmpegDiagnostics`.
3. Add a regression test asserting generated `active-audio.wav` format (`pcm_s16le`, expected sample rate/channels).
4. Add a warning flag when transcription input is lossy-compressed or when source sample rate is below threshold.

### 9.3 Changes not recommended now

- Do not add normalization/compression in `source_audio_cut` path without evidence.
- Do not add aggressive denoise.
- Do not downsample active-audio arbitrarily if source remains acceptable.

## 10. Proposed implementation prompt if changes are needed

No implementation prompt needed now.

## 11. Validation plan

1. Re-run server audit commands used in this report on next production-like session after any audio-related change.
2. Validate generated artifacts for the latest session:
   - `active-audio.wav`
   - `ffmpeg-command.txt`
   - `diagnostics.json`
   - `source-recording-info.json`
3. Confirm transcript metadata contains expected `pauseProcessing` diagnostics and SpeechKit selection fields.
4. Manual SpeechKit quality smoke on a controlled script with one pause window:
   - compare transcript coherence,
   - verify no paused speech leakage,
   - verify no new clipping/volume anomalies.
