# Troubleshooting

## Room Join Issues

- Check provider mode (`VIDEO_PROVIDER` expected for target environment).
- Validate Voximplant access APIs for session/event.
- Confirm participant authorization path (account or token path as applicable).

## Recording Stuck Or Missing File

- Verify recording status webhook delivery path and HMAC configuration.
- Check webhook base URL resolution and runtime domain alignment.
- Confirm storage object existence for persisted file key.

## Transcription Failures

- Confirm recording is in ready state with usable file key.
- Check storage download and ffmpeg/transcoding errors in diagnostics/events.
- Validate SpeechKit credentials and operation polling behavior.

## AI Analysis Not Available

- Ensure transcript exists and mapping prerequisites are satisfied.
- Check analysis status in materials/status API.
- Confirm provider configuration for selected analysis provider.

## Event/Lobby Assignment Inconsistencies

- Re-check event state API output and participant assignment mapping.
- Confirm no stale tab/session conflict in client runtime.

## Source Notes

- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `lib/services/transcription-runner.ts`
- `lib/transcription/auto-speaker-mapping.ts`
- `docs/architecture/session-flow-gap-analysis.md`
- `docs/testing/yandex-poc-smoke-regression-plan.md`
