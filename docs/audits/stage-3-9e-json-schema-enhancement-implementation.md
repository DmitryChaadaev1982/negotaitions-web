# Stage 3.9E JSON Schema Enhancement Implementation

Date: 2026-07-12  
Branch: `feat/stage-3-9e-json-schema-enhancement`  
Base: `audit/stage-3-9e-structured-output-probe`

## Scope

Implemented production-safe transcript enhancement support for provider-enforced structured output using Yandex Responses API `text.format` with `type=json_schema`.

Preserved:

- chunking, concurrency, bounded retries;
- deterministic merge and no-loss fallback;
- status semantics (`COMPLETED`/`PARTIAL`/`FAILED`/`SKIPPED`);
- `qualityText ?? text` re-enhancement source;
- persistence safety (no `qualityText` overwrite by AI);
- speaker/timestamp/mapping integrity.

Out of scope and unchanged:

- SpeechKit ASR/audio/ffmpeg/Voximplant paths;
- DB schema/migrations;
- provider model identifier (`deepseek-v4-flash`);
- live provider tests.

## Why this change

Legacy prompt-generated JSON was structurally unreliable under bounded production settings (see parameter benchmark).

Structured output probe established `RESPONSES_SCHEMA_READY` with bounded evidence:

- Responses API accepted strict schema shape;
- 8/8 probe calls structurally valid;
- full batch 4/4 structurally valid;
- no semantic regression in sample;
- no polling required.

## Selected request mode

Selected production mode from probe evidence:

- endpoint: `POST /v1/responses`;
- model: `deepseek-v4-flash` (`gpt://<folder>/<model>`);
- structured output field: `text.format`;
- format payload: `{ type: "json_schema", name, strict: true, schema }`.

No Chat Completions mode added for production path in this phase.

## Rollout flag

Added:

- `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE`
  - allowed: `legacy | json_schema`
  - default: `legacy`

Purpose:

- deploy code before activation;
- rollback by env switch without code revert.

## Dynamic keyed schema

Per chunk, runtime builds strict schema with exact target keys:

- root: object, required `segments`, `additionalProperties=false`;
- `segments`: object, required exact chunk indexes (as strings), `additionalProperties=false`;
- each value: `{ "type": "string", "minLength": 1 }`.

No schema fields for speaker/timestamps/order/confidence are exposed to the model.

## Prompt and extraction changes

In `json_schema` mode:

- prompt is simplified to linguistic correction intent only;
- model is not instructed to manually build array/index wrappers;
- output is extracted through existing Responses output extraction path;
- JSON is parsed without repair;
- malformed JSON is rejected.

## Validation and deterministic merge

`json_schema` mode validation requires exact key equality:

- missing keys -> reject;
- extra keys -> reject;
- non-string values -> reject;
- empty/whitespace-only strings -> reject;
- catastrophic shrink guard remains active.

Only `TranscriptSegment.text` may change on accepted segments.  
Merge remains keyed by canonical source index; speaker/timestamps/mapping/order are preserved.

## Retry, fallback, and status behavior

In `json_schema` mode:

- first attempt: schema mode;
- retry: schema mode;
- no schema->legacy fallback inside chunk;
- no long polling loop;
- terminal incomplete/max-output treated as failed attempt.

On exhausted attempts, chunk keeps original text; global no-loss fallback semantics unchanged.

## Telemetry additions

Run-level additions:

- `outputMode`
- `structuredOutputEnabled`
- `schemaVersion`
- `schemaChunkCount`

Chunk-level additions:

- `outputMode`
- `schemaName`
- `schemaVersion`
- `expectedSchemaKeyCount`
- `returnedSchemaKeyCount`
- `schemaAccepted` (when available)
- `schemaValidationPassed`
- `missingKeyCount`
- `extraKeyCount`
- `emptyValueCount`

Attempt-level additions:

- `outputMode`
- `providerStatus`
- `incompleteReason`
- `rawOutputCharCount`
- `parsedSegmentCount`
- `schemaValidationPassed`
- `failureStage` (`provider | extraction | parsing | schema_validation | integrity_validation`)

No raw provider payloads, secrets, headers, or full prompts are persisted.

## Rollout / rollback procedure

See:

- `docs/voximplant/yandex-deployment-runbook.md` (section "Stage 3.9E JSON Schema rollout").

Local activation target:

- `C:\Projects\Negotiations AI\negotiations-web\.env`
- set `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"`

Server activation target:

- `/var/www/negotaitions/app/.env.production`
- set `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"`

Rollback:

- set `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="legacy"` and restart service.

## Validation

Targeted tests:

- `node --import tsx --test lib/env.transcript-enhancement.test.ts`
- `node --import tsx --test lib/services/yandex-transcript-enhancement.test.ts`
- `node --import tsx --test lib/services/transcript-enhancement-persistence.test.ts`

Mandatory gates for implementation changes:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

## Residual risks

- Provider may still return malformed/empty structured output in broader traffic; bounded retries + no-loss fallback remain required.
- `schemaAccepted` signal availability can vary by provider envelope shape; local integrity validation remains the decisive guard.
- Linguistic quality remains model-dependent even when structure is guaranteed.
