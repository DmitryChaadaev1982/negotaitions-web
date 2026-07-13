# Stage 3.9F - SpeechKit Model / Params / Pause-Cut / LLM Benchmark

Date: 2026-07-13  
Branch: `audit/stage-3-9f-speechkit-model-llm-benchmark`  
Base: `deploy/yandex-poc`  
Primary session: `cmrhs7ms80003mvm1tc8jv7ks`

## Scope and safety

- Read-only production audit only: no code deployment, no service restart, no env mutation, no DB writes, no transcript persistence routes invoked.
- Benchmark workspace: `/tmp/negotaitions-stage-3-9f-speechkit-benchmark` with locked permissions.
- Private artifacts (raw transcripts/audio/provider payloads) stayed only in that temporary root.
- Repository changes are documentation-only under `docs/audits/stage-3-9f-speechkit-model-llm-benchmark*`.

## Immutable inputs captured

- Recording ID: `cmrhsdmei004nmvm1m0e8dme6`
- Transcript ID: `cmrhsg3fd0071mvm17z8j9oum`
- Transcript provider state:
  - model: `speechkit:general:rc`
  - mode: `recognizeFileAsync:diarize`
  - segments: `22`
  - speakers: `2`
- Pause-processing metadata:
  - mode: `source_audio_cut`
  - source duration: `114841 ms`
  - active duration: `104015 ms`
  - removed pause: `10826 ms`
  - active intervals: `2`
  - seam boundary at original timeline: `57458 ms` / `68284 ms`
- Baseline enhancement state:
  - enhancement model: `deepseek-v4-flash`
  - output mode: `json_schema`
  - status: `COMPLETED`

## Official SpeechKit capability findings

Source evidence:

