# Source-Audio Pause Processing (Experimental)

This runbook validates Stage 3.4.4 experimental mode that removes paused intervals from source audio before SpeechKit.

## Safety

- Experimental only; not production default.
- No Prisma schema/migration changes are required.
- Keep `PAUSE_PROCESSING_MODE` unset in production unless explicitly approved.

## Env Flags

- `PAUSE_PROCESSING_MODE=source_audio_cut` enables source-level pause cutting.
- `PAUSE_PROCESSING_MODE=transcript_interval_filter` keeps existing behavior.
- FFmpeg override (optional): `FFMPEG_PATH` (or legacy `FFMPEG_BIN`).
- Optional diagnostics:
  - `PAUSE_FILTER_CALIBRATION_ENABLED=1` (legacy interval-filter calibration artifacts).

## Local Reverse SSH Tunnel (when provider webhooks require public callback)

- Start your reverse tunnel exactly as in your environment-specific ops guide.
- Confirm callback URL is reachable before a live recording run.

## Local Validation Steps

1. Set mode:
   - PowerShell: `$env:PAUSE_PROCESSING_MODE="source_audio_cut"`
2. Run app locally and execute a session with pause/resume.
3. Ensure recording reaches `FINISH`.
4. Trigger transcription.
5. Verify transcript metadata in DB (`Transcript.processingMetadata.pauseProcessing`).

## Artifacts

When `source_audio_cut` runs with pause intervals, artifacts are written under:

- `.debug/pause-source-audio/<sessionId>/active-timeline.json`
- `.debug/pause-source-audio/<sessionId>/active-audio.wav`
- `.debug/pause-source-audio/<sessionId>/source-recording-info.json`
- `.debug/pause-source-audio/<sessionId>/ffmpeg-command.txt`
- `.debug/pause-source-audio/<sessionId>/diagnostics.json`

`diagnostics.json` includes ffmpeg path/source/version and timeline build timings.

## Forensics Script

Generate pause/audio/telemetry summary for one session:

```bash
node scripts/debug/session-pause-source-audio-forensics.mjs --sessionId <SESSION_ID> --env-file .env
```

Outputs:

- `.debug/session-forensics/<sessionId>/pause-source-audio-summary.md`
- `.debug/session-forensics/<sessionId>/pause-source-audio-summary.json`
- `.debug/session-forensics/<sessionId>/active-timeline.csv`
- `.debug/session-forensics/<sessionId>/normalized-telemetry.csv`

## Verify Transcript And Debrief

- Transcript text should not contain pause-window speech.
- Speaker mapping should still prefer `VOX_REMOTE_STREAM_ACTIVITY` where available.
- Debrief generation should operate without additional pause filtering when transcript mode is `source_audio_cut`.

## Expected Failure Modes

- If ffmpeg is unavailable in `source_audio_cut`, transcription fails explicitly.
- If recording duration cannot be resolved, source-audio cut fails explicitly.
- There is no silent fallback to full-source transcription in `source_audio_cut`.

## Cleanup Expectations

- Do not commit generated artifacts under `.debug/`.
- `.debug/` is gitignored; local artifact retention is operator-managed.
- Remove stale session artifacts as needed:
  - `Remove-Item -Recurse -Force .debug/pause-source-audio/<sessionId>`
