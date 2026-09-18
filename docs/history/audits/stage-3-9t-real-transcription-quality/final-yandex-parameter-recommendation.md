# Final Yandex Parameter Recommendation (Stage 3.9T-2)

## Best Verified Configuration (for current production objective)

Recommended **Phase 1 safe baseline**:

- model: `general:rc`
- language: `ru-RU` (explicit hint)
- speaker labeling: `ENABLED`
- text normalization: `ENABLED`
- literature text: `ENABLED`
- audio basis: `active-audio` (source_audio_cut output), not raw source recording

Rationale:

- This is the most stable speaker-structured output in tested runs.
- It preserves current readability behavior and avoids major segmentation collapse.
- Switching to source recording increased noisy/hallucinatory content near pause region.

## Lexical-Fidelity Alternative (targeted experiment, not default)

Alternative variant:

- same as above, but `text_normalization=DISABLED`

Observed effect in this session:

- `"40"` symptom changed to `"сорок"` (better lexical fidelity),
- but punctuation/casing quality degraded significantly.

Decision:

- Keep as controlled experiment path, not immediate default.

## Why Y2 Is Not Recommended As Default

Y2 (`diarization OFF`) removed one numeric symptom in this session, but:

- collapsed dialogue into 5 long single-speaker blocks,
- degraded speaker segmentation quality materially.

For negotiation analysis with speaker mapping, this is a high-cost trade-off.

## Source vs Active Audio Recommendation

- Prefer `active-audio` for current production path.
- In this audit, source run produced more words but also more noisy/hallucinatory fragments around pause-window zone.
- No evidence that active-audio caused the core `"сорт/сорок/40"` lexical confusion.

## AI Enhancement Architecture Recommendation

Current architecture issue:

- single-shot enhancement timed out at ~120s.

Verified improvement path:

- chunking to 4 parallel parts succeeded with full transcript wall time ~105s.

Phase 1 safe change (architecture, not provider model change):

- chunk enhancement requests (4-way),
- keep deterministic merge by segment index,
- preserve original text on chunk failure (partial fallback),
- keep timeout and retry telemetry per chunk.

## Expected Gain By Change Type

1. Keep current Yandex baseline parameters + chunked enhancement:
   - gain: readability stability, fewer enhancement failures
   - risk: low
2. Evaluate normalization OFF branch for forensic transcript mode:
   - gain: reduced digit substitution artifacts
   - risk: readability drop
3. Audio acquisition quality upgrades (upstream):
   - gain: highest potential lexical accuracy improvement
   - risk: medium/high implementation dependency

## Conclusive Answer

With current 8 kHz mono recording quality, Yandex parameter tuning improves some symptoms but does not eliminate core acoustic hallucination class errors.  
The strongest low-risk improvement is enhancement architecture reliability; the strongest high-impact long-term improvement is upstream audio quality.
