# Future Readability Implementation Constraints

1. Current granularity: `HYBRID_GLOBAL_AND_SEGMENT_MAPPING` (global label map + segment persistence).
2. Existing mapping states: `NOT_REQUIRED`, `REQUIRED`, `NEEDS_REVIEW`, `PARTIALLY_MAPPED`, `AUTO_SUGGESTED`, `CONFIRMED` (and schema-comment `FAILED`).
3. Non-existing active states in current flow: no persisted `AUTO_APPLIED` separate from `AUTO_SUGGESTED`; no dedicated per-segment ambiguity status.
4. Current auto-apply: full-gate only, transactionally persists transcript map + segment assignments, never partial auto persistence.
5. Manual propagation: label-level save propagates to all matching segments unless locked; confirm requires full label coverage.
6. Messages to preserve:
   - mapping required/confirm-before-AI behavior copy;
   - mapping failure reason key routing;
   - auto-applied note semantics.
7. Messages safe to clarify UI-only:
   - generic compact failure/future-only copy when specific reason exists.
8. Per-segment markers:
   - technically renderable from segment fields, but ambiguity markers are not currently produced by algorithm diagnostics.
9. Partial mapping existence:
   - manual partial mapping exists (`PARTIALLY_MAPPED`);
   - automatic partial persistence of active map does not.
10. Ambiguous-segment count reliability:
    - not reliable without new segment-level ambiguity definition in API/algorithm.
11. API change requirement:
    - for robust per-segment ambiguity/count: yes (and likely algorithm output change).
12. UI components safe to change:
    - presenter text/copy/layout in `recording-transcription-section` and mapping cards.
13. Components/algorithms not to touch for this future task:
    - mapping core decision logic, thresholds, source selection, safety gates;
    - telemetry ingestion semantics;
    - DeepSeek enhancement persistence behavior.
14. Required regression tests for future implementation:
    - existing e2e label propagation + lock override;
    - auto-apply gating matrix unchanged;
    - mapping readiness gating for AI unchanged;
    - enhancement does not mutate mapping fields;
    - UI copy changes do not alter status transitions.

