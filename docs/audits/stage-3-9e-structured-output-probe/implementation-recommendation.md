# Implementation Recommendation

Recommendation: proceed with minimal production implementation on:

- endpoint: Responses API
- structured field: `text.format` with `type=json_schema`
- model: keep `deepseek-v4-flash` for now

## Minimal implementation shape

1. Dynamic schema per chunk:
   - top-level object with `segments`;
   - `segments` object with required keys exactly matching chunk indexes;
   - `additionalProperties=false` at both levels;
   - `minLength=1` for each segment value.

2. Deterministic keyed merge:
   - map output by segment index key;
   - preserve canonical ordering/metadata from application state;
   - reject extra/missing keys and empty values.

3. Preserve no-loss fallback:
   - keep current fallback to original text when chunk validation fails;
   - keep existing catastrophic shrink guard and segment-count/order guarantees.

4. Telemetry additions:
   - structured mode flag (`responses_json_schema`);
   - schema accepted/rejected;
   - validation failure class;
   - per-chunk tokens, latency, status.

5. Tests:
   - unit tests for dynamic schema generation and key-exact validation;
   - parsing tests for strict schema success/failure paths;
   - route-level tests asserting fallback and no-loss behavior unchanged.

## Env implications (not applied in probe)

- No mandatory new env vars.
- Keep current model env as-is.
- Endpoint selection should be explicit in code path (Responses mode).
- Existing token cap env can remain; structured mode used 2400 safely in probe.

## Rollout and rollback

- Rollout: guarded by feature flag / mode switch, canary on limited sessions.
- Rollback: disable structured mode and return to current chunked enhancement path.
