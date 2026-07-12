# Stage 3.9E Structured Output Probe

Date: 2026-07-12  
Branch: `audit/stage-3-9e-structured-output-probe`  
Base: `audit/stage-3-9e-enhancement-parameter-benchmark`  
Session: `cmrhs7ms80003mvm1tc8jv7ks`  
Model: `deepseek-v4-flash`

## Scope

Bounded diagnostic probe to test provider-enforced JSON Schema structural reliability for transcript enhancement in two modes:

- Responses API with `text.format` (`type=json_schema`)
- Chat Completions API with `response_format` (`type=json_schema`)

Probe constraints respected:

- no production transcript mutation route call;
- no DB writes;
- no env changes;
- no service restart;
- no deployment;
- no source-code changes.

Raw payload artifacts remain only under:

- `/tmp/negotaitions-structured-output-probe/`

## Inputs and chunking

Input text source (read-only):

- `TranscriptSegment.qualityText ?? TranscriptSegment.text`

Chunk partition preserved from prior benchmark:

- chunk 0: indexes 0-5
- chunk 1: indexes 6-11
- chunk 2: indexes 12-16 (problematic prior)
- chunk 3: indexes 17-21 (prior control)

Private input file created:

- `/tmp/negotaitions-structured-output-probe/benchmark-input.json`

## Structured schema under test

One strict keyed-object schema was used per chunk (dynamic required keys, no extras):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["segments"],
  "properties": {
    "segments": {
      "type": "object",
      "additionalProperties": false,
      "required": ["12", "13", "14", "15", "16"],
      "properties": {
        "12": { "type": "string", "minLength": 1 },
        "13": { "type": "string", "minLength": 1 },
        "14": { "type": "string", "minLength": 1 },
        "15": { "type": "string", "minLength": 1 },
        "16": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

## Probe execution and limits

- total generation calls: 8/8
- retrieval calls: 0
- total elapsed: 13.2s
- per-call timeout: 75s (none hit)
- max output tokens per call: 2400
- long polling: not used

## Results

### A) Responses API + provider schema

- Chunk 2: `SCHEMA_VALID` (HTTP 200, status=`completed`, parse ok, exact keys, no extras, no empties)
- Chunk 3: `SCHEMA_VALID` (same integrity outcome)
- Schema accepted by provider on both probe calls.

### B) Chat Completions + provider schema

- Chunk 2: `SCHEMA_VALID` (HTTP 200, parse ok, exact keys, no extras, no empties)
- Chunk 3: `SCHEMA_VALID` (same integrity outcome)
- Schema accepted by provider on both probe calls.

### Full-batch phase

Selection rule chose Responses mode (equal structural result, slightly lower probe latency).

Full batch (chunks 0-3, concurrency 4) ran once:

- structurally valid: 4/4
- incomplete: 0
- schema rejection: 0
- failed: 0
- semantic regressions: 0
- full-batch wall time: 3132 ms

## Decision

Exact verdict: `RESPONSES_SCHEMA_READY`

Rationale:

- provider-enforced schema accepted and enforced;
- chunk 2 and chunk 3 both structurally valid;
- full-batch 4/4 structurally valid in one bounded run;
- no semantic regression detected in this probe sample.

## Can current model remain?

Yes, for the tested structured-output mode (`Responses API + text.format json_schema`) this probe provides positive bounded evidence.

## Fallback-model verification needed?

Not required for immediate implementation candidate based on this probe result.
Keep as contingency if reliability degrades in broader runtime traffic.

## Documentation references used

Official Yandex references consulted for structured output capability and API surface:

- [Yandex AI Studio structured output concept](https://aistudio.yandex.ru/docs/ai-studio/concepts/generation/structured-output)
- [Yandex AI Studio Responses API docs](https://aistudio.yandex.ru/docs/ai-studio/responses/)
- [Yandex AI Studio OpenAI-compatible chat docs](https://aistudio.yandex.ru/docs/ai-studio/concepts/api#openai)
- [Yandex AI Studio SDK repository](https://github.com/yandex-cloud/yandex-ai-studio-sdk)
- [Yandex Cloud FoundationModelsCall integration doc (jsonSchema/jsonObject semantics)](https://yandex.cloud/en/docs/serverless-integrations/concepts/workflows/yawl/integration/foundationmodelscall)

Note: direct automated retrieval of `aistudio.yandex.ru` pages may be rate-limited by anti-bot protection; probe request shapes were validated empirically against live provider behavior and cross-checked against official docs links above.

## Artifacts

See `docs/audits/stage-3-9e-structured-output-probe/`:

- `README.md`
- `official-api-capability.md`
- `schema.json`
- `probe-results.csv`
- `responses-api-results.json`
- `chat-completions-results.json`
- `full-batch-results.csv`
- `linguistic-review.csv`
- `decision.md`
- `implementation-recommendation.md`
- `implementation-prompt.md`
