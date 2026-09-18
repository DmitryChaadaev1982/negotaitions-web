# Decision Matrix

## Raw audio verdict

- `PAUSE_INTERVAL_CONTAINS_SPEECH`
- A/B equality still holds for technical transform path (A vs B), but C excludes meaningful speech from removed interval `57.458s..68.284s`.
- No hard evidence of seam-specific speaker-label corruption; primary effect is speech coverage loss.

## Raw ASR verdict

- `CURRENT_SPEECHKIT_CONFIG_BEST`
- `general` and deferred variants are tied in this sample, but do not outperform current production baseline.

## Post-processing verdict

- `DEEPSEEK_JSON_SCHEMA_BEST`
- `SPEECHKIT_LLM_NOT_TRANSCRIPT_SAFE` in tested API path (no usable post-processing object observed).

## Final production recommendation set

- `CHANGE_PAUSE_REMOVAL_RULES`
- `TRANSCRIBE_ORIGINAL_INSTEAD_OF_ACTIVE_AUDIO`
- `KEEP_DEEPSEEK_JSON_SCHEMA`
- `CHANGE_SPEECHKIT_CONFIGURATION` is not required for model/params in this stage.

## Preferred target architecture

1. Keep current SpeechKit raw config.
2. For ASR input, use original source A (or processed-no-cut B) instead of pause-cut C until activity detection/cut policy is corrected.
3. Keep DeepSeek JSON Schema as final enhancement layer.
4. Add automatic enhancement orchestration after successful automatic transcription with idempotent guard and non-blocking execution.

