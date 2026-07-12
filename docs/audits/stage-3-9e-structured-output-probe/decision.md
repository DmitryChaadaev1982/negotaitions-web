# Decision Matrix Result

Verdict: `RESPONSES_SCHEMA_READY`

## Matrix mapping

- A. `RESPONSES_SCHEMA_READY` - **selected**
- B. `CHAT_COMPLETIONS_SCHEMA_READY` - not selected (also valid in probe, but slower in probe pair sum)
- C. `SCHEMA_PARTIAL` - not selected
- D. `MODEL_SCHEMA_INCOMPATIBLE` - not selected
- E. `MODEL_UNRELIABLE_WITH_SCHEMA` - not selected
- F. `INSUFFICIENT_EVIDENCE` - not selected

## Why A

- Responses API schema accepted on both probe chunks (2 and 3).
- Outputs were non-empty, parsed without repair, and matched exact required keys.
- No extra keys, no empty segment values, no severe shrink.
- Full-batch run reached 4/4 structurally valid chunks.

## Selection ranking check

1. Structurally valid: Responses and Chat both passed.
2. No semantic regression: both passed.
3. Lower latency: Responses marginally faster in probe pair.
4. Lower output tokens: comparable; Responses selected by latency tie-break.
