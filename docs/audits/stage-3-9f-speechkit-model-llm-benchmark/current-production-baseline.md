# Current Production Baseline (Session Under Audit)

- Session: `cmrhs7ms80003mvm1tc8jv7ks`
- Recording: `cmrhsdmei004nmvm1m0e8dme6`
- Transcript: `cmrhsg3fd0071mvm17z8j9oum`
- Transcript status: `COMPLETED`

## Raw transcription baseline

- Provider: Yandex SpeechKit
- Request mode: `recognizeFileAsync:diarize`
- Model: `general:rc`
- Language: `ru-RU`
- Text normalization: enabled
- Literature text: enabled
- Speaker labeling: enabled
- Source codec/sample rate/channels: `pcm_s16le`, `8000`, mono
- Normalized segments in production transcript: `22`
- Speaker labels: `2`

## Pause processing baseline

- Mode: `source_audio_cut` (default path)
- Source duration: `114841 ms`
- Active duration: `104015 ms`
- Removed pause duration: `10826 ms`
- Active timeline intervals: `2`
- Artifact path present: yes (`sourceAudioArtifactPath` in transcript metadata)

## Enhancement baseline

- Enhancement mode: `chunked`
- Output mode: `json_schema`
- Model: `deepseek-v4-flash`
- Current transcript enhancement status: `COMPLETED`
- Prior canary characteristics (provided context) remain aligned with this run:
  - 4 chunks
  - zero retries/fallback chunks
  - schema-valid structured output

