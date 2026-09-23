# Engineering Workflow

This is a human-readable architecture guide for NegotAItions engineering.
It is **descriptive**, not an executable second authority.

It does not replace `AGENTS.md`, scoped Cursor rules, current-state architecture,
`docs/requirements/PRODUCT-REQUIREMENTS.md`,
`docs/requirements/QUALITY-AND-ACCEPTANCE.md`, or the deployment runbook.
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
- Capture approved product requirements in
  `docs/requirements/PRODUCT-REQUIREMENTS.md` when the change is meaningful.
  Do not create a new stage-labelled requirements file as current truth.
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

`validate:fast` includes Prisma generate. Bootstrap `GENERATE_CLIENT` is a
declared COMMAND (`npm run prisma:generate`) so a fresh worktree materializes
`app/generated/prisma` during EO bootstrap rather than copying gitignored
artifacts. The same command also runs inside `validate:fast`.

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

## Operating principles

These principles describe how substantial Product changes, reviews, and
release evidence stay bounded. They are descriptive. They do not create a
second executable lifecycle, model router, or deployment engine. EO still
owns Change Unit identity, UAT acceptance timing, formal validation timing,
and release progression on the standard path.

Trivial edits skip the ceremony. Rigor follows risk: security, data
migration, production, and cross-cutting architecture need the full
contract; a typo does not.

### Bounded change

A substantial checkpoint states:

- branch and worktree;
- base and HEAD;
- purpose and authoritative inputs;
- scope and explicit non-goals;
- allowed mutations and stop conditions;
- validation, evidence, and final status.

Scope stays inside that contract. Unexpected material work stops as
`TARGETED_FIX_REQUIRED` or `BLOCKED`, or becomes a separate checkpoint.

### Authority domains

A successful check in one domain does not grant another.

Product credential and access owners:

| Domain | Owner |
| --- | --- |
| Authenticated session | `UserSession` cookie `auth_session` |
| Current-password proof | `lib/auth/authenticated-password-change.ts`, `lib/auth/credential-mutation.ts` |
| Reset-token proof | `PasswordResetToken`, consumed in the same transaction as the credential write |
| Facilitator and admin authorization | `lib/access-control.ts`, `lib/auth/admin.ts`, `lib/auth/admin-account-status.ts` |
| Local demo seed | `lib/db/seed-target-safety.ts`, `prisma/seed.ts` |

Seed provisions disposable demo data. It is not password-reset authority
and it is not production deployment authority. The seed contract is in
`docs/architecture/09-security-and-access-control.md`.

Operator authority is separate: production deployment, migration apply, and
recovery each need their own bounded authorization. A standing
through-production grant covers only the declared release envelope.

Destructive or dev-only tools that mutate persistent state validate the
target they will write. `NODE_ENV` is not that authorization. The seed
guard is the current example. Other scripts do not have to copy its
implementation.

### Current state and deferred state

Requirements and architecture documents separate implemented behavior from
deferred, planned, target, or future behavior. The documentation rule is in
`docs/DOCUMENTATION-GOVERNANCE.md`.

Password security is the current example. Implemented now: Argon2id for new
credentials, bcrypt verification for existing hashes, length 10–128, the
previous five passwords, the server common-password rule, and the current
self-change, reset, and session rules. Deferred: enforcement of
`passwordChangeRequiredAt`, administrator-initiated reset, and deletion of
active `UserSession` rows when an administrator sets BLOCKED or REJECTED.

### Deterministic facts before model judgment

Establish facts that tools can check before asking a model to interpret
them: git branch and HEAD, worktree cleanliness, candidate SHA, test result
and count, migration checksum, pending migration set, schema effect,
environment delta, build result, service health, open listener, and
deployment target identity.

Model review is for semantic correctness, architecture, security reasoning,
contradiction analysis, and scope interpretation.

### Bounded review

Preferred path: implementation, deterministic gates, bounded review, `PASS`.

Alternate path: `TARGETED_FIX_REQUIRED`, narrow remediation, the affected
regression, confirmation of that delta, `PASS`.

Terminal statuses are `PASS`, `TARGETED_FIX_REQUIRED`, and `BLOCKED`.

Classify a finding before changing code:

| Class | Meaning |
| --- | --- |
| Real defect | Violates an accepted contract or creates material risk |
| Conscious product decision | Another design may be preferable; the current choice is intentional |
| Optional hardening | Reasonable improvement, and not a current blocker |
| Deferred by design | Known future work |
| Evidence gap | Behavior may be correct; proof or tests are incomplete |

A reviewer does not become the product owner by filing a finding. A
stronger default replaces an accepted requirement only when the finding
shows a real contradiction or risk. Weigh threat, product context, cost,
and current scope.

### Human evidence

Automation covers deterministic tests, browser automation, logs, HTTP
evidence, database and security-state checks, and screenshots that do not
expose secrets.

