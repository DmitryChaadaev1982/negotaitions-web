# 08 — Env config trace (stage 1)

Mandatory config-audit deliverable for the stage-1 implementation prompt.
Goal: prove whether the required behavior can be achieved by correctly wiring
existing env parameters before inventing new ones.

Branch: `fix/vox-transcription-telemetry-stage1` (base `deploy/yandex-poc`).
Runtime provider (`.env`): `VIDEO_PROVIDER=voximplant`, `TRANSCRIPTION_PROVIDER=yandex_speechkit`.

> Note: this repo ships a local `.env` (not `.env.production`). The duplicate
> `AUDIO_TRANSCRIPTION_MAX_FILE_MB` key exists in that `.env`.

## Duplicate-key resolution (`AUDIO_TRANSCRIPTION_MAX_FILE_MB`)

`.env` lines 76 and 79:

```
AUDIO_TRANSCRIPTION_MAX_FILE_MB="20"   # line 76
AUDIO_TRANSCRIPTION_MAX_FILE_MB="24"   # line 79
```

- dotenv and Next.js `.env` loading are **last-value-wins** for duplicate keys.
- Effective runtime value: **`24`** → `getAudioTranscriptionMaxFileBytes()` returns `24 * 1024 * 1024` (MiB-style bytes).
- No ambiguity at runtime, but the duplicate is a maintenance hazard and should be de-duplicated.
- Consumer: `lib/audio/config.ts::getAudioTranscriptionMaxFileBytes()` (reads `process.env.AUDIO_TRANSCRIPTION_MAX_FILE_MB`, default by profile = `24` for `standard`).

## Trace table

