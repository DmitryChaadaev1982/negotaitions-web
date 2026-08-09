# Stage 3.13C-R / R2 Security Remediation Matrix

Independent review result entering the original remediation:
`STAGE_3_13C_INDEPENDENT_REVIEW_BLOCKED_BY_HIGH_FINDINGS`
(Critical 0 / High 3 / Medium 9 / Low 9 / Informational 3).

Independent re-review after Stage 3.13C-R:
`STAGE_3_13C_HIGH_REMEDIATION_REVIEW_BLOCKED_BY_HIGH_FINDINGS`

This document maps High and Medium findings to remediations on
`feat/stage-3-13c-account-security-email`.

## Stage 3.13C-R2 high remediations

| ID | Root cause | Fix | Primary files | Tests | Residual risk | Activation |
|----|------------|-----|---------------|-------|---------------|------------|
| H-01R | Generation check and `UserSession` insert were not linearized; reset could commit between a non-locking read and insert | `SELECT ... FOR UPDATE` on `User` inside the session-create transaction; cookie issued only after commit; password mutations lock the same row | `lib/auth/user-row-lock.ts`, `lib/auth/session.ts`, `lib/auth/account-security.ts`, `app/actions/account.ts`, `lib/auth/credential-concurrency.ts` | `verify:stage313c:high-remediation-r2` H-01R A/B, rollback, concurrent logins | Mixed old/new runtime remains unsafe; cookie write after commit can still leave an orphan row if the process dies mid-cookie | Code complete; no production deploy |
| H-02R | AES-GCM ciphertext was not bound to message/token/user/recipient/generation; ciphertext transplant could decrypt under another row | Versioned canonical JSON AAD; preallocated `EmailMessage.id`; post-decrypt field checks; timing-safe raw-token hash vs `PasswordResetToken` | `lib/email/sensitive-payload.ts`, `lib/email/account-security.ts`, `lib/email/outbox.ts`, `lib/email/worker.ts` | unit AAD/swap tests; R2 verifier ciphertext and `relatedTokenId` swaps | Key compromise still exposes active tokens; no automatic key rotation in R2 | Key must be installed separately; delivery still disabled |
| M-03R | Eligibility could become stale between evaluation and `provider.send` | Session advisory lock fence shared by worker dispatch and credential mutations; revalidation under fence before send | `lib/auth/credential-dispatch-fence.ts`, `lib/email/worker.ts`, `lib/auth/account-security.ts`, `app/actions/account.ts` | R2 verifier M-03R A/B, blocked/expired, provider throw releases fence | Fence held for bounded provider timeout; worker death releases via connection close | Must quarantine backlog before Postbox enable |

## Stage 3.13C-F final remediations

- Every production `UserSession` creator now requires
  `expectedCredentialGeneration`. Registration uses the committed user row's
  generation, and both pending and bootstrap-admin registration follow the same
  locked insertion/cookie-after-commit boundary.
- Password-reset dispatch derives the provider recipient only from a canonical
  value that matches the AAD-authenticated normalized recipient. Replacing
  either durable field cannot redirect delivery.
- New-token supersession, token consumption, authenticated password change,
  and administrator BLOCKED/REJECTED transitions use the same fence before
  transaction/User/token/session/message mutation.
- Fence acquisition uses bounded `pg_try_advisory_lock` retries (default 5 s);
  invalid configuration, timeout, and abort fail closed.
- Reset fragments are fully scrubbed before parsing. Sensitive
  `ACCEPTANCE_UNKNOWN` messages clear recoverable payload immediately.
- Isolated one-message canary and dry-run-by-default bounded backlog quarantine
  commands are committed. No service or timer is enabled.
- Current automated PostgreSQL provider-event and advisory-lock checks use the
  canonical `E2E_DATABASE_URL` database on `localhost:5433/negotiations_e2e`.
  The retired `STAGE313C_TEST_DATABASE_URL` verifier-schema flow must not be
  used for routine local validation.

## Stage 3.13C-H nonblocking hardening

Entering review result:
`STAGE_3_13C_FINAL_INDEPENDENT_REVIEW_PASS_WITH_OPERATIONAL_RESIDUALS`
(Critical 0 / High 0 / Medium 0 / Low 5 / Informational 5; no merge or
activation blockers). This round changes no reviewed security invariant.

| ID | Change | Primary files | Tests |
|----|--------|---------------|-------|
| F-01 | nginx trusted-proxy gate is a numbered activation step between backlog quarantine and Postbox configuration/canary | `docs/operations/email-yandex-activation-runbook.md`, `docs/operations/deployment-runbook.md` | documentation only |
| F-02 | Documented the eligibility-enabling admin transition invariant (approve/unblock/make-admin need no fence because they cannot revive an invalidated token or message) | `lib/auth/admin-account-status.ts`, `docs/architecture/account-security-email-flows.md` | `eligibility_enabling_transition_cannot_revive_reset` in `verify:stage313c:final-remediation` |
| F-03 | Transient authenticated password-change and reset failures map to retry messages; only `CredentialDispatchFenceError` and Prisma `P2028` are transient | `lib/auth/account-security-error-messages.ts`, `app/actions/account.ts`, `app/actions/password-reset.ts`, `lib/i18n/dictionaries/{en,ru}.ts` | `lib/auth/account-security-error-messages.test.ts` |
| F-04 | Schema extraction tolerates a libpq keyword/value DSN instead of failing on `new URL()` | `lib/prisma-connection-string.ts`, `lib/prisma.ts` | `lib/prisma-connection-string.test.ts` |
| F-05 | Integration verifier deletes only run-owned `ExternalServiceEvent` rows and asserts the surviving set equals its baseline | `scripts/verify-stage-3-13c-account-email.ts` | `verify:stage313c:integration` |
| F-06 | Credential-concurrency and dispatch-fence test-hook setters refuse installation when `NODE_ENV=production`, matching the session hook | `lib/auth/credential-concurrency.ts`, `lib/auth/credential-dispatch-fence.ts` | `lib/auth/test-hook-production-guard.test.ts` |
| F-07 | Documented the direct/session-affinity PostgreSQL connection requirement and connection headroom for the fence | `docs/operations/deployment-runbook.md`, `docs/architecture/account-security-email-flows.md` | documentation only |
| F-08 | Deferred sensitive rendering rejects any token-shaped rendered subject or body; the ineffective `actionUrl` conjunct is gone | `lib/email/rendered-content-guards.ts`, `lib/email/outbox.ts` | `lib/email/final-remediation.test.ts` |
| F-10 | Documented why `EmailMessage.relatedTokenId` intentionally has no foreign key | `prisma/schema.prisma` (comment only), `docs/architecture/account-security-email-flows.md` | existing `TOKEN_MISSING` / quarantine coverage |

