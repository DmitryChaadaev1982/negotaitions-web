# Engineering Workflow

This is a human-readable architecture guide for NegotAItions engineering.
It is **descriptive**, not an executable second authority.

It does not replace `AGENTS.md`, scoped Cursor rules, current-state architecture,
requirement manifests under `docs/requirements/`, or the deployment runbook.
Those remain the domain, safety, and product authorities.

The Engineering Orchestrator (EO) is the single executable engineering
lifecycle: Change Unit identity, sibling worktree/bootstrap, TYPED_IMPORT,
test-instance/UAT, formal validation after UAT, and commit/release/deploy/canary.

Do not treat the conceptual chain below as a Product-owned sequencer to run
by hand:

```
Requirement → CIA → Change Unit → L1 → L2 → L3 → L4 → deploy
```

That sequence is historical vocabulary for humans. EO owns the durable CU
and the executable progression. Native Agent implements in the authorized
worktree and runs focused checks.

## A. Native Agent responsibilities

Cursor Native Agent is the normal interactive engineering interface.

- Read, search, and edit Product source in the authorized worktree.
- Run focused/bounded tests and diagnostics during implementation.
- Follow Product domain, privacy, database, and exceptional production safety
  rules.
- Capture approved product requirements in the existing
  `docs/requirements/` manifest style when the change is meaningful.
- Use Change Impact Analysis and eval-class thinking as planning aids, not as
  a second orchestrator.

Native Agent does not own: worktree creation, wholesale env copy, UAT
acceptance authority, formal validation timing, release/deploy progression,
or model binding.

## B. EO responsibilities

EO owns:

- durable Change Unit identity and continuation
- sibling worktree / `WORKTREE_PREPARE` / TYPED_IMPORT
- test-instance graph (app + reverse tunnel + UAT URL)
- operator UAT before formal validation
- canonical formal validation after UAT
- accepted candidate digest, commit, standing through-production grant
- typed PREPARE / PREFLIGHT / DEPLOY / CANARY

Public entry for an existing CU: `CONTINUE_CHANGE_UNIT` /
`eo change-unit continue`. `stage-start` is a thin wrapper. Chat transcript
is not lifecycle authority; resume from durable CU artifacts.

## C. Product profile / overlay ownership

Tracked Product metadata:

- `.eo/repository-profile.json` — Product ↔ EO executable contract
- `.eo/deployment-targets/negotaitions-production.json` — standard CP2F
  target, including `canaryHttpPath`
- `.cursor/rules/engineering-orchestrator.mdc` — short always-on Native contract

Machine-local overlay (not Git):

- typed env source path (`TYPED_IMPORT`, wholesale copy forbidden)
- non-secret runtime dependency values such as `PLAYWRIGHT_BROWSERS_PATH`

Do not commit `.env`, secret values, or the actual Playwright path.

`taskClassPolicy` values `SOURCE_ONLY` and `UI_ACCEPTANCE` are current EO
schema compatibility names. Runtime meaning: they select local-app readiness
requirements for planning/implementation/validation/audit intents. They are
not a Product model router and not a second workflow architecture.

## D. UAT-before-formal-validation invariant

Operator UAT on the live test instance must pass before EO runs canonical
formal validation. Native focused tests during implementation are not UAT
and are not a substitute for that checkpoint.

## E. Focused tests vs canonical formal validation

| Owner | What |
| --- | --- |
| Native Agent | Focused unit/API/component tests and bounded diagnostics while implementing. |
| Product | Command implementations: `validate:fast`, `validate:deploy`, `test:e2e:smoke`, `test:e2e:smoke:browser`, `prisma:generate`, and other package scripts. |
| EO | Whether and when canonical/release gates run after UAT. |

`validate:fast` includes Prisma generate. Bootstrap `GENERATE_CLIENT` with
`generator: "none"` means EO worktree prepare does not run a second generator;
`npm ci` installs packages, and Product `prisma:generate` / `validate:fast`
materializes `app/generated/prisma`.

