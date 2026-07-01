# Stage 3 Final Regression + Yandex Readiness Report

Date: 2026-07-01  
Branch: `exp/yandex-voximplant-main-room`

## Summary of audit

Stage 3 covered:

- Full preflight gate execution.
- Stage 1/2 regression verification.
- Audio pipeline audit for Vox -> transcription -> SpeechKit path.
- Deployment/env/readiness documentation.
- Multi-instance lease risk review.
- Demo script + manual smoke checklist preparation.

## Fixes implemented

1. Added minimal audio preparation gate in preprocessing:
   - skip recompression when source is below `AUDIO_TRANSCRIPTION_MAX_FILE_MB` and format is compatible
   - keep compression/transcoding when source is above threshold or incompatible
2. Preserved existing fallback behavior and existing audio env vars semantics.
3. Added local recording metadata inspection script:
   - `npm run inspect:audio -- <file>`
4. Extended compressed key extension support for non-mp3/webm outputs.

## Audio quality findings

- Before hardening, app path always re-encoded audio before SpeechKit; this could stack lossy compression.
- Observed real smoke case: source `392.3 KB` became `591.7 KB` after preparation.
- The likely primary bottleneck was preprocessing policy (unnecessary recompression), not SpeechKit model alone.
- Real recording metadata (codec/rate/channels/bitrate) still requires one runtime sample capture and `inspect:audio` output.

## Actual codec/sample-rate/bitrate/channel data

At audit time:

- No local sample recording artifact was present in repository workspace.
- Therefore no factual ffprobe metadata could be attached yet.

Required follow-up command:

```bash
npm run inspect:audio -- "<path-to-downloaded-vox-recording>"
```

## Bottleneck conclusion

- Vox original recording quality bottleneck: not yet proven (needs runtime metadata sample).
- App compression/transcoding bottleneck: **confirmed risk** and now mitigated by threshold-based skip for small compatible files.

## Recommended env values

Stage 3 current POC baseline:

```env
AUDIO_RECORDING_TARGET_BITRATE_KBPS=128
AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS=96
AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000
AUDIO_TRANSCRIPTION_CHANNELS=1
AUDIO_TRANSCRIPTION_MAX_FILE_MB=24
```

Rule:

- `AUDIO_TRANSCRIPTION_MAX_FILE_MB` is a compression threshold.
- Below threshold and compatible format -> use original file without recompression.
- Above threshold or incompatible format -> compression/transcoding remains enabled.

## Vox console/scenario change requirement

- No mandatory Stage 3 scenario contract change introduced.
- Potential future improvements (separate tracks/multichannel strategy) remain backlog until validated against provider capabilities.

## Files changed

Code:

- `lib/audio/config.ts`
- `lib/audio/compress.ts`
- `lib/storage/s3.ts`
- `lib/services/transcription-runner.ts`
- `app/api/sessions/[sessionId]/transcribe-recording/route.ts`
- `lib/env.ts`
- `app/api/sessions/[sessionId]/voximplant/access/route.ts`
- `lib/voximplant/use-voximplant-room.ts`
- `scripts/inspect-audio-recording.ts`
- `package.json`

Docs:

- `docs/voximplant/stage-3-regression-yandex-readiness-audit.md`
- `docs/voximplant/stage-3-audio-quality-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
- `docs/voximplant/env-checklist.md`
- `docs/voximplant/final-demo-script.md`
- `docs/voximplant/stage-3-final-regression-yandex-readiness-report.md`

## Tests run and validation results

Preflight and validation:

- `git status --porcelain=v1` -> clean before implementation
- `git tag --list "checkpoint/vox-*"` -> required tags present
- `npm run lint` -> pass (warnings only, existing test-file warnings)
- `npm run build` -> pass
- `npx prisma validate` -> pass
- `npx prisma generate` -> pass

Stage 1 / Stage 2 baseline tests (preflight):

- `npx playwright test tests/e2e/voximplant-room-parity.spec.ts` -> pass
- `npx playwright test tests/e2e/voximplant-room-presence.spec.ts` -> pass
- `npx playwright test tests/e2e/voximplant-layout-camera-model.spec.ts` -> pass
- `npx playwright test tests/e2e/voximplant-recording-debug.spec.ts` -> pass (debug-only tests skipped unless flag enabled)
- `npx playwright test tests/e2e/event-flow.spec.ts` -> pass
- `npx playwright test tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts` -> pass
- `npx playwright test tests/e2e/voximplant-event-lobby.spec.ts` -> pass

Post-change regression spot checks:

- `npx prisma validate` -> pass
- `npx prisma generate` -> pass
- `npm run lint` -> pass (same warnings only)
- `npm run build` -> pass
- `npx playwright test tests/e2e/voximplant-room-parity.spec.ts` -> pass
- `npx playwright test tests/e2e/voximplant-recording-debug.spec.ts` -> pass
- `npx playwright test tests/e2e/voximplant-event-lobby.spec.ts` -> pass using `PLAYWRIGHT_PORT=3000` fallback

Script check:

- `npm run inspect:audio --` -> graceful usage error message (expected without file arg).

## Remaining known limitations

- Real recording artifact metadata still needed from next live sample.
- Multi-instance connection lease remains in-memory and not horizontally safe.
- Full 5-role real-runtime smoke still manual.

## Deployment readiness status

- Single-instance/local demo readiness: **ready with documented manual smoke**.
- Production readiness: **conditionally ready**, pending:
  - real webhook and recording smoke on public HTTPS
  - final audio profile selection from A/B test
  - multi-instance lease strategy decision (Redis/DB-backed)

## Multi-instance readiness status

- Current state: **not fully ready** for multi-instance deployment due to in-memory lease maps.
- Recommendation: prioritize centralized lease store before horizontal scale.

## Manual smoke checklist

Use `docs/voximplant/final-demo-script.md` steps 1-32 and A/B procedure.

## Checkpoint safety statement

Stage 3 is safe to checkpoint for single-instance/demo baseline after manual smoke and one real recording metadata capture.

## Compliance confirmations

- Stage 4 / new product stage work was not started.
- Prisma schema/migrations were not changed.
- Vox webhook contract was not changed.
- Vox scenario/rule contract was not changed in code.
- Yandex SpeechKit/Yandex AI/DeepSeek internals were not rewritten.
- No hard-coded local tunnel URL was introduced.

