# Stage 3.9G Speaker/Timestamp Diagnostics

Primary scope: `cmrhs7ms80003mvm1tc8jv7ks` / `cmrhsdmei004nmvm1m0e8dme6` / `cmrhsg3fd0071mvm17z8j9oum`.

## Evidence constraints

- Stored raw provider snapshot contains only a sanitized single-result snapshot payload, while metadata reports `rawResultCount=66`.
- Full per-result raw SpeechKit stream is not persisted in DB metadata; therefore Part B per-result table is provided as the closest available provider-normalized proxy and explicitly marked as such.

## Key quantitative facts

- Persisted segment rows: 22
- Adjacent overlap pairs by `orderIndex`: 19
- Floor-rounding zero-length displays: 1
- Pause processing mode: `source_audio_cut`

## Outputs

All required Stage 3.9G CSV/MD files are generated in this folder and sanitized (no transcript text, participant names, credentials, or raw payload dumps).

