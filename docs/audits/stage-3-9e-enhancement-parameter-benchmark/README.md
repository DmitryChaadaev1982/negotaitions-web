# Stage 3.9E Enhancement Parameter Benchmark

Sanitized benchmark artifacts for production diagnostic run on session `cmrhs7ms80003mvm1tc8jv7ks`.

Scope:
- bounded provider benchmark (27 generation calls, 1 retrieval call);
- no DB writes, no transcript mutation route calls, no service restart;
- raw provider payloads are kept only under `/tmp/negotaitions-enhancement-parameter-benchmark/raw/` on server.

Artifacts:
- `baseline-observations.json`
- `response-lifecycle.csv`
- `token-budget-results.csv`
- `format-results.csv`
- `chunk-size-results.csv`
- `concurrency-results.csv`
- `model-probe-results.csv`
- `run-summary.csv`
- `recommended-parameters.env.example`
- `implementation-recommendation.md`
- `implementation-prompt.md`
