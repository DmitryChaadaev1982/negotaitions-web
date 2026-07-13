# Stage 3.9G Speaker Timestamp Diagnostics

Audit scope:
- Session: `cmrhs7ms80003mvm1tc8jv7ks`
- Recording: `cmrhsdmei004nmvm1m0e8dme6`
- Transcript: `cmrhsg3fd0071mvm17z8j9oum`

This report package is in:
- `docs/audits/stage-3-9g-speaker-timestamp-diagnostics/`

Key outcomes:
- Persisted segment timestamps come from SpeechKit alternative-level timing parsed in `extractSegmentsFromRecognition`, then persisted unchanged from normalized segments.
- `Speaker 1/2` are application-generated aliases (`speaker_1`, `speaker_2`), not raw provider literals.
- Overlap originates in provider-normalized diarization windows; application persistence preserves these overlaps.
- `source_audio_cut` mode means persisted timestamps are active-audio timeline values; no post-ASR restoration writes are applied.
- UI whole-second floor formatting (`Math.floor`) causes `00:00:00-00:00:00` display for valid sub-second rows.
- Activity telemetry does not create transcript intervals; it influences mapping suggestions and confirmed participant assignment only.