- [SpeechKit STT v3 async WAV flow](https://yandex.cloud/ru-kz/docs/speechkit/stt/api/transcribation-api-v3)
- [SpeechKit STT v3 RecognizeFile API reference (search-snippet evidence)](https://yandex.cloud/ru-kz/docs/speechkit/stt-v3/api-ref/AsyncRecognizer/recognizeFile)
- [SpeechKit models page (search-snippet evidence)](https://yandex.cloud/ru-kz/docs/speechkit/stt/models)

Validated for this project (live calls + docs):

- `recognizeFileAsync` and `getRecognition` are active and stable.
- Model tags accepted by project:
  - `general:rc` (production baseline)
  - `general`
  - `deferred-general`
  - `deferred-general:rc`
- Params accepted and effective:
  - language restriction (`ru-RU`)
  - speaker labeling on/off
  - text normalization on/off
  - literature text on/off
- SpeechKit request accepted a `summarization` object, but in tested runs the response payload remained regular ASR stream output (no summarization object, no structured LLM artifact). For this project and request shape, built-in LLM output was not observed.

## Audio variants (A/B/C)

- A (original): FLAC, 8 kHz mono, duration `114.696s`, SHA `8159e7...bbe6`
- B (processed no-cut control): WAV PCM s16le, 8 kHz mono, duration `114.696s`, SHA `763e54...7c1c`
- C (active-audio): WAV PCM s16le, 8 kHz mono, duration `103.870s`, SHA `7b4b83...f09d`

Key comparison:

- A -> B isolates decode/resample/container path only.
- B -> C isolates pause cutting/stitching.
- A/B had identical baseline ASR output hash in this audit.
- C changed transcript length/segment count from pause interval removal and was further adjudicated by interval-focused inspection.

### Removed interval adjudication (`57.458s..68.284s`)

- Private clips were generated under `/tmp/negotaitions-stage-3-9f-speechkit-benchmark/manual-review/`:
  - `removed-interval-A.wav`
  - `removed-interval-context-A.wav`
  - `removed-interval-context-B.wav`
  - `seam-context-C.wav`
- Removed-interval acoustic metrics (`removed-interval-A.wav`):
  - duration `10.826s`
  - silence total `2.452s`
  - non-silent total `8.374s`
  - speech-like activity detected: `true`
- Segment coverage around the interval (sanitized):
  - A: `6` neighboring/overlapping segments, `74` words, lexical content exists, speaker labels exist
  - B: `6` neighboring/overlapping segments, `74` words, lexical content exists, speaker labels exist
  - C (mapped to original timeline): `2` neighboring segments, `53` words, lexical content exists, speaker labels exist
- Final interval finding: removed interval contains meaningful speech content (not pure silence).

## Baseline A/B/C (current production config)

- Baseline config: `general:rc`, `ru-RU`, diarization on, normalization on, literature on.
- Calls:
  - A: `26` normalized segments, `251` words, text hash `a2dc51...962d`
  - B: `26` normalized segments, `251` words, text hash `a2dc51...962d`
  - C: `22` normalized segments, `229` words, text hash `b67fcd...2566`

Interpretation:

- A vs B: no measurable lexical/structural change in this run (technical transformation alone did not degrade output).
- B vs C: reduction in words/segments is consistent with removed interval that contains speech.
- A vs C: total pipeline effect includes content loss due to interval removal.

### Deterministic A vs C token accounting (mapped timeline)

- Total raw token delta: `251 - 229 = 22` words.
- Classified delta:
  1. inside removed interval: `21`
  2. outside interval contextual ASR change: `1`
  3. punctuation/normalization-only: `0`
  4. unresolved accounting remainder: `0`
- Outside-interval lexical change is detected, but no speaker-label corruption was detected near seam in token-level mapped comparison.

## Model and parameter benchmark (raw ASR)

Recognition calls executed: `14 / 20` budget.

Findings:

- `general:rc`, `general`, `deferred-general`, `deferred-general:rc` produced identical transcript hash on A (`a2dc51...962d`) and same segment/word counts.
- `speaker_labeling=false` reduced segment granularity to `6` and collapsed to single speaker (not acceptable for production diarization workflow).
- `text_normalization=false` and `literature_text=false` changed surface text (hash `dce5d6...ab9f`) and removed numeric token `40`, but did not produce validated correction to known anchor (`сорт`) and did not improve structural metrics.
- Fixed `ru-RU` already equals baseline.

## Known anchor results

Anchor family tracked in automated metrics:

- Numeric substitution presence (`40`) remained in all diarization-enabled raw runs with baseline normalization/literature.
- Turning normalization/literature off removed the literal `40`, but did not confirm correct lexical replacement.
- No tested raw SpeechKit model/parameter variant produced a deterministic known-anchor lexical correction beyond this surface effect.

## Stability

- Repeated baseline A run (`R12`) matched baseline hash exactly.
- Repeated `general` A run (`R13`) matched baseline hash exactly.
- In-scope recognition path appears stable for this sample and configuration.

## SpeechKit built-in LLM probe verdict

LLM-probe calls executed: `2`.

Result:

- `summarization` request was accepted at submit/operation level.
- `getRecognition` response returned standard NDJSON ASR entries only (large text stream, no parsed summary object, no observed `summarization*` fields, no deterministic structured post-processing result).
- Verdict: `SPEECHKIT_LLM_NOT_TRANSCRIPT_SAFE` for this production pipeline and tested API shape.

## DeepSeek JSON Schema comparison

Offline production-equivalent enhancement run (no DB writes):

- model: `deepseek-v4-flash`
- mode: chunked, `json_schema`, 4 chunks, concurrency 4
- status: `COMPLETED`
- elapsed: `~5.6s`
- changed segments: `16/22`
- anchor behavior: raw contained `40`; enhanced output removed `40`

Verdict:

- DeepSeek JSON Schema remains the only validated transcript-safe post-processing layer in current production stack.

## Decision matrix

- AUDIO verdict: `PAUSE_INTERVAL_CONTAINS_SPEECH`.
- RAW ASR verdict: `CURRENT_SPEECHKIT_CONFIG_BEST` (also tied with `general` and deferred variants; no meaningful lexical/structural gain).
- Post-processing verdict: `DEEPSEEK_JSON_SCHEMA_BEST`
- Final recommendation set:
  - `TRANSCRIBE_ORIGINAL_INSTEAD_OF_ACTIVE_AUDIO`
  - `CHANGE_PAUSE_REMOVAL_RULES`
  - `KEEP_DEEPSEEK_JSON_SCHEMA`
  - `KEEP_CURRENT_PIPELINE` for model/params/enhancement layering only

Preferred target architecture:

1. Keep current SpeechKit raw config (`general:rc`, diarization on, ru-RU fixed, normalization on, literature on).
2. For ASR input, use original full recording (A) or processed-no-cut control-equivalent (B), not pause-cut C.
3. Keep DeepSeek JSON Schema as final enhancement layer.
4. Implement automatic post-transcription enhancement orchestration with idempotent guards (design only in this stage).

## Latency and cost envelope (measured)

- Raw recognition latency:
  - baseline runs: ~6.5-6.7s each
  - deferred-general probe worst case: ~10.6s once
- Enhancement latency:
  - DeepSeek offline run: ~5.6s for 22 segments
- Audit call counts:
  - SpeechKit recognition/model/param calls: `14`
  - SpeechKit built-in LLM probe calls: `2`
  - DeepSeek comparison calls: `1` logical run (4 chunk calls internally)

Cost implication summary:

- No evidence of quality gain from moving to alternate SpeechKit model tags in this sample.
- Disabling diarization or changing normalization for anchor handling creates trade-offs without demonstrated net quality gain.
- SpeechKit built-in LLM path did not deliver usable post-processing output in tested flow.
- Current DeepSeek step adds modest bounded latency with validated structure.

## Required implementation design (not implemented here)

Design output is in:

- `docs/audits/stage-3-9f-speechkit-model-llm-benchmark/automatic-enhancement-backlog.md`
- `docs/audits/stage-3-9f-speechkit-model-llm-benchmark/implementation-recommendation.md`
- `docs/audits/stage-3-9f-speechkit-model-llm-benchmark/implementation-prompt.md`

## Production/local env implications

- No env changes were applied during this audit.
- Recommended future env additions/updates are documented only (duplicate-safe + rollback) in:
  - `docs/audits/stage-3-9f-speechkit-model-llm-benchmark/recommended-parameters.env.example`

## Raw private artifact root

- `/tmp/negotaitions-stage-3-9f-speechkit-benchmark/`