| Env variable | Value in production | File(s) where read | Runtime consumer | Actually affects production? | Observed effect | Gap / issue | Recommended action |
|---|---|---|---|---|---|---|---|
| `AUDIO_RECORDING_TARGET_BITRATE_KBPS` | `128` | `lib/audio/config.ts:39` | `getAudioRecordingTargetBitrateKbps()` → only read in `lib/services/transcription-runner.ts` `processingMetadata` (reporting) | **No effect on recording.** Reported only. | Stored in `Transcript.processingMetadata` for display; never sent to Voximplant recorder. | Name implies it controls Vox recording bitrate; it does not. Vox recorder bitrate is fixed by the pasted VoxEngine scenario (`lossless`). | Keep as reporting-only OR rename/deprecate. Do NOT rely on it for Vox capture quality. Documented, no code change this stage. |
| `AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS` | `96` | `lib/audio/config.ts:42` | `getAudioTranscriptionTargetBitrateKbps()` → `lib/audio/compress.ts` ffmpeg `audioBitrate` | Yes, **only when ffmpeg transcodes** (i.e. gate not skipped). | Sets opus/mp3 target bitrate during transcode. | Skipped entirely when source is ≤ threshold AND container compatible (passthrough). | Correctly wired for the transcode path. No change. |
| `AUDIO_TRANSCRIPTION_MAX_FILE_MB` | `24` (dup: `20` then `24`) | `lib/audio/config.ts:65` | `getAudioTranscriptionMaxFileBytes()` → `compress.ts` gate + runner size guard | Yes. | Passthrough gate + post-compress size guard (413 on exceed). | Duplicate key in `.env`. | De-dup `.env` (leave a single `=24`). Effective value already correct. |
| `AUDIO_TRANSCRIPTION_SAMPLE_RATE` | `48000` | `lib/audio/config.ts:50` | `getAudioTranscriptionSampleRate()` → `compress.ts` ffmpeg `audioFrequency` | Yes, **only when ffmpeg transcodes**. | Resamples during transcode. | **Skipped when gate skips small compatible files** (answer to Q5). Also cannot restore quality lost upstream (8 kHz source → 48 kHz resample adds no information). | Wired correctly for transcode; the 48 kHz value does not fix an 8 kHz *source*. See Phase 7. |
| `AUDIO_TRANSCRIPTION_CHANNELS` | `1` | `lib/audio/config.ts:58` | `getAudioTranscriptionChannels()` → `compress.ts` ffmpeg `audioChannels` | Yes, **only when ffmpeg transcodes**. | Forces mono output on transcode. | Confirms app **downmixes to mono** on transcode; if the goal is stereo diarization, this env forces mono (loses per-channel speaker separation). | Documented. If per-channel diarization is desired later, this must change (out of scope this stage). |
| `YANDEX_SPEECHKIT_MODEL` | `general:rc` | `lib/env.ts:68`, `scripts/yandex-speechkit-smoke.ts:22` | `getYandexSpeechKitModel()` → SpeechKit `recognition_model.model` | **Yes** — reaches request (`yandex-speechkit-transcription.ts:618,645`). | Model passed verbatim to `/stt/v3/recognizeFileAsync`. | `general:rc` is a valid SpeechKit v3 model string. | No change. Now also logged in the run summary (Phase 1). |
| `YANDEX_SPEECHKIT_LANGUAGE` | `ru-RU` | `lib/env.ts:72` | `getYandexSpeechKitLanguage()` → `language_restriction` WHITELIST | **Yes**, unless caller passes a `languageHint` (`ru`/`en`) which maps first. `auto` → env value. | `language_code: ["ru-RU"]` in WHITELIST. | Language hint can override env (by design). | No change. |
| `YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING` | `true` | `lib/env.ts:102` | `isYandexSpeechKitSpeakerLabelingEnabled()` → `speaker_labeling.speaker_labeling` | **Yes** — request sends `SPEAKER_LABELING_ENABLED`. | Diarization requested from provider. | Labeling is enabled; whether **useful** depends on source audio (mono 8 kHz weakens it). | No change to wiring. Now recorded per-run + counters (Phase 1). |
| `YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED` | `true` | `lib/env.ts:86` | `isYandexSpeechKitTextNormalizationEnabled()` → `text_normalization.text_normalization` | **Yes** — `TEXT_NORMALIZATION_ENABLED`. | Provider-side normalization on. | None. | No change. |
| `YANDEX_SPEECHKIT_LITERATURE_TEXT` | `true` | `lib/env.ts:90` | `isYandexSpeechKitLiteratureTextEnabled()` → `text_normalization.literature_text` | **Yes** — boolean passed. | Literature formatting on. | None. | No change. |
| `YANDEX_SPEECHKIT_PROFANITY_FILTER` | `false` | `lib/env.ts:94` | `isYandexSpeechKitProfanityFilterEnabled()` → `text_normalization.profanity_filter` | **Yes** — boolean passed. | Profanity filter off. | None. | No change. |
| `YANDEX_SPEECHKIT_PHONE_FORMATTING` | `false` | `lib/env.ts:98` | `isYandexSpeechKitPhoneFormattingEnabled()` → `phone_formatting_mode` | **Yes** — `PHONE_FORMATTING_MODE_DISABLED`. | Phone formatting off. | None. | No change. |
| `VOXIMPLANT_RECORDING_PANEL_ENABLED` | `true` | `lib/voximplant-test/config.ts:107`, `components/voximplant-test-client.tsx:1162` | `isVoximplantRecordingPanelEnabled()` | **UI only** (also gates `isVoximplantRecordingEnabled()` in the test-client path). | Shows facilitator recording panel. | Name suggests broader effect; it gates panel visibility + the test-client enable check. | No change. |
| `VOXIMPLANT_RECORDING_ENABLED` | `true` | `lib/voximplant/config.ts:50`, `lib/voximplant-test/config.ts:114`, `lib/services/admin-health.ts:100` | `getVoximplantConfig().recording.enabled` + panel gate | Partial. Feature/UI flag. | Enables recording feature flow server-side + health display. | Does not itself start the recorder (browser relay + scenario does). | No change. |
| `VOXIMPLANT_RECORDING_VIDEO` | `false` | **none (code)** — only docs | — | **No** — not read anywhere in `app/components/lib/prisma/scripts/server`. | No runtime effect. | **Dead env var.** Actual `video:false` is hardcoded in the pasted VoxEngine scenario (`neg-conf.main-room.scenario.js:1016`). | Documented gap. Either wire it into the dispatch/scenario or mark deprecated. No code change this stage (scenario is manually pasted). |
| `VOXIMPLANT_RECORDING_AUDIO_ONLY` | `true` | `lib/voximplant/config.ts:51` | `getVoximplantConfig().recording.audioOnly` → dispatch `recordingConfig.audioOnly` (returned to browser) | Weak. Returned to client in `recording-control` response. | Informative flag sent to browser. | The scenario records audio-only regardless (hardcoded `video:false`); the flag is not consumed by the recorder. | Documented gap. |
| `VOXIMPLANT_RECORDING_AUDIO_MODE` | `lossless` | `lib/voximplant/config.ts:26` | `getRecordingAudioMode()` → dispatch `recordingConfig.audioMode` (returned to browser) | **No effect on actual recorder.** | Returned in `recording-control` response `recordingConfig`. | The scenario `createRecorder` uses its **own** hardcoded `RECORDING_AUDIO_MODE="lossless"` const (`scenario.js:60,1020`); the `scenarioMessage` relayed to the conference carries no `audioMode`. So env only matches by coincidence. | Answer to Q3: `lossless` has an effect **only because the pasted scenario also hardcodes lossless**, not because our env drives it. To truly drive it, the scenario message must carry audioMode and the scenario must read it. Out of scope this stage; documented. |
| `VOXIMPLANT_RECORDING_PAUSE_ENABLED` | `false` | `lib/voximplant/config.ts:31,35` | `getRecordingPauseEnabled()` → dispatch `recordingConfig.pauseEnabled` | Weak. Returned to browser. | Informative; UI hides pause anyway. | Scenario supports pause internally regardless. | No change. |
| `VOXIMPLANT_RECORDING_STORAGE` | `s3` | `lib/voximplant/config.ts:73`, `lib/voximplant-test/config.ts:121` | `getVoximplantConfig().recordingStorage` / `getVoximplantRecordingStorage()` | Informational/hint. | Storage hint surfaced to config; actual S3 upload path is driven by our `lib/storage/s3.ts` after webhook handoff. | Storage location is effectively determined by Voximplant recorder output + our webhook/S3 ingest, not by this hint. | No change. |

