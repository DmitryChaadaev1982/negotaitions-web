# Stage 3.9E Structured Output Probe Artifacts

Sanitized artifacts for probe run on session `cmrhs7ms80003mvm1tc8jv7ks`.

Primary report:

- `docs/audits/stage-3-9e-structured-output-probe.md`

Files:

- `official-api-capability.md` - documented API-field expectations and references.
- `schema.json` - representative dynamic keyed-object schema (chunk 2).
- `probe-results.csv` - all generation calls in probe order.
- `responses-api-results.json` - sanitized Responses API probe metrics.
- `chat-completions-results.json` - sanitized Chat Completions probe metrics.
- `full-batch-results.csv` - selected-mode full-batch metrics.
- `linguistic-review.csv` - per-call linguistic classification summary.
- `decision.md` - exact verdict and acceptance criteria mapping.
- `implementation-recommendation.md` - minimal implementation recommendation.
- `implementation-prompt.md` - implementation task prompt for next stage.

Raw provider payloads and private input stay only on server:

- `/tmp/negotaitions-structured-output-probe/`
