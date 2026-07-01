# Voximplant + Yandex Env Checklist

Use this checklist before local smoke, staging, and production deploys.  
Do not put real secrets into docs.

## Core app and auth

- `DATABASE_URL`
- `NEXTAUTH_URL` (or equivalent app base URL used by auth)
- `NEXTAUTH_SECRET` / `AUTH_SECRET` (project-specific)
- `VIDEO_PROVIDER=voximplant`

## Voximplant runtime

- `VOXIMPLANT_ACCOUNT_NAME`
- `VOXIMPLANT_APPLICATION_NAME`
- `VOXIMPLANT_USER_DOMAIN`
- `VOXIMPLANT_SCENARIO_NAME`
- `VOXIMPLANT_RULE_NAME`
- `VOXIMPLANT_API_KEY_PATH` (or equivalent API key mechanism)

## Voximplant recording and webhook

- `VOXIMPLANT_RECORDING_ENABLED=true`
- `VOXIMPLANT_RECORDING_VIDEO=false`
- `VOXIMPLANT_RECORDING_AUDIO_ONLY=true` (recommended)
- `VOXIMPLANT_RECORDING_AUDIO_MODE=lossless` (recommended baseline)
- `VOXIMPLANT_RECORDING_PAUSE_ENABLED=false` (current Stage 3 POC)
- `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` (required)
- `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL` (public HTTPS base URL)
- `VOXIMPLANT_RECORDING_STORAGE` (if used by scenario/runtime)

## Storage (S3-compatible / Yandex Object Storage)

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

## Yandex SpeechKit

- `TRANSCRIPTION_PROVIDER=yandex_speechkit`
- `YANDEX_FOLDER_ID`
- `YANDEX_API_KEY`
- `YANDEX_SPEECHKIT_MODEL` (example: `general:rc`)
- `YANDEX_SPEECHKIT_LANGUAGE` (example: `ru-RU`)
- `YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING=true`
- `YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED=true`
- `YANDEX_SPEECHKIT_LITERATURE_TEXT=true`
- `YANDEX_SPEECHKIT_PROFANITY_FILTER=false`
- `YANDEX_SPEECHKIT_PHONE_FORMATTING=false`
- `YANDEX_SPEECHKIT_AUDIO_CONTAINER` (optional override: `MP3|WAV|OGG_OPUS`)

## Yandex AI / DeepSeek enhancement

- `AI_ANALYSIS_PROVIDER=yandex` (if Yandex analysis is enabled)
- `YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED=true|false`
- `YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL` (example: `deepseek-v4-flash`)
- `YANDEX_TRANSCRIPT_ENHANCEMENT_MAX_OUTPUT_TOKENS` (example: `6000`)
- DeepSeek credentials/endpoint vars as required by local Yandex integration code.

## Audio quality controls

- `AUDIO_RECORDING_TARGET_BITRATE_KBPS`
- `AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS`
- `AUDIO_TRANSCRIPTION_SAMPLE_RATE`
- `AUDIO_TRANSCRIPTION_CHANNELS`
- `AUDIO_TRANSCRIPTION_MAX_FILE_MB`

Current Stage 3 POC baseline:

```env
AUDIO_RECORDING_TARGET_BITRATE_KBPS=128
AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS=96
AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000
AUDIO_TRANSCRIPTION_CHANNELS=1
AUDIO_TRANSCRIPTION_MAX_FILE_MB=24
```

Rule:

- `AUDIO_TRANSCRIPTION_MAX_FILE_MB` is a compression threshold.
- If source file is below threshold and format is compatible, original file is reused without recompression.
- Compression/transcoding is still used when file is above threshold or source format is incompatible.

## Debug and safety flags

- `RECORDING_DEBUG_PANEL=false` in production (unless temporary incident diagnostics).
- `NEXT_PUBLIC_RECORDING_DEBUG_PANEL=false` in production.
- `AUTO_TRANSCRIBE_AFTER_RECORDING=false` unless intentional and cost-reviewed.
- Ensure no personal local paths or tunnel URLs are hard-coded in source.

## Playwright local stability

- Required for DB-backed e2e:

```powershell
$env:DATABASE_URL="postgresql://negotiations:negotiations_password@localhost:5432/negotiations_vox_test"
```

- If default test port is occupied:

```powershell
$env:PLAYWRIGHT_PORT="3000"
```

