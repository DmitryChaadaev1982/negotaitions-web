# Validation dependency graph audit

Generated for `chore/agent-test-performance-optimization`.

Machine-readable companion: `docs/tooling/validation-dependency-graph.json`

## Composite scripts

| Script | Expands to | Cost |
|--------|------------|------|
| `validate:fast` | lint → prisma validate → prisma generate → test:unit → test:e2e:list | medium |
| `validate:deploy` | **validate:fast** → build | heavy |
| `test:e2e:smoke` | managed Playwright `@smoke` | heavy |
| `test:e2e:smoke:browser` | managed Playwright `@browser-smoke` | heavy |
| `test:stage310` | stage unit subset + managed e2e (excl. observer layout) | heavy |
| `test:stage313c` | stage email unit subset + managed e2e | heavy |

## Duplication in a typical major agent prompt

When a prompt runs:

`email:templates:validate` → `prisma validate` → `prisma generate` → `test:unit` → `validate:fast` → `validate:deploy` → `test:e2e:smoke` → `test:e2e:smoke:browser` → `test:stage310`

| Primitive | Executions | Safe to dedupe? | Notes |
|-----------|------------|-----------------|-------|
| lint | 2 | yes | Nested via validate:fast inside validate:deploy |
| prisma validate | 3 | yes | Explicit + validate:fast ×2 |
| prisma generate | 3 | yes | Explicit + validate:fast ×2 |
| test:unit | 3 | yes | Identical command |
| test:e2e:list | 2 | yes | Nested |
| build | 1 | retain | Distinct production compile |
| email templates | 1 | retain | Not inside validate:* |
| @smoke | 1 | retain | Distinct tag set |
| @browser-smoke | 1 | retain | Distinct tag set; do not merge with @smoke |
| stage310 | 1 | retain when requested | Explicit stage gate; unit subset overlaps test:unit |

## Chosen design

Keep existing public scripts unchanged. Add `npm run validate:agent` which executes the **union of primitives once** for a chosen mode:

- `--mode=fast` — local gate primitives + email template validate
- `--mode=deploy` — fast + production build (default)
- `--mode=runtime` — `@smoke` then `@browser-smoke`
- `--mode=full` — deploy union + runtime smokes (canonical final agent gate)
- `--with=stage310|stage313c|stage313c-remediation|templates|tooling`

Plan mode: `npm run validate:agent -- --plan`

## Concurrency

Sequential by default. Do not parallelize Next builds, Prisma generate, or managed Playwright servers sharing ports 3000/3100.

## Caching

Within-one-process deduplication map only. No cross-SHA / cross-run skip cache.
