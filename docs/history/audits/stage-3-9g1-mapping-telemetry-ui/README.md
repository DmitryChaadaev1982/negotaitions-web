# Stage 3.9G1 Audit Package

This folder contains the read-only evidence package for current speaker mapping behavior.

## Key conclusion

- Classification: `HYBRID_GLOBAL_AND_SEGMENT_MAPPING`.
- Automatic mapping persists only when the full label-level candidate is safe/complete/high-confidence.
- Manual mapping is label-level/global by default and propagates to all matching segments.
- Segment-level divergence is supported via per-segment fields (`mappedParticipantId`, `mappingLocked`) and manual segment override flows.

## Files

- `mapping-persistence-model.md`
- `activity-telemetry-lineage.md`
- `activity-source-contract.csv`
- `activity-source-selection.md`
- `automatic-mapping-algorithm.md`
- `mapping-decision-table.csv`
- `mapping-state-machine.md`
- `mapping-state-transitions.csv`
- `automatic-mapping-persistence.md`
- `manual-mapping-workflow.md`
- `manual-mapping-propagation.csv`
- `mapping-api-contracts.md`
- `mapping-ui-inventory.md`
- `mapping-message-inventory.csv`
- `mapping-ui-scenario-matrix.csv`
- `production-mapping-sample-summary.csv`
- `mapping-granularity-conclusion.md`
- `mapping-preservation-contract.md`
- `current-mapping-ux-problems.md`
- `mapping-test-coverage.md`
- `mapping-test-coverage.csv`
- `future-readability-implementation-constraints.md`

