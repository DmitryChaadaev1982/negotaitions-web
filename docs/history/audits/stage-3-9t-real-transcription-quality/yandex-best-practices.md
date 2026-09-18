# Yandex STT Best Practices (Stage 3.9T-2)

## Scope

This note summarizes current guidance relevant to this audit:

- Russian conversational speech
- telephony-like low-bandwidth audio (8 kHz mono source)
- diarization trade-offs
- normalization and punctuation settings

## Official Guidance (Yandex Cloud docs and release notes)

Sources used:

- [SpeechKit v3 recognizeFile API reference](https://yandex.cloud/ru-kz/docs/speechkit/stt-v3/api-ref/grpc/AsyncRecognizer/recognizeFile)
- [Normalization options](https://yandex.cloud/ru-kz/docs/speechkit/stt/normalization)
- [SpeechKit release notes (GitHub mirror path)](https://github.com/yandex-cloud/docs/blob/master/en/speechkit/release-notes-stt.md)

### What is clearly supported

- `model`: choose among supported model versions (e.g. `general`, `general:rc`).
- `language_restriction`: explicit language hinting is supported and is documented as a quality hint (especially relevant for Russian).
- `text_normalization` toggle:
  - enables number formatting, punctuation/capitalization pipeline
  - `literature_text` specifically controls punctuation/casing style behavior
- `speaker_labeling` toggle (diarization on/off).

### What matters for this project

- Explicit Russian language hint (`ru-RU`) is evidence-based and should be kept.
- `general:rc`/`general` are both valid; release notes indicate parity migrations over time.
- Normalization can materially alter lexical surface form (not just punctuation).
- Diarization affects segmentation structure strongly in multi-speaker calls.

### Not confirmed as usable in current integration

- Phrase hints / custom vocabulary biasing are not currently implemented in this repository path.
- No official repository-level evidence was found in this stage that the current app request path applies domain phrase hints to v3 async recognition.

## Community Experience (non-authoritative, directional)

Sources sampled:

- [Habr: SpeechKit vs others in noisy conditions](https://habr.com/ru/companies/simbirsoft/articles/833882/)
- [Habr: multi-API ensemble behavior](https://habr.com/ru/articles/974978/)

Observed recurring themes:

- SpeechKit errors on noisy/telephone audio are often lexical substitutions and punctuation weakness.
- Different providers fail differently; ensemble or adjudication may reduce specific named-error types.
- WER alone can hide semantically critical substitutions; error taxonomy is needed.

Use these as hypotheses only; official docs and local measured evidence remain primary.

## Audit-Backed Guidance For This Session

- Keep explicit `ru-RU`.
- Keep diarization enabled for speaker-structured output.
- Treat normalization as a trade-off:
  - ON improves readability.
  - OFF can reduce harmful numeric rendering (`40` symptom became `сорок` in this audit).
- For this session quality goal, parameter tuning alone does not remove major acoustic hallucinations.