See [`validation-checklist.md`](./validation-checklist.md) for command
coverage and limitations.

## F. Standing through-production authorization

After UAT pass and a valid StandingReleaseGrant bound to the CU, accepted
digest, standard path `NEGOTAITIONS_YANDEX_POC`, and production target
`negotaitions-production`, EO may run typed release operations without
repeated low-level ssh/git/systemctl approvals.

This does not authorize exceptional production mutation.

## G. Exceptional safety boundaries

Still require explicit authority:

- destructive DB/data mutation
- force push / history rewrite
- arbitrary production shell
- unknown production script
- firewall/VPN/infrastructure mutation
- secret mutation outside the declared contract
- rollback with data-loss risk
- deploy of an unaccepted SHA
- raw Native production SSH

See `.cursor/rules/deployment-production-safety.mdc` and
`docs/operations/deployment-runbook.md`. Do not copy those rules here.

## H. Workspace / chat continuity

Open Folder starts a new Agent. Chat continuity is not promised.

A brand-new Agent learns Native vs EO from:

- `.cursor/rules/engineering-orchestrator.mdc`
- `.eo/repository-profile.json`
- this guide and `AGENTS.md`

Resume the durable CU. Do not recreate a competing worktree or copy env.

## Planning aids (human, not executable)

For **meaningful** Product behavior/schema/access/publication changes, a
compact Change Impact Analysis remains useful:

**A. CHANGE** — What actually changes?
**B. INVARIANTS** — What must remain true?
**C. IMPACT MAP** — DB, Prisma, server, API, client, access, lifecycle,
publication, providers, ENV, tests.
**D. CHANGE UNITS** — Bounded slices. These are planning slices, not a
Product-owned CU engine. EO mints the durable CU.
**E. HIGH-RISK KERNEL** — Smallest set needing maximum caution.
**F. EVAL IMPLICATIONS** — Evidence classes before implementation.
**G. STRATEGY** — Keep together vs split, with why.
**H. VALIDATION INTENT** — Which Product commands are relevant. EO decides
canonical timing after UAT.

Skip a persisted CIA for a trivial typo or isolated comment.

### Eval classes

Named invariant-level eval IDs live in `docs/testing/eval-registry.json`.
Do not require a Registry entry for every unit test.

**STATE** — static known state, render, or domain result.
**TRANSITION** — actual A → B behavior.
**MOUNTED_TRANSITION** — same already-mounted client converges after backend
changes. Reload is not a substitute.
**HISTORICAL_READ** — READ/open historical-shape data.
**HISTORICAL_FIRST_MUTATION** — first changing operation of new code on
historical-shape data. READ is not a mutation.
**MIGRATION_COMPATIBILITY** — OLD/NEW code × OLD/NEW DB. NEW CODE + OLD DB
must work or be prevented by deployment ordering.
**INTERACTION** — real user surface.
**PROVIDER / INTEGRATION** — mocks versus live-provider.
**MANUAL / PRODUCTION ACCEPTANCE** — human or production wiring evidence.

Critical rule: **STATE FIXTURE ≠ TRANSITION FIXTURE.**

When historical data is relevant: **WHAT HAPPENS ON FIRST MUTATION UNDER NEW
CODE?** Use realistic synthetic historical shapes, not production data copies.

### Async AI classification

- **MANDATORY GATE** — user progress cannot continue until it finishes or
  fails closed.
- **OPTIONAL ACCELERATOR** — current usable result remains valid if it fails.
- **BACKGROUND ENRICHMENT** — must not block the visible workflow.

### Human acceptance

Presentation/UI-only change: focused validation → local render → operator
visual acceptance before expensive canonical gates.

Destructive interaction: test the real button/dialog, not only a seeded
final state.

Operator acceptance is a checkpoint. It is not a substitute for EO formal
validation of code that still requires those gates.

Requirement completeness (`verify-requirements`) remains separate from
correctness/regression (EO formal validation). Do not collapse them.

Do not commit, push, or deploy without explicit operator authorization.
