# Stage 3.21A — Engineering Toolchain Upgrade & Validation Hardening

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.21A.
Architecture, privacy, access, database, operations, and existing validation
ladder documents remain the domain/safety authorities. CP0 architecture
(Option C / Hybrid, worktree-scoped locks, stale-lock policy) is the approved
tooling authority for this stage.

Status values: `APPROVED`, `IMPLEMENTED`, `DEFERRED`, `OUT_OF_SCOPE`, `PASS`.

```
STAGE_ID = 3.21A
STAGE_NAME = Engineering Toolchain Upgrade & Validation Hardening
STAGE_KIND = engineering / tooling
PRODUCT_BEHAVIOR_CHANGE = NO
CHECKPOINT = CP4 Production Technical
CP0 = APPROVED WITH CONSTRAINTS
CP1 = APPROVED / PASS
CP2 = PASS
CP3 = PASS
CP4 = PASS
```

## Change Impact Analysis (CP1)

```
CHANGE: Replace shell-chained validate:* / unguarded prisma:generate with a
        worktree-scoped validation kernel (orchestrator, atomic locks,
        bounded process, heartbeat, owned-tree cleanup, guarded generate
        + client integrity).
INVARIANTS: Public script names unchanged; FAST/BUILD/DEPLOY step graph
            equivalent; sibling worktrees independently validatable;
            never kill by image name; no Prisma/Next/React/TS upgrades;
            no PG-test edits; product runtime unchanged.
IMPACT: tests/evals, scripts, package.json script metadata, testing docs
UNITS: CU-lock, CU-bounded-process, CU-orchestrator, CU-prisma-guard,
       CU-public-scripts, CU-evals-docs
KERNEL: CU-lock + CU-bounded-process + nested deploy lock ownership
EVAL: EVAL-WF-VALIDATION-LOCK-SAME-WORKTREE,
      EVAL-WF-VALIDATION-LOCK-SIBLING-WORKTREE,
      EVAL-WF-NESTED-DEPLOY-FAST,
      EVAL-WF-PRISMA-GENERATE-GUARD,
      EVAL-WF-STEP-TIMEOUT-KILLS-TREE,
      EVAL-WF-PID-IDENTITY-FORCE-KILL,
      EVAL-WF-OPERATOR-CANCEL-CLEANUP
STRATEGY: A — keep kernel together; lock/process/orchestrator coupling
          would make a split more expensive and less safe
VALIDATION_PLAN: L1 T01-T22 + gate-contract + eval-registry + lint of
                 changed tooling + git diff --check. validate:fast /
                 validate:deploy / L4 NOT_RUN. PG hang and Prisma 7.10
                 are CP2+.
```

## Explicit non-scope (CP1)

| ID | Requirement | Status |
| --- | --- | --- |
| S321A-NS-001 | No Prisma 7.10 / 8 upgrade. Keep 7.9.1. | `OUT_OF_SCOPE` |
| S321A-NS-002 | No Next / React / TypeScript / npm dependency upgrades. | `OUT_OF_SCOPE` |
| S321A-NS-003 | No PG per-test hang fix in CP1 (`analysis-operation.pg.test.ts`, `session-lifecycle-finalizer.pg.test.ts`). | `OUT_OF_SCOPE` |
| S321A-NS-004 | No schema / migration / ENV / product-runtime change. | `OUT_OF_SCOPE` |
| S321A-NS-005 | No commit, push, or deploy. | `OUT_OF_SCOPE` |
| S321A-NS-006 | No machine-global, Git-common-directory, or main-worktree lock. | `OUT_OF_SCOPE` |
| S321A-NS-007 | No image-name process kill (`taskkill /IM node.exe`, `pkill node`). | `OUT_OF_SCOPE` |

## Approved CP1 requirements

