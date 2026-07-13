# Stage 3.9G Implementation Prompt (Evidence-backed)

- Branch: `audit/stage-3-9g-speaker-timestamp-diagnostics`
- Base: `deploy/yandex-poc`

## Change scope

### Files to change
- `lib/transcription/speaker-labels.ts`
- `components/recording-transcription-section.tsx`
- `app/api/sessions/[sessionId]/recording/route.ts` (only if stable sort key must be explicit in payload)
- `app/api/sessions/[sessionId]/speaker-mapping/route.ts` (diagnostic confidence exposure only)
- Relevant unit/integration/e2e tests for above behavior.

### Files not to touch
- Env files (`.env`, `.env.local`, server envs)
- Prisma schema/migrations
- provider integration credentials/calls
- unrelated app domains.

## Immediate design
- Add sub-second timestamp display precision (at least tenths).
- Keep persisted seconds unchanged.
- Preserve current `orderIndex` but render with stable deterministic sort key for readability.
- Explicitly mark overlap and very-short segment durations in UI.

## Medium-term design
- Introduce canonical segmentation abstraction that preserves segment identity per run.
- Enhancement compatibility: `qualityText` remains canonical raw text; `text` remains enhanced display text.
- Enhancement must never mutate timestamps/speaker labels/order.
- Manual speaker mapping behavior remains intact.

## Testing
- Unit: formatter precision, overlap marker, sorting stability, mapping confidence thresholds.
- Integration: recording API serialization and speaker-mapping diagnostics.
- E2E: facilitator transcript readability + mapping confirmation with ambiguous/clear cases.

## Validation gates (mandatory)
- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

## Deployment
- Canary on facilitator accounts first.
- Observe mapping-confirmation conversion + manual override rate.
- Rollback: disable feature flag and revert UI precision/sorting path.

