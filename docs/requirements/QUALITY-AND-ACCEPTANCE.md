# Quality And Acceptance

This is the canonical quality and acceptance contract. Command catalogs,
E2E isolation, and observer matrices stay in `docs/testing/` so this file
does not duplicate them.

## Ownership

| Owner | Role |
| --- | --- |
| Native Agent | Focused tests and diagnostics while implementing |
| Product commands | What `validate:*`, `test:e2e:*`, `eval:registry:check` actually check |
| EO | When formal validation and release gates run, after UAT |

UAT precedes formal validation. Chat transcript is not lifecycle authority.

Do not delegate `validate:fast`, `validate:build`, or `validate:deploy` to a
Cursor subagent. Operator PowerShell / EO owns those.

## Product command catalog

Authoritative command behavior: [`docs/testing/validation-checklist.md`](../testing/validation-checklist.md).

Canonical EO-declared gates:

- `npm run validate:fast`
- `npm run validate:deploy` (`validate:fast` then `validate:build`, once)
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

`validate:fast` never runs `*.pg.test.ts` or `tests/pg-race/**`. Name
mutating tests so they cannot leak into that gate.

## E2E and database isolation

Authoritative strategy: [`docs/testing/e2e-strategy.md`](../testing/e2e-strategy.md).

- `E2E_DATABASE_URL` is mandatory; never fall back to `DATABASE_URL`.
- E2E PostgreSQL is `localhost:5433/negotiations_e2e`.
- Do not run overlapping managed Playwright servers.
- Tunnel and live-provider suites are opt-in.
- Managed Playwright pins `VIDEO_PROVIDER=livekit` unless
  `PLAYWRIGHT_VIDEO_PROVIDER=voximplant`.
- `POST_TRANSCRIPTION_LAB=1` skips realtime signaling and is ignored when
  `NODE_ENV=production`.

## Observer coverage

Authoritative matrix:
[`docs/testing/observer-test-execution-policy.md`](../testing/observer-test-execution-policy.md).

Layout contracts (fit ≤4, overflow ≥5 at 1440×900) must be verified before
room-geometry release. Visual acceptance on one surface does not imply
neighbor surfaces.

## Enhancement UAT

Large-realistic enhancement UAT:
[`docs/testing/large-realistic-enhancement-uat.md`](../testing/large-realistic-enhancement-uat.md).

Skip is not Resume. Max two provider POSTs per chunk per run. UAT shares
the ten-slot enhancement inventory with the app and Stage 3.10 maintenance.

## Eval registry and requirement completeness

- [`docs/testing/eval-registry.json`](../testing/eval-registry.json) —
  `npm run eval:registry:check` requires evidence files to exist.
- [`docs/testing/requirement-completeness.md`](../testing/requirement-completeness.md)
  and `.cursor/skills/verify-requirements/SKILL.md`.
- `verify-requirements` is not `validate-wave`.

## Native dialogs

Production UI must not call `window.confirm`, `window.prompt`, or
`window.alert`. `npm run check:native-dialogs` is part of `validate:fast`.
In-app dialogs: `components/confirm-dialog.tsx` and related components.

## Model routing (process, not product runtime)

[`docs/testing/agent-model-routing.md`](../testing/agent-model-routing.md):
`freshContext` is not M4. Maximum automatic root-cause escalation is one
M2→M3. EO binds actual models.

## Documentation Change Units

For documentation-only Change Units, deterministic checks are:

- internal Markdown links resolve (`node scripts/check-docs-links.mjs`)
- `architecture/code-map.md` names real modules/tests
- `git diff --check`
- `npm run eval:registry:check` if evidence paths changed
- focused unit tests that assert documentation contracts, if any

Do not call real Yandex/Voximplant providers. Do not mutate production.
