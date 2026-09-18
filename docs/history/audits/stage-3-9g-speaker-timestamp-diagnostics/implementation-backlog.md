# Implementation Backlog

1. P0 - UI timestamp precision + overlap markers
- Root cause: `UI_ROUNDING_MISLEADING`
- Files: `lib/transcription/speaker-labels.ts`, `components/recording-transcription-section.tsx`
- Impact: immediate readability improvement.
- Tests: formatter unit tests + UI rendering snapshots.
- Rollout: feature flag, canary on facilitator UI.
- Rollback: disable flag.

2. P1 - Deterministic transcript row ordering in UI
- Root cause: overlap readability/conflicts.
- Files: recording API/UI row transforms.
- Tests: sorting stability tests.

3. P1 - Mapping confidence/ambiguity UX
- Root cause: `MAPPING_ALGORITHM_INSUFFICIENT`
- Files: speaker mapping API/UI diagnostics consumption.
- Tests: mapping edge-case unit tests + e2e review flow.

4. P2 - Canonical segmentation layer (word/utterance based)
- Root cause: `RAW_SPEECHKIT_INTERVALS_COARSE`, `RAW_SPEECHKIT_INTERVALS_OVERLAP`
- Dependency: durable full raw provider token timing persistence.
- Tests: segmentation invariants + enhancement compatibility.

5. P3 - Separate-track feasibility and rollout plan
- Root cause: `MIXED_MONO_AUDIO_LIMITATION`
- Scope: recording architecture and merge pipeline.

