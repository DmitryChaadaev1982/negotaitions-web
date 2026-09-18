# Stage 3 Audio Quality Audit

Date: 2026-07-01  
Branch: `exp/yandex-voximplant-main-room`

## Scope

This audit verifies the real audio path from Voximplant recording to Yandex SpeechKit and documents quality bottlenecks without changing Vox webhook contract, Vox scenario contract, Prisma schema, or SpeechKit internals.

## 1) Actual Voximplant recording output

Current codebase state:

- Recording webhook stores `fileKey` and status updates in `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`.
- The webhook payload contract does **not** currently persist explicit codec/sample-rate/channels/bitrate metadata from Voximplant into DB.
- No local sample recording file was present in repository at audit time.

Result:

- Container/codec/sample-rate/channels/bitrate for a real Vox recording are **not yet known from runtime data**.
- Required command for next real recording:

```bash
npm run inspect:audio -- "<path-to-recording-file>"
```

The command prints:

- container
- codec
- sampleRateHz
- channels
- bitrateKbps(stream)
- bitrateKbps(file)
- durationSec
- fileSizeBytes

## 2) Actual preprocessing/transcoding before SpeechKit

Observed in code:

- `lib/services/transcription-runner.ts` and `app/api/sessions/[sessionId]/transcribe-recording/route.ts` both call `compressAudioForTranscription(...)`.
- `lib/audio/compress.ts` now applies a minimal decision gate before ffmpeg:
  - if source size is below `AUDIO_TRANSCRIPTION_MAX_FILE_MB` **and** source format is compatible, the original file is reused for transcription;
  - otherwise, compression/transcoding remains available.
- Existing env vars used in path:
  - `AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS`
  - `AUDIO_TRANSCRIPTION_SAMPLE_RATE`
  - `AUDIO_TRANSCRIPTION_CHANNELS`
  - `AUDIO_TRANSCRIPTION_MAX_FILE_MB`

What was happening before Stage 3 fix:

- Original recording -> ffmpeg -> webm/opus (or mp3 fallback) -> SpeechKit.
- This could produce second lossy encode when original file was already lossy.
- With low bitrates/samplerate, quality loss likely occurred before SpeechKit.

What is now implemented:

- Minimal stabilization rule:
  - `AUDIO_TRANSCRIPTION_MAX_FILE_MB` is treated as a **compression threshold**, not a target to always recompress toward.
  - For files below threshold, pipeline keeps original quality by reusing the source buffer when format is compatible.
- Compression/transcoding still runs when needed:
  - source exceeds threshold;
  - source format is incompatible;
  - normalization fallback path is required by current pipeline behavior.
- Existing env vars remain valid when compression/transcoding is required:
  - `AUDIO_RECORDING_TARGET_BITRATE_KBPS`
  - `AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS`
  - `AUDIO_TRANSCRIPTION_SAMPLE_RATE`
  - `AUDIO_TRANSCRIPTION_CHANNELS`
  - `AUDIO_TRANSCRIPTION_MAX_FILE_MB`

## 3) SpeechKit request format

Observed in `lib/services/yandex-speechkit-transcription.ts`:

- API endpoint: `POST /stt/v3/recognizeFileAsync` + poll operation + `GET /stt/v3/getRecognition`.
- Audio sent as base64 in `content`.
- Container type is inferred from filename/mime or forced with `YANDEX_SPEECHKIT_AUDIO_CONTAINER`.
- Recognizer options include:
  - model (`YANDEX_SPEECHKIT_MODEL`)
  - language restriction (`YANDEX_SPEECHKIT_LANGUAGE` or hint)
  - text normalization flags
  - speaker labeling flag (`YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING`)

Channel behavior:

- Current app path generally sends mono (`AUDIO_TRANSCRIPTION_CHANNELS=1` unless overridden).
- Speaker labeling is diarization from recognition output, not guaranteed per-channel speaker separation.

## 4) Quality-risk analysis

Main risks confirmed:

1. Repeated lossy encoding risk (confirmed in previous path, now reduced by diagnostic passthrough).
2. Low bitrate risk (48 kbps may be too aggressive for mixed negotiation speech).
3. Downsampling risk (`16000` may remove detail compared to 48 kHz source).
4. Mono mixed-conference risk for diarization quality.
5. Overlap/noise risk in mixed room output.
6. Browser audio processing can alter signal before provider receives it.

Additional note:

- Transcript enhancement can improve readability but does not restore missing acoustic information from degraded input.

## 5) Comparison vs previous LiveKit path

Code-level conclusion:

- LiveKit and Voximplant use different recording paths; current Vox path quality issues are more likely from the app-side transcode policy than from SpeechKit model choice alone.
- Prior fixed low defaults (24/32 kbps in config fallback) increased risk when env was not explicitly tuned.
- This Stage 3 update reduces that risk with profile-driven defaults and diagnostic bypass.

## 6) Stage 3 POC env baseline

Current validated POC setup:

```env
AUDIO_TRANSCRIPTION_QUALITY_PROFILE=high
AUDIO_RECORDING_TARGET_BITRATE_KBPS=128
AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS=96
AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000
AUDIO_TRANSCRIPTION_CHANNELS=1
AUDIO_TRANSCRIPTION_MAX_FILE_MB=24
```

Observed smoke case (debug panel):

- Source/original file size: `392.3 KB`
- Prepared/transcription file size after recompression: `591.7 KB`

Conclusion:

- Recompression can increase size for short audio-only recordings.
- For this reason, files below `AUDIO_TRANSCRIPTION_MAX_FILE_MB` should skip recompression when compatible.

## 7) Remaining runtime evidence needed

After next real Vox recording, run:

```bash
npm run inspect:audio -- "<downloaded-recording-file>"
```

Then update this audit with actual:

- container
- codec
- sample rate
- channels
- bitrate
- duration
- file size

