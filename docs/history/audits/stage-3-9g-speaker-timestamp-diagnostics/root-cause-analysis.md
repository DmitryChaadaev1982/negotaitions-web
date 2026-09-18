# Root Cause Analysis

Selected root causes:

1. `RAW_SPEECHKIT_INTERVALS_OVERLAP`
   - Evidence: persisted/provider-normalized windows overlap in sequence by `orderIndex`.
   - Layer: provider diarization windows.
   - Severity: high readability, medium mapping.
   - Confidence: high.

2. `RAW_SPEECHKIT_INTERVALS_COARSE`
   - Evidence: long windows spanning mixed activity, high simultaneous overlap ratios.
   - Layer: provider segmentation granularity.
   - Severity: high readability, high mapping ambiguity.
   - Confidence: high.

3. `UI_ROUNDING_MISLEADING`
   - Evidence: `Math.floor` start/end formatting creates `00:00:00-00:00:00` for sub-second valid intervals.
   - Layer: UI formatting.
   - Severity: medium readability.
   - Confidence: high.

4. `MAPPING_ALGORITHM_INSUFFICIENT`
   - Evidence: overlap margins remain weak/ambiguous in mixed mono overlap-heavy windows.
   - Layer: mapping selection constraints under overlapping coarse windows.
   - Severity: medium-high mapping.
   - Confidence: medium-high.

5. `MIXED_MONO_AUDIO_LIMITATION`
   - Evidence: single-channel mixed source + overlapping speech windows prevents deterministic speaker attribution.
   - Layer: capture architecture.
   - Severity: high long-term mapping reliability.
   - Confidence: high.

Not selected:
- `PAUSE_TIMELINE_RESTORATION_DEFECT` (no restoration writeback to persisted segment boundaries in this mode).
- `APPLICATION_SEGMENT_MERGING` (no evidence of merge-across-speakers in current extraction path).

