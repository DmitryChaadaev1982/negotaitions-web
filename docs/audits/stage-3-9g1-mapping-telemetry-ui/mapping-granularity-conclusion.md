# Mapping Granularity Conclusion

## Classification

`HYBRID_GLOBAL_AND_SEGMENT_MAPPING`

## Why this classification

- Schema evidence:
  - global label map exists (`Transcript.speakerMapping`);
  - segment-level assignment also exists (`TranscriptSegment.mappedParticipantId`) plus lock (`mappingLocked`).
- Algorithm evidence:
  - auto and manual cluster mapping operate label-level/global first.
- API evidence:
  - cluster mapping endpoints save global map and then write segment rows.
  - lock-aware updates allow segment divergence.
- UI evidence:
  - primary workflow is label-based selector;
  - manual segment attribution and manual override concepts exist.
- Production evidence:
  - `primary` shows globally consistent full mapping;
  - `secondary` shows no applied segment mapping (all unmapped), confirming non-applied state handling.
- Tests:
  - e2e verifies propagation by label and lock/override behavior.

## Requested feasibility answers

1. Future UI marking individual ambiguous segments safely:
   - technically possible because segment-level fields exist, but current ambiguity diagnostics are label/global not segment-native.
2. Ambiguous segment count:
   - not reliably derivable from current auto diagnostics alone; would need deterministic segment-level ambiguity definition.
3. Partial apply of mappings:
   - technically possible via segment updates/manual overrides, but current auto-apply design intentionally avoids partial auto persistence.
4. Change impact:
   - per-segment ambiguity markers/counts likely need API and/or algorithm changes for reliable semantics;
   - pure copy/text clarification can be UI-only;
   - preserving current auto thresholds/decision behavior requires no algorithm changes.