| ID | Requirement | Status |
| --- | --- | --- |
| S321A-K-001 | Public orchestrator + shared bounded-process primitive + worktree validation lock + guarded Prisma generate + heartbeat/process-tree diagnostics + owned-tree cleanup (Option C / Hybrid). | `APPROVED` |
| S321A-K-002 | Validation lock path is `<git-worktree-root>/.agent/validation.lock` with atomic exclusive create (`wx` or equivalent). | `APPROVED` |
| S321A-K-003 | Prisma generate lock path is `<git-worktree-root>/.agent/prisma-generate.lock` with the same atomic create rule. | `APPROVED` |
| S321A-K-004 | Stale-lock policy: live matching owner → `VALIDATION_ALREADY_RUNNING`; dead PID → recover; live ambiguous/PID-reuse → `VALIDATION_STALE_LOCK` without auto-delete (explicit `--force-stale-lock` only). | `APPROVED` |
| S321A-K-005 | `validate:deploy` acquires the validation lock once and runs internal FAST then BUILD. It must not shell out to the independently locking public `validate:fast` command. | `APPROVED` |
| S321A-K-006 | FAST = check:native-dialogs, lint, prisma validate, prisma generate, test:unit, test:e2e:list. BUILD = next build. DEPLOY = FAST then BUILD. `eval:registry:check` stays separate. | `APPROVED` |
| S321A-K-007 | Shared bounded process owns the exact root child PID, enforces wall-clock timeout, heartbeat, bounded tails, tree dump, graceful then force cleanup, verification, and deterministic outcome codes. A timeout must not abandon a running child. | `APPROVED` |
| S321A-K-008 | Whole-run budgets: FAST 15min, DEPLOY 25min. Effective step timeout cannot exceed remaining run budget. Timeout layer is `STEP_TIMEOUT` or `RUN_TIMEOUT`. | `APPROVED` |
| S321A-K-009 | Canonical `prisma:generate` and validation generate share guarded generation using the project-installed Prisma CLI (no npx download) plus generated-client integrity (`client.ts`, `enums.ts`, `internal/prismaNamespace.ts`, callable `Prisma.sql` / `Prisma.join`). Current CLI is Prisma 7.10.0 with `generate --no-hints`. | `APPROVED` |
| S321A-K-010 | Public `package.json` commands keep their names and route through the runner / guarded generate entry. Gate-contract tests check semantic composition, not old `&&` literals. | `APPROVED` |
| S321A-K-011 | Force cleanup of a previously snapshotted PID whose parent/root relationship is gone must revalidate identity (PID + start time, plus name/command-line when present). PID reuse must not kill the new process; record `PID_REUSED_OR_IDENTITY_CHANGED` and `CHILD_CLEANUP_FAILED` if owned cleanup cannot be completed safely. | `APPROVED` |
| S321A-K-012 | Operator SIGINT/SIGTERM cancels once: stop scheduling, dump/clean only the owned tree, release locks only when payload `runId` still matches, exit `VALIDATION_CANCELLED`. Repeat signals must not start a second cleanup. | `APPROVED` |

## Approved CP2 requirements

| ID | Requirement | Status |
| --- | --- | --- |
| S321A-CP2-001 | PG coordination tests cannot hang when a mutation/finalization rejects before the barrier, when the barrier times out, or when client cleanup fails. Waiters unblock via expected signal, upstream rejection, or bounded timeout. | `IMPLEMENTED` |
| S321A-CP2-003 | Canonical `test:unit` uses `--test-timeout=180000` before `--test`. This is a per-test bound. The validation-runner `test:unit` step watchdog remains 10 minutes. Runner `--import` of the unit bootstrap uses a `file://` URL so Windows worker children do not resolve `scripts` as a package. | `IMPLEMENTED` |
| S321A-CP2-004 | Test-only `pg.Client`/`pg.Pool` use `connectionTimeoutMillis=5000`, setup/cleanup `statement_timeout≈10s`, and locking clients may use `lock_timeout≈20s` only as a safety cap that still allows FOR UPDATE blocking. | `IMPLEMENTED` |

## Approved CP3 requirements

| ID | Requirement | Status |
| --- | --- | --- |
| S321A-CP2-002 | Exact Prisma trio upgrade 7.9.1 → 7.10.0 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`). No Prisma 8 / latest / other dependency upgrades. | `IMPLEMENTED` |
| S321A-CP3-001 | Guarded generate uses installed 7.10.0 CLI with `--no-hints` so Prisma 8 RC / agent-skills upgrade banners are not emitted. Integrity contract unchanged. | `IMPLEMENTED` |

## Toolchain matrix (CP3)

| Tool | Version | Notes |
| --- | --- | --- |
| prisma | 7.10.0 | Exact pin. Reason: stay on Prisma 7, pick up 7.10 generate `--no-hints` and current 7.x client. |
| @prisma/client | 7.10.0 | Exact pin. Generated client layout remains `client.ts` / `enums.ts` / `internal/prismaNamespace.ts`. |
| @prisma/adapter-pg | 7.10.0 | Exact pin. `PrismaPg` + `pg.Pool` initialization unchanged. |
| Prisma 8 RC | NOT_RECOMMENDED | Unhinted 7.10 generate advertised `8.0.0-rc.11` and `npm i prisma@latest`. Do not follow. |
| Next | 16.3.0 | Unchanged |
| React / React DOM | 19.2.4 | Unchanged |
| TypeScript | 5.9.3 | Unchanged |

Security audit after 7.10.0 is unchanged vs CP0 baseline:

- FULL: 13 findings (2 critical, 9 high, 2 moderate)
- PRODUCTION-ONLY: 3 high (`prisma` → `@prisma/config` → `deepmerge-ts@7.1.5`)
- 7.10.0 does not resolve `deepmerge-ts`. npm still proposes unsafe `prisma@6.12.0` downgrade. Do not apply `npm audit fix` / `--force`.

## Deferred after CP3

| ID | Requirement | Status |
| --- | --- | --- |
| S321A-CP4-001 | Full `validate:deploy` composition and smoke gates. | `IMPLEMENTED` |
| S321A-CP4-R1-001 | Windows timeout cleanup must not treat incomplete/timed-out process inspection as PID reuse. T07 remains `VALIDATION_TIMEOUT`. | `IMPLEMENTED` |
| S321A-SEC-001 | `deepmerge-ts` HIGH via Prisma CLI config remains open until Prisma ships a non-downgrade fix. Classified BUILD_ONLY / not Next request-runtime. | `DEFERRED` |

## Change Impact Analysis (CP4)

```
CHANGE: Canonicalize active deploy generate path to npm run prisma:generate;
        record accepted security classification; run final validate:deploy
        and applicable L4 smokes; fast-forward deploy/yandex-poc; production
        activate Prisma 7.10.0 + guarded generate.