F-09 (source-text session API audit) stays informational: no type-level or
AST-based assertion is available in the repository, and no parser dependency was
added for it.

## Earlier Stage 3.13C-R high findings (still in force)

| ID | Root cause | Fix | Primary files | Tests | Residual risk | Activation |
|----|------------|-----|---------------|-------|---------------|------------|
| H-01 | Login / authenticated password-change verified the old hash outside a CAS bound to reset | `User.credentialGeneration` incremented on every password mutation; login and password-change capture generation at verify | schema + credential concurrency helpers | remediation unit + verify | Superseded linearization details by H-01R | Code complete; no production deploy |
| H-02 | Reset URL rendered before enqueue; raw token persisted in bodies | AES-256-GCM sensitive payload; deferred bodies | sensitive-payload + worker late-render | sensitive-payload tests + remediation verify | Strengthened by H-02R AAD binding | Key must be installed separately |
| H-03 | `GET /reset-password?token=` put raw token in request URI | Fragment-only links + client scrub | reset-password UI + URL builder | Playwright + verify | Users with old query links must re-request | No nginx/log change required |

## Medium activation blockers

| ID | Status | Fix summary | Tests | Activation impact |
|----|--------|-------------|-------|-------------------|
| M-01 | Fixed | Bounded forgot-password response floor | response-timing-floor tests | Perfect network timing equality remains impossible |
| M-02 | Fixed | Token syntax → hash → eligibility → bcrypt → atomic claim | remediation verify bcrypt gate | Reduces amplification before claim |
| M-03 | Fixed (R1) / strengthened (R2 as M-03R) | Eligibility + cancel; R2 adds dispatch fence | remediation + R2 verify | Must quarantine backlog before Postbox enable |
| M-04 | Fixed | Exact canonical origin allowlist | canonical-origin tests | Misconfigured prod origin fails closed |
| M-05 | Fixed | GET `q` rejects `@`; private POST search | admin-journal tests | Removes full address from URL/history |
| M-06 | Fixed | Retention + sensitive payload cleanup | remediation retention | Schedule retention before long-lived SLAs |
| M-07 | Fixed | `PASSWORD_RESET` reveal always denied | journal e2e + unit | Journal metadata still visible |
| M-08 | Fixed (docs/scripts only) | Trusted-proxy activation verifier | `verify:stage313c:trusted-proxy` | Production nginx still unchanged |
| M-09 | Fixed (docs/templates only) | Disabled-by-default systemd units; canary options | worker options + templates | Postbox remains disabled |

## Sensitive payload cryptographic format (H-02R)

- Algorithm: AES-256-GCM, 12-byte random nonce, 16-byte tag appended to ciphertext.
- Key: `EMAIL_SENSITIVE_PAYLOAD_KEY` (canonical base64, exactly 32 bytes). No key in Git.
- AAD: canonical JSON with fixed field order:
  `v`, `purpose=PASSWORD_RESET`, `messageId`, `tokenId`, `userId`,
  `credentialGeneration`, `recipientNormalized`, `payloadKind`.
- Plaintext also carries `userId` / `tokenId` / `credentialGeneration` for
  post-decrypt checks.
- After GCM auth: re-validate fields, hash raw token with the same SHA-256
  function used for reset consumption, timing-safe compare to the associated
  `PasswordResetToken` row.
- Key rotation: single active key; automatic rotation is out of R2 scope.
- Copied ciphertext/nonce between messages fails AAD before `provider.send`.

## Rolling deployment

A mixed old/new runtime is not considered safe for account-security activation.
Do not attempt a rolling mixed-version deployment of session creation and
password-reset paths. Stop every old application and worker process before the
new runtime starts. Apply migrations before that start, and install
`EMAIL_SENSITIVE_PAYLOAD_KEY` before accepting ACTIVE password-reset requests.

Once real reset traffic uses the remediated encrypted/fenced schema, reverting
to pre-remediation code is not a normal safe rollback. Disable delivery, set
`TRUSTED_PROXY_ENABLED=false` when proxy trust is implicated, keep old
processes stopped, and forward-fix on the additive schema.

## Commands

```powershell
npm run test:e2e:db:check
npm run test:stage313c:provider-events
npm run test:stage313c:high-remediation-r2
npm run test:stage313c:remediation
npm run test:stage313c:final-remediation
```

## Decision target

Ship R2 remediation on the existing branch without production activation.
Final gate verdict is recorded in the completion report.