## Specific questions — answers

1. **Why mono FLAC 8 kHz despite `AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000`?**
   The 48 kHz value only applies to the **ffmpeg transcode** step (`compress.ts`),
   which resamples toward 48 kHz. It cannot recover information lost upstream and
   it is skipped entirely for small compatible files. The 8 kHz/mono characteristic
   originates from the **Voximplant recorder / conference mix output**, not from our
   transcription config. (See Phase 7 hook.)
2. **Where is 8 kHz generated?** Not by our recording *request* env (it is not wired to the recorder),
   not by S3 download, not by our transcription config. Most probable source: the
   VoxEngine conference recording pipeline (conference mix / codec profile of the pasted scenario).
   Our code path *cannot* set the Vox recorder sample rate today. Confirmation requires ffprobe on a
   fresh recording — Phase 7 adds the metadata capture hook to make this deterministic.
3. **Does `VOXIMPLANT_RECORDING_AUDIO_MODE=lossless` have real effect?**
   Not through our env. The pasted scenario hardcodes `RECORDING_AUDIO_MODE="lossless"`.
   Our env value happens to match, but changing the env alone would not change the recorder.
4. **Does `AUDIO_RECORDING_TARGET_BITRATE_KBPS=128` affect Vox recording?** No. Reporting only.
5. **Does `AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000` affect only ffmpeg conversion (skipped for small files)?** Yes.
6. **Is the duplicate `AUDIO_TRANSCRIPTION_MAX_FILE_MB` causing ambiguity?** No — last-value-wins → `24`. But de-dup recommended.
7. **Are SpeechKit options actually passed to the provider request?** Yes — all seven are wired into the v3 `recognizeFileAsync` payload.
8. **Is speaker labeling enabled in the actual call?** Yes — `SPEAKER_LABELING_ENABLED` is sent.
9. **Is text normalization done by SpeechKit, app, or both?** Provider-side (SpeechKit) via `text_normalization`. App-side only trims/joins. Optional Yandex AI *enhancement* is separate and manual.
10. **Hidden hardcoded defaults conflicting with env?**
    - `getProfileDefaultBitrateKbps("standard") = 24` (used only if env unset).
    - `getProfileDefaultSampleRate("standard") = 16000` (used only if env unset).
    - Scenario-side hardcodes: `video:false`, `lossless:true`, conference `hd_audio:true` — these are the *real* recorder settings and are **not** env-driven.

## Decision: no new env parameters this stage

Every required stage-1 behavior (observability, telemetry wiring, mapping trigger,
bug fixes) is achievable **without** new env parameters. The SpeechKit options are
already correctly wired; the audio-quality limiter is upstream in the Voximplant
scenario, which is a manually-pasted artifact outside app runtime env control.

New env parameters are therefore **not** introduced. The only recommended `.env`
hygiene change is removing the duplicate `AUDIO_TRANSCRIPTION_MAX_FILE_MB="20"` line.

## Runtime verification status

- **Static verification: complete** (all reads traced to source lines above).
- **Live ffprobe + live SpeechKit request capture: deferred** — requires a running
  server + a fresh Voximplant recording + DB access, which is not available in this
  environment. Phase 1 (`transcription-observability`) and Phase 7 (audio metadata
  hook) add the persisted, sanitized artifacts that make this verification
  deterministic on the next real recording. No secrets are logged.
