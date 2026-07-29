# Test results — pre-deployment gate

Server mode: **managed** (`run-playwright-mode.mjs --mode=managed`).

Branch: `fix/stage-3-10-production-debrief-hotfix`  
Hotfix commit: `f94257bf643e3c23f411f389bc3e7d4d9c20c03e`

## Mandatory commands

| Command | Exit | Passed | Failed | Skipped | Report path |
|---|---:|---:|---:|---:|---|
| `npm run validate:deploy` (retry after lightningcss native fix) | **0** | unit **584**; e2e list **615**; build OK | **0** | **0** | `docs/audits/stage-3-10-production-debrief-hotfix/validation-runs/validate-deploy-retry.log` |
| `npm run test:e2e:smoke` | **0** | **12** | **0** | **0** | `.../validation-runs/e2e-smoke.log` |
| `npm run test:e2e:smoke:browser` | **0** | **5** | **0** | **0** | `.../validation-runs/e2e-smoke-browser.log` |
| `npm run test:stage310` | **0** | unit **102** + e2e **30** | **0** | **0** | `.../validation-runs/test-stage310.log` |

### Notes

- First `validate:deploy` attempt exited **1** solely due to missing `lightningcss.win32-x64-msvc.node` in this worktree `node_modules` (local install hygiene). Not a product defect. After `npm install lightningcss --no-save`, build and full `validate:deploy` passed.
- No focused/dual-TZ suite re-run outside `test:stage310` (already included there).
- Skips: none reported by node:test or Playwright summaries above.

## Non-blocking follow-up

- True concurrent FINISH / auto-timer race harness: **deferred**. Existing Stage 3.10 suites (including finish idempotency + presence) did not fail; track as follow-up, not a deploy blocker for this timezone hotfix.

## Previously confirmed (not re-run standalone)

Focused lifecycle + dual-TZ: 32/32 PASS (earlier in investigation).
