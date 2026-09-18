# Official SpeechKit Capability Notes (Sanitized)

## Sources

- [SpeechKit STT v3 async WAV flow (Yandex Cloud)](https://yandex.cloud/ru-kz/docs/speechkit/stt/api/transcribation-api-v3)
- [SpeechKit STT v3 RecognizeFile API ref (Yandex Cloud)](https://yandex.cloud/ru-kz/docs/speechkit/stt-v3/api-ref/AsyncRecognizer/recognizeFile)
- [SpeechKit models page (Yandex Cloud)](https://yandex.cloud/ru-kz/docs/speechkit/stt/models)

Note: direct web fetch for some Yandex docs was captcha-gated during this audit; model/field details below are cross-checked from official snippets and live API behavior.

## STT v3 API and models

- API path in use: `POST /stt/v3/recognizeFileAsync` + `GET /stt/v3/getRecognition`.
- Documented async model tags include:
  - `general`
  - `general:rc`
  - `general:deprecated`
  - `deferred-general`
  - `deferred-general:rc`
  - `deferred-general:deprecated`
- Project-validated (live): `general`, `general:rc`, `deferred-general`, `deferred-general:rc`.

## Recognition settings used/tested

- `language_restriction` with fixed `ru-RU`.
- `speaker_labeling` enabled/disabled.
- `text_normalization` enabled/disabled.
- `literature_text` enabled/disabled.
- `phone_formatting_mode` disabled in baseline.

## Built-in summarization / LLM field

- API reference snippets indicate optional `summarization` fields (including `model_uri` and property instructions with JSON options).
- In this project audit, adding `summarization` to request did not produce observable summarization output in `getRecognition` payload (only standard STT NDJSON stream observed).
- No transcript-safe deterministic segment-preserving post-processing format was observed from this path.

## Practical implication

- Raw ASR capability is confirmed and stable.
- Transcript post-processing should remain on the existing DeepSeek JSON Schema pipeline until SpeechKit LLM output contract is validated end-to-end for this project.

