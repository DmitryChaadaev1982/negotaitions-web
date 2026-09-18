# Local Yandex AI Test Notes

This branch supports local provider switching for analysis and transcription.

## Required env for local Yandex test

```bash
AI_ANALYSIS_PROVIDER=yandex
TRANSCRIPTION_PROVIDER=yandex_speechkit
YANDEX_AI_MODEL=deepseek-v4-flash

YANDEX_FOLDER_ID=...
YANDEX_API_KEY=...
YANDEX_AI_BASE_URL=https://ai.api.cloud.yandex.net/v1
YANDEX_DATA_LOGGING_ENABLED=false

YANDEX_SPEECHKIT_MODEL=general:rc
YANDEX_SPEECHKIT_LANGUAGE=ru-RU
YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED=true
YANDEX_SPEECHKIT_LITERATURE_TEXT=true
YANDEX_SPEECHKIT_PROFANITY_FILTER=false
YANDEX_SPEECHKIT_PHONE_FORMATTING=false
YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING=true
YANDEX_SPEECHKIT_AUDIO_CONTAINER=MP3
YANDEX_SPEECHKIT_BASE_URL=https://stt.api.cloud.yandex.net
YANDEX_OPERATION_BASE_URL=https://operation.api.cloud.yandex.net

YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED=true
YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL=deepseek-v4-flash
YANDEX_TRANSCRIPT_ENHANCEMENT_MAX_OUTPUT_TOKENS=6000
```

If provider flags are absent, OpenAI remains the default path.

## VPN split tunneling

If Yandex calls timeout, add VPN exclusions for:

- `ai.api.cloud.yandex.net`
- `stt.api.cloud.yandex.net`
- `operation.api.cloud.yandex.net`
- `storage.yandexcloud.net`
- `*.storage.yandexcloud.net`

Timeouts are surfaced as:

`Yandex API network timeout. Check VPN split tunneling.`

## Smoke scripts

- Analysis smoke:
  - `npx tsx scripts/yandex-ai-smoke.ts --mode json --model deepseek-v4-flash`
- SpeechKit smoke:
  - `npx tsx scripts/yandex-speechkit-smoke.ts --file "C:\path\to\audio.mp3"`
- Transcription quality benchmark:
  - `npx tsx scripts/yandex-transcription-quality-benchmark.ts --file "C:\path\to\audio.mp3"`

## Runtime diagnostics

`/admin` diagnostics now show:

- selected AI analysis provider
- selected transcription provider
- required env presence booleans (no secret values)

## Safety notes

- OpenAI code paths remain intact and default.
- No production deployment files are required for this local experiment.
- No Prisma schema changes are required for this provider integration.
