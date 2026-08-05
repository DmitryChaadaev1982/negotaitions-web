# Stage 3.13C-R Security Remediation Matrix

Independent review result entering this work:
`STAGE_3_13C_INDEPENDENT_REVIEW_BLOCKED_BY_HIGH_FINDINGS`
(Critical 0 / High 3 / Medium 9 / Low 9 / Informational 3).

This document maps every High and Medium finding to the remediation shipped on
`feat/stage-3-13c-account-security-email`.

## High findings

| ID | Root cause | Fix | Primary files | Tests | Residual risk | Activation |
|----|------------|-----|---------------|-------|---------------|------------|
| H-01 | Login / authenticated password-change verified the old hash outside a CAS bound to reset | `User.credentialGeneration` incremented on every password mutation; login and password-change capture generation at verify and only commit session/update when unchanged | `prisma/schema.prisma`, migration `20260805140000_stage_3_13c_security_remediation`, `lib/auth/credential-concurrency.ts`, `lib/auth/session.ts`, `lib/auth/account-security.ts`, `app/actions/auth.ts`, `app/actions/account.ts` | `lib/auth/credential-concurrency.remediation.test.ts`, `verify:stage313c:remediation` race cases | Extremely narrow race still requires process crash between CAS check and cookie write; no durable session row is created on stale generation | Code complete; no production deploy |
| H-02 | Reset URL rendered before enqueue; raw token persisted in `renderedTextBody` / `renderedHtmlBody` | Authenticated AES-256-GCM sensitive payload (`EMAIL_SENSITIVE_PAYLOAD_KEY`); bodies deferred until worker late-render; ciphertext cleared after accept/cancel | `lib/email/sensitive-payload.ts`, `lib/email/account-security.ts`, `lib/email/outbox.ts`, `lib/email/worker.ts`, schema columns | `lib/email/sensitive-payload.test.ts`, remediation + account-email verify scripts | Key compromise or memory dump during send window can expose one active token | Key must be installed in production separately; delivery still disabled |
| H-03 | `GET /reset-password?token=` put raw token in request URI / logs / history | Generated links use `#token=`; client reads fragment, stores ephemeral state, `history.replaceState` scrub; query-token links rejected | `lib/email/sensitive-payload.ts` (`buildPasswordResetActionUrl`), `app/(auth)/reset-password/page.tsx`, `components/reset-password-form.tsx` | Playwright account-email e2e, verify fragment delivery | Users who already received old query links must request a new reset | No nginx/log change required for fragment form |

## Medium activation blockers

| ID | Status | Fix summary | Tests | Activation impact |
|----|--------|-------------|-------|-------------------|
| M-01 | Fixed | Bounded forgot-password response floor (`PASSWORD_RESET_RESPONSE_FLOOR_MS`, default 180 ms) with injectable sleeper | `lib/auth/response-timing-floor.test.ts` | Perfect network timing equality remains impossible (documented) |
| M-02 | Fixed | Token syntax → hash → cheap eligibility → bcrypt → atomic claim; finalize consume limiter | remediation verify `bcryptInvocationsForInvalidTokens=0` | Reduces Amplification before claim |
| M-03 | Fixed | `relatedTokenId` + pre-dispatch eligibility; cancel to `CANCELLED` with sanitized reason; backlog quarantine helper | remediation verify stale cancel | Must quarantine backlog before Postbox enable |
| M-04 | Fixed | Exact allowlist: production `https://negotaitions.ru` only; non-prod also `https://local.negotaitions.ru` | `lib/email/canonical-origin.test.ts` | Misconfigured prod origin fails closed |
| M-05 | Fixed | GET `q` rejects `@`; private same-origin `POST /api/admin/email-journal/search` | admin-journal unit tests + UI component | Removes full address from URL/history/access logs |
| M-06 | Fixed | Read-time retention on reveal; sensitive payload cleanup; expired token cleanup; `recipientEmailNormalized` minimization; terminal set broadened | remediation retention assertions | Schedule retention timer before long-lived production retention SLAs |
| M-07 | Fixed | `PASSWORD_RESET` reveal always denied with fixed reason; no regex dependency | journal e2e + unit constant | Journal metadata still visible |
| M-08 | Fixed (docs/scripts only) | Committed trusted-proxy activation verifier; live checks require explicit `TARGET_HOST`; no auto prod change | `verify:stage313c:trusted-proxy` | Production nginx still unchanged |
| M-09 | Fixed (docs/templates only) | Disabled-by-default systemd worker/retention units; canary via `onlyMessageId` / `leaseRecoveryOnly`; backlog quarantine | worker options + systemd templates | Postbox remains disabled |

## Low findings (tightly coupled only)

- One-character recipient masking tightened.
- Production fail-closed when `AUTH_SECRET` absent for trusted client identity.
- Expired token cleanup included in retention.
- Overlay list includes remediation migration.

## Commands

```powershell
npm run test:stage313c:remediation
npm run verify:stage313c:remediation
npm run verify:stage313c:trusted-proxy
```

## Decision target

Ship remediation on the existing branch without production activation.
Final gate verdict is recorded in the completion report.
