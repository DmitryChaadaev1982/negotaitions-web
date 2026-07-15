# Stage 3.10 Go / No-Go Checklist

## Pre-Merge Gates (Mandatory)

- [ ] Clean `git status --short` (no accidental artifacts).
- [ ] Secret scan for changed files reviewed; no new secrets introduced.
- [ ] Migration rehearsal passed on non-production DB.
- [ ] Scenario local contract checks passed (`node --check` + scenario test).
- [ ] `npx prisma generate` passed.
- [ ] `npx prisma validate` passed.
- [ ] `npm run lint` passed (warnings triaged).
- [ ] `npm run test:stage310` passed.
- [ ] `npm run test:stage310:browser` passed.
- [ ] `npm run test:unit` passed.
- [ ] `npm run build` passed.
- [ ] `npm run validate:fast` passed.
- [ ] `npm run validate:deploy` passed.
- [ ] `npm run test:e2e:smoke` passed.
- [ ] `npm run test:e2e:smoke:browser` passed.
- [ ] Traceability totals remain 75 / 70 / 3 / 2 / 0.

## Pre-Production Gates (Mandatory)

- [ ] Production backup confirmed (DB + app path).
- [ ] Deploy owner identified.
- [ ] Monitoring dashboard and alert channels ready.
- [ ] Rollback commands reviewed by deploy owner.
- [ ] Remote Vox scenario drift check reviewed manually.
- [ ] Disposable provider canary data prepared.
- [ ] Maintenance unit files reviewed against host conventions.
- [ ] Maintenance timer planned as disabled-first rollout.

## Post-Deploy Gates (Mandatory)

- [ ] Login and session navigation healthy.
- [ ] Sessions overview renders and actions behave correctly.
- [ ] Standalone room access guard behavior verified.
- [ ] Event lobby guard behavior verified.
- [ ] Administrative session completion works and is idempotent.
- [ ] Explicit leave/refresh/rejoin flows verified.
- [ ] Event completion hard-close verified.
- [ ] Recording stop/finalization/webhook path verified.
- [ ] Materials page and transcript pipeline progression verified.
- [ ] Maintenance one-shot run successful.
- [ ] Maintenance timer first scheduled run successful.
- [ ] No abnormal 5xx, auth errors, or provider credential failures.