INVARIANTS: No schema/migration/ENV; no other dependency updates; no product
            runtime semantics; migrate remains installed Prisma / existing
            production overlay; no npx prisma generate.
IMPACT: operations/deploy docs, architecture deploy model, testing generate
        instructions, package/lock already on 7.10.0 from CP3
UNITS: CU-generate-runbook, CU-final-gates, CU-production-activate
KERNEL: guarded production generate + lock/cancel already proven
EVAL: EVAL-WF-NESTED-DEPLOY-FAST, EVAL-WF-PRISMA-GENERATE-GUARD,
      EVAL-WF-OPERATOR-CANCEL-CLEANUP
STRATEGY: A
VALIDATION_PLAN: L1 tooling+PG+eval+lint+diff-check; one validate:deploy;
                 applicable L4 smokes; independent high-risk review.
```

## Change Impact Analysis (CP4-R1)

```
CHANGE: Correct Windows owned-tree presence classification so incomplete
        WMI snapshots and inspect-timeout exit races are not treated as
        PID reuse / false CHILD_CLEANUP_FAILED. Recheck liveness after
        inspect. Keep proven start-time reuse refusal.
INVARIANTS: No image-name kill; no PID-identity weakening; no Prisma/
            dependency/schema/ENV/product change; T07 still requires
            VALIDATION_TIMEOUT; T21 still refuses reused PIDs.
IMPACT: validation-runner process-tree, T23, eval/docs
UNITS: CU-cleanup-presence
KERNEL: classifyProcessPresence + inspect liveness recheck
EVAL: EVAL-WF-CLEANUP-INSPECT-RACE, EVAL-WF-STEP-TIMEOUT-KILLS-TREE,
      EVAL-WF-PID-IDENTITY-FORCE-KILL
STRATEGY: A
VALIDATION_PLAN: L1 T07/T09/T10/T21/T22/T23 + runner file + one
                 canonical test:unit. validate:fast / validate:deploy
                 NOT_RUN.
```

## Change Impact Analysis (CP2)

```
CHANGE: Harden analysis-operation and session-lifecycle-finalizer PG
        coordination tests with a bounded resolve/reject/timeout primitive,
        guaranteed client cleanup, test-only DB timeouts, and a 180s
        canonical per-test timeout. First real validate:fast through the
        CP1 kernel.
INVARIANTS: Product runtime unchanged; locking/serialization assertions
            preserved; Prisma 7.9.1 unchanged; no schema/migration/ENV;
            no validate:deploy; runner step watchdogs unchanged.
IMPACT: tests/evals, package.json test:unit metadata, testing docs
UNITS: CU-pg-coordination, CU-pg-cleanup, CU-unit-timeout, CU-evals-docs
KERNEL: CU-pg-coordination (mutation/finalization waiter unblock)
EVAL: EVAL-WF-PG-LOCK-TEST-NO-HANG
STRATEGY: A
VALIDATION_PLAN: L1 PG01-PG08 helper + isolated real PG files, then L3
                 validate:fast once. validate:deploy / L4 NOT_RUN.
```

## Change Impact Analysis (CP3)

```
CHANGE: Exact Prisma 7.9.1 → 7.10.0 trio upgrade, guarded generate
        --no-hints, Windows file-URL conversion regression coverage.
INVARIANTS: No Prisma 8; no other direct deps; no schema/migration/ENV;
            generated-client integrity unchanged; product runtime
            unchanged; validate:deploy deferred to CP4.
IMPACT: package.json / package-lock Prisma graph, generated client
        refresh, testing docs / toolchain matrix
UNITS: CU-prisma-710, CU-no-hints, CU-windows-import-regression
KERNEL: CU-prisma-710 generated-client compatibility
EVAL: EVAL-WF-PRISMA-GENERATE-GUARD
STRATEGY: A
VALIDATION_PLAN: L1 focused PG + Prisma helper tests, then one
                 validate:fast and one validate:build. validate:deploy
                 NOT_RUN.
```
