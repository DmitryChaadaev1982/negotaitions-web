# Test Coverage and Limitations

Focused audit test: `tests/e2e/stage-3-12-ui-audit.spec.ts`.

Helpers:
- `tests/e2e/helpers/ui-audit-fixtures.ts`
- `tests/e2e/helpers/ui-audit-collector.ts`

Captured surfaces: dashboard, Events list, Sessions list, Cases list, owner lobby desktop/mobile, active room with eight seeded negotiators and 20 observers, debrief, materials.

Matrix dimensions covered by deterministic fixtures: negotiator counts 2-8, observer counts 0-100, RU/EN, camera/mic all-on/all-off/mixed, lifecycle OPEN/DEBRIEF_OPEN/CLOSED.

Focused audit run result:
- Command: `npm run test:e2e:focused:managed -- tests/e2e/stage-3-12-ui-audit.spec.ts --project=chromium`
- Result: 4 passed.
- Local screenshots: 9 PNG files under `artifacts/ui-audit/screenshots`.
- Local metrics: 9 JSON files under `artifacts/ui-audit/metrics`.
- Trace: 1 Playwright trace zip for `UIAUD-SCALE-008`.
- Runtime warning observed: React hydration mismatch warnings on list/material pages, likely from client-only caret style/SSR differences; recorded as audit evidence, not classified as a Stage 3.12 code regression.

Limitations:
- The focused run does not launch 100 real browser contexts.
- High observer counts are fixture/source evidence unless explicitly captured later.
- No axe scan was run because dependency is absent.
- Browser zoom 125/150/200 is documented as required follow-up; structural metrics cover viewport reflow but not all zoom variants.
- Production data was not used.
