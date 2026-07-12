# Stage 3.9T / 3.9T-2 - Real Transcription Quality Audit

Session: `cmrhs7ms80003mvm1tc8jv7ks`  
Branch: `audit/stage-3-9t-real-transcription-quality`  
Date: 2026-07-12  
Mode: audit-only, no production behavior change.

## Scope And Safety

- No production code path changed.
- No DB schema changes, migrations, or transcript overwrite in production.
- No env/runtime reconfiguration, service restart, nginx change, or Voximplant config change.
- Temporary tooling only under `tmp/stage-3-9t-audit`.

## What Was Already Proven Before 3.9T-2

- Canonical active-audio selection and SHA consistency for provider comparison.
- Parser/persistence/UI are not root cause for `"40"` substitution.
- AI enhancement failed in production due timeout.

## Stage 3.9T-2 Work Performed

1. Repaired audit extraction mismatch (temporary tooling only, no production parser change).
2. Re-ran mandatory Yandex variants Y1-Y6 using conclusive extraction.
3. Added explicit layer taxonomy and per-error attribution.
4. Measured enhancement latency behavior and chunking alternatives.
5. Collected official + community best-practice guidance and mapped to observed evidence.

## Canonical Audio And Integrity

- Active audio SHA-256: `257bb6885405b616e0c06c29943381f78c058e9017070f8343bc07a24a09af19`
- Source FLAC SHA-256: `8159e7aeb99a23587dfb84628a761984a52e6648e683c58fe95ae8c35842bbe6`
- Active run and OpenAI comparison remained on identical active-audio SHA.

## Conclusive Yandex Benchmark (Y1-Y6)

Source: `tmp/stage-3-9t-audit/yandex-conclusive-runs.json`

- Y1 production baseline: 228 words, 22 segments, includes `"40 такой"`.
- Y2 diarization OFF: 228 words, 5 segments, `"сорок"` (no digit), but severe speaker-turn collapse.
- Y3 normalization OFF: 228 words, 22 segments, `"сорок"` (no digit), readability degraded.
- Y4 punctuation/literature best (same as prod): effectively same as Y1.
- Y5 alternative model `general`: effectively same as Y1 on this sample.
- Y6 source audio instead of active: 251 words, 26 segments, includes `"40"`, with extra noisy/hallucinatory material near pause region.

## Error Taxonomy And Layer Attribution

See:

- `error-taxonomy.csv`
- `provider-layer-errors.csv`

Required examples classified:

- `"сорт такой" -> "40"`: Class A + B (ASR lexical confusion + normalization surface transform).
- `"берусь"` vs expected `"беру"`: Class B/A (morphology/lexical ambiguity, provider-level).
- `"Продаем. Берем беруши..."` merged dialogue: Class C (provider segmentation; strong in diarization-OFF run).
- `"артериальной гниле"` vs expected `"огурцы гнилые"`: Class D (acoustic/LM hallucination).

## Source vs Active Audio (Pause Boundary Focus)

Cut boundaries (real timeline): `57.458s`, `68.284s`.  
Active timeline join: `57.458s`.

Observed:

- Active (Y1) around join keeps coherent negotiation dialogue, no distinct ±500ms cut-drop signature.
- Source (Y6) around 57-68s includes extra noisy fragments (e.g., non-task lexical debris), suggesting pause-region contamination rather than improved fidelity.
- Source gives higher word count but not higher verified quality for critical errors.

Conclusion:

- No evidence that `source_audio_cut` caused the `"40"` pathology.
- Active audio remains safer default for this workflow.

## AI Enhancement Root Cause (Conclusive)

Code-level facts (`lib/services/yandex-transcript-enhancement.ts`):

- model: `deepseek-v4-flash` (env-backed default)
- request timeout: `120000 ms`
- polling interval: `1500 ms`
- polling timeout: `90000 ms`
- non-streaming request mode (`/responses`, blocking/polling)
- retry behavior: token-increase retries + strict-JSON retries

