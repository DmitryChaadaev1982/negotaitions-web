# Implementation Prompt - Responses JSON Schema Mode

Implement Stage 3.9E structured enhancement mode using Responses API provider-enforced schema.

Constraints:

- preserve existing no-loss behavior;
- no transcript/order/metadata mutation beyond current enhancement path;
- no long polling loops;
- no schema weakening.

## Required changes

1. Add structured-output request mode in transcript enhancement service:
   - endpoint: `POST /v1/responses`
   - field: `text.format`
   - value:
     - `type: "json_schema"`
     - `name: <dynamic chunk schema name>`
     - `strict: true`
     - `schema: <dynamic keyed schema>`

2. Dynamic keyed schema per chunk:
   - target indexes list from chunk targets;
   - schema requires exact keys as strings;
   - each value non-empty string;
   - `additionalProperties=false` for root and `segments`.

3. Parse + validate:
   - parse output JSON without repair;
   - verify exact required keys;
   - reject extra keys;
   - reject empty values;
   - enforce existing catastrophic shrink protection.

4. Merge behavior:
   - deterministic by original segment index/order;
   - preserve speaker/timestamps/mapping metadata;
   - on any invalid chunk output, fallback to original text for that chunk.

5. Telemetry:
   - mode identifier (`responses_json_schema`);
   - schemaAccepted, schemaRejected;
   - classification (`SCHEMA_VALID`, `KEY_MISMATCH`, etc.);
   - per-chunk latency and token usage.

6. Tests:
   - dynamic schema generation tests;
   - strict keyed validation tests (missing/extra/empty keys);
   - integration tests confirming fallback and no-loss guarantees.

## Delivery

- minimal diff;
- no env migration required unless explicitly justified;
- include rollout/rollback note in docs.