A person is required for:

- `USER_SECRET_INPUT_REQUIRED` — the person types a real credential into
  the UI. The secret stays out of chat, logs, and evidence files.
- `USER_CONTEXT_REQUIRED` — the person selects the intended account, window,
  session, or context.
- `USER_DECISION_REQUIRED` — a genuine product, UX, or business choice.

Human critical smoke can be release evidence. Repeat it when a later change
invalidates that evidence. A documentation-only change, a test-only lint
fix, or an isolated seed-target fix leaves unrelated browser and migration
evidence valid.

### Autonomous UAT

When the UI must be validated, record: browser action, visible result, a
screenshot when it is safe and useful, browser and server logs, HTTP or API
evidence, and the relevant database or security state. End at `PASS` or a
bounded defect.

Automate routine UAT when that is technically feasible. A bounded agent may
repair an obvious in-scope defect during UAT when the checkpoint already
allows that remediation.

Guessing an existing user's credential, searching the database for a likely
password, exposing a real secret, or inventing user context are outside
this pattern.

### Evidence reuse and artifact immutability

Evidence stays valid while a later delta does not touch its dependencies.
Name the dependency. Do not repeat a gate because a later commit exists.

An accepted or rehearsed artifact is part of the release evidence: migration
raw bytes and SHA256, reviewed commit SHA, dependency lock state, the
production candidate, and the approved environment delta.

If a material artifact changes after review or rehearsal, prior evidence for
that artifact no longer applies. Deploy the artifact that was reviewed.

The checksum rule is general. A specific hash belongs to one file. Current
password-migration evidence is in
`docs/architecture/11-deployment-architecture.md`.

### Release envelope

A production release identifies:

- authorized target and candidate SHA;
- runtime delta, database delta, and environment delta;
- allowed mutations and forbidden mutations;
- pre-deploy gate, deploy action, and post-deploy gate;
- rollback or recovery boundary;
- operator smoke.

Approval of that envelope covers the commands inside it. It does not
authorize a later unrelated production mutation.

Normal deployment is a known target, a known candidate, a known migration
and environment delta, an expected state, and deterministic gates.

Recovery is unexpected migration history, unexpected schema divergence,
candidate mismatch, authority mismatch, partial deployment, or unknown
state. Stop the ordinary release. Open a separate recovery task with its
own evidence, scope, authority, validation, and recovery procedure.

Database identity, backup, history classification, clean-database proof,
and production-lineage rehearsal are specified in
`docs/architecture/11-deployment-architecture.md` and operated from
`docs/operations/deployment-runbook.md`.

### Environment delta

Production environment files are authoritative. Classify each required key
as `KEEP`, `ADD`, `CHANGE`, or `RETIRE`, and apply that semantic delta.
`.env.example`, a local `.env`, and a developer snapshot are not production
authority.

Keep development defaults, test configuration, production runtime
configuration, secrets, and provider credentials separate. A supported
disabled or local mode does not need production secrets. Email:
`EMAIL_DELIVERY_ENABLED=false` and `EMAIL_PROVIDER=disabled` allow safe
local web-process operation. Detail is in
`docs/architecture/email-runtime-and-yandex-cloud.md`.

### Runtime commits and documentation commits

HEAD may contain runtime-affecting commits and later documentation-only
commits. A documentation-only commit does not itself change runtime
behavior. Deployment still names the exact Git candidate. Before deploy,
confirm runtime-affecting paths are unchanged between the accepted runtime
candidate and the documentation HEAD, or deploy the accepted runtime SHA.

### Prompt contract

Non-trivial work can state: role, effort, branch, worktree, base and HEAD,
checkpoint, purpose, authoritative inputs, scope, non-goals, allowed
mutations, phases, stop conditions, validation, and final report.

Production work adds target, authority, pre-deploy, mutations, post-deploy,
and recovery. Small deterministic edits skip the full form.

### Roles

Use roles. Vendor and model names belong only in operational routing notes.

| Role | Work |
| --- | --- |
| Implementation worker | Routine implementation and debugging |
| High-reasoning implementer | Cross-cutting security or architecture |
| Independent reviewer | Semantic or security review, separate from the implementer |
| Deterministic tooling | Hashes, tests, build, schema, and status facts |

An independent reviewer is more useful than asking the same model to
re-review its own change. Executable model classes stay in
`docs/testing/agent-model-routing.md`. That file is operational routing
guidance.

### Validation evidence

Pick the layers the risk requires:

- unit tests;
- integration tests;
- PostgreSQL persistence and race tests;
- migration guards;
- lint, types, and build;
- autonomous browser UAT;
- human critical smoke;
- independent semantic or security review;
- production smoke.

Product command coverage is in
[`validation-checklist.md`](./validation-checklist.md). State which prior
evidence a change invalidates.