Measured latency (`ai-enhancement-latency.csv`):

- Full single-shot (22 segments, 1299 chars): timeout at ~120s (failed).
- 2 chunks sequential: chunk1 success (~77.6s), chunk2 timeout (~120s).
- 4 chunks parallel: all chunks succeed; full wall time ~105.4s.

Root cause:

- Single-request enhancement exceeds app timeout envelope for longer/harder chunks.
- Chunking (especially parallel) is evidence-backed mitigation.

## Documentation Research Outcome

See: `yandex-best-practices.md`

Officially supported and relevant:

- explicit language hinting (`ru-RU`)
- model selection (`general`, `general:rc`)
- normalization/literature toggles
- speaker labeling toggle

Not evidenced as currently integrated in this repository path:

- phrase-hint/custom-vocabulary biasing in existing app request path.

## Best Achievable Yandex Quality (Current Recording)

Best verified trade-off for production-safe Phase 1:

- Keep Y1-style parameters (`general:rc`, `ru-RU`, diarization on, normalization on, literature on, active audio).

Why:

- Preserves speaker structure and readability.
- Avoids severe segmentation collapse seen in Y2.
- Source audio (Y6) increases noisy/hallucinatory material.

Targeted lexical-fidelity experiment:

- Y3 (normalization OFF) removes digit rendering (`40` -> `сорок`) but degrades readability.

## Final Required Answers

- **Best verified Yandex config?** Y1 baseline config (`general:rc`, `ru-RU`, diarization ON, normalization ON, literature ON, active audio).
- **How much better is it?** Versus failed-extraction benchmark: now conclusive. Versus other Yandex variants: Y1 ties top for readability/structure; Y3 improves one lexical symptom but worsens readability; Y2 harms speaker segmentation.
- **Which mistakes remain impossible to fix by params alone?** Acoustic hallucinations like `"артериальной гниле"` persisted across Y1-Y6.
- **Which mistakes belong to audio quality?** Hallucination sensitivity and lexical instability under 8kHz mono source.
- **Which belong to provider?** Lexical confusion, segmentation behavior, normalization side-effects.
- **Which belong to parser?** None confirmed for target pathologies.
- **Which belong to AI?** Improvement failure due timeout architecture (not execution guarantee).
- **Should production change Yandex parameters now?** Not as default; keep Y1 as safe baseline. Run Y3-style normalization-off as controlled forensic mode only.
- **Should production use source audio?** No, not by default; active audio is cleaner in this case.
- **Should production change AI enhancement architecture?** Yes; chunked enhancement is evidence-based and low-risk relative to parser/provider rewrites.
- **Safest implementation Phase 1?**
  - keep current Yandex baseline parameters;
  - implement chunked enhancement with deterministic merge and failure fallback;
  - add benchmark harness + taxonomy metrics regression checks;
  - no parser deletion/rewrites in Phase 1.

## Top Five Confirmed Root Causes

1. 8kHz mono source acoustic ceiling.
2. Provider lexical confusion in specific phrase regions.
3. Normalization transforms lexical surface (`сорок` -> `40`).
4. Diarization-off path collapses speaker structure.
5. Single-shot enhancement timeout architecture.

## Top Five Recommended Implementation Changes

1. Chunked enhancement execution (parallel-safe merge by segment index).
2. Keep explicit `ru-RU` and `general:rc` baseline with diarization ON.
3. Add permanent conclusive benchmark harness using fixed-audio SHA.
4. Add phrase-level pathology regression set (`сорт/сорок/40`, `беру/берусь`, hallucination patterns).
5. Plan upstream audio-quality improvements as separate track.

## Validation

Commands run:

- `git status`
- `git diff --stat`
- `git diff --name-status`

Result:

- Only audit documentation/artifact files changed.
- No production behavior changes.
- No commit performed.
