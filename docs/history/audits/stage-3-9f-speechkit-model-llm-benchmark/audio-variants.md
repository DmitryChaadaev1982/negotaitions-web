# Audio Variant Construction and Equivalence

## Inputs

- A (`A-original.bin`): original recording object as stored.
- B (`B-processed-no-cut.wav`): decode/re-encode control without pause removal, matched to production target format.
- C (`C-active-audio.wav`): current active-audio artifact used by production STT flow.

## Technical properties

- A: FLAC, 8 kHz, mono, duration `114.696s`, size `1,031,765`.
- B: WAV PCM s16le, 8 kHz, mono, duration `114.696s`, size `1,835,214`.
- C: WAV PCM s16le, 8 kHz, mono, duration `103.870s`, size `1,661,998`.

## Equivalence check

- B and C matched in:
  - sample rate (`8000`)
  - channel count (`1`)
  - codec (`pcm_s16le`)
- Intended difference between B and C: pause trimming/stitching only.
- A and B ASR outputs were identical in baseline run (same text hash and metrics), indicating no measurable degradation from technical transform path itself for this sample.

## Pause-cut diagnostics

- Pause interval count: `1`
- Active intervals: `2`
- Removed duration: `10826 ms`
- Seam boundaries:
  - original timeline cut-out region: `57.458s` -> `68.284s`
  - active timeline seam at `57.458s`

## Interval adjudication (resolved)

- Private clip set created under `/tmp/negotaitions-stage-3-9f-speechkit-benchmark/manual-review/`:
  - `removed-interval-A.wav` (exact removed range)
  - `removed-interval-context-A.wav` (3s before/after)
  - `removed-interval-context-B.wav` (3s before/after)
  - `seam-context-C.wav` (3s before/after active seam)
- Acoustic metrics for removed interval clip (`removed-interval-A.wav`):
  - duration `10.826s`
  - mean volume `-25.5 dB`, max `-4.7 dB`
  - silence total `2.452s`, non-silent `8.374s`
  - speech-like activity detected: `true`
- Coverage extraction from existing raw A/B results around removed range:
  - A overlapping/context segments: `6`, words: `74`, lexical content: `true`, speaker labels: `true`
  - B overlapping/context segments: `6`, words: `74`, lexical content: `true`, speaker labels: `true`
  - C seam-neighbor mapped segments: `2`, words: `53`, lexical content: `true`, speaker labels: `true`
- Conclusion for this interval: removed region contains meaningful speech content, not pure silence.

