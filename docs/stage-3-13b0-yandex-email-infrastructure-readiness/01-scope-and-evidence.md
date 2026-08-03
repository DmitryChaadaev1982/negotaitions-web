# Scope and Evidence Ledger

## Scope

This audit determines readiness for a future email architecture:

- Yandex 360 for inbound human mailboxes, aliases, groups, and operator access.
- Yandex Cloud Postbox for automated application email delivery.
- Yandex Cloud DNS for mail and verification records.
- Yandex Lockbox for persistent provider credentials only when unavoidable.
- NegotAItions PostgreSQL outbox for durable message creation.
- Dedicated worker/systemd service or timer for asynchronous delivery.

No infrastructure was created or changed.

## Confirmed Non-Actions

| Boundary | Result |
| --- | --- |
| DNS records | Not modified |
| Yandex 360 organization | Not created |
| Domain connection/verification | Not attempted |
| Yandex Cloud Postbox resources | Not created |
| IAM roles, service accounts, keys | Not created or changed |
| Lockbox secrets/payloads | Not created; payloads not read |
| Production server configuration | Not changed |
| Runtime application code | Not changed |
| Prisma schema/migrations | Not changed |
| Deployment/merge | Not performed |

## Evidence Classes

| Source label | Meaning |
| --- | --- |
| REPOSITORY | Files in this repository/worktree only. Useful for implementation planning, not proof of live cloud state. |
| PUBLIC DNS | Read-only DNS queries from the local machine and public recursive resolvers. |
| YANDEX CLOUD CLI | Intended read-only `yc` inspection. Blocked because `yc` is unavailable in this shell. |
| PRODUCTION SERVER | Intended read-only SSH inspection. Blocked because SSH timed out. |
| OFFICIAL DOCUMENTATION | Current official Yandex/Yandex Cloud documentation fetched on 2026-08-04. |
| USER DECISION | Product/operator decisions provided in the B0 prompt. |
| INFERENCE | Recommendation derived from evidence and engineering judgment. |
| NOT VERIFIED | Required check not completed in B0. |

## Repository Evidence Reviewed

| File | Evidence | Source |
| --- | --- | --- |
| `docs/stage-3-13a-email-communication-audit/README.md` | Stage 3.13A includes the follow-up findings from `845064a`: Postbox/Yandex 360 direction, no current sender/outbox/templates, password reset/invite gaps, provider DNS plan, worker/outbox recommendation, legal/contact placeholders. | REPOSITORY |
| `package.json` | No docs-only validation command exists; runtime/test commands include lint, build, Prisma, unit, and E2E suites that B0 intentionally does not run. | REPOSITORY |
| `.env.example` | Sanitized placeholders only; existing runtime secrets are environment-based and include Yandex/S3/API-key style variables. No email provider variables exist. | REPOSITORY |
| `docs/operations/deployment-runbook.md` | Production model: `/var/www/negotaitions/app-git`, `/var/www/negotaitions/app`, `negotaitions-poc`, nginx, `.env.production` outside git. | REPOSITORY |
| `docs/operations/server-operations.md` | Domain topology lists `negotaitions.ru`, `app.negotaitions.ru`, `local.negotaitions.ru`; runtime secrets stay outside git. | REPOSITORY |
| `docs/operations/stage-3-10-maintenance-runbook.md` | Existing maintenance sweeps are timer-friendly, idempotent, and no-secret-output. Useful pattern for future email worker. | REPOSITORY |
| `deploy/systemd/negotiations-stage310-maintenance.service` | Existing oneshot service runs as `www-data` in `/var/www/negotaitions/app` and logs to journal. | REPOSITORY |
| `deploy/systemd/negotiations-stage310-maintenance.timer` | Existing one-minute timer pattern with randomized delay and persistent execution. | REPOSITORY |
| `app/privacy/page.tsx`, `app/terms/page.tsx` | Legal/operator/contact details remain placeholders; privacy page says email is currently only for identification and no marketing communications are sent. | REPOSITORY |
| `lib/invite-email.ts` | Current invite email helper only normalizes/validates addresses; it does not send email. | REPOSITORY |

## Live Evidence Commands

| Area | Command category | Result | Source |
| --- | --- | --- | --- |
| Git preflight | `git fetch`, SHA check, worktree add | Source short SHA matched `845064a`; clean worktree created. | REPOSITORY |
| Public DNS | `Resolve-DnsName` against default resolver, `1.1.1.1`, `8.8.8.8` | NS/SOA and mail-record absence captured; wildcard/private A response found. | PUBLIC DNS |
| Authoritative DNS direct | `Resolve-DnsName -Server ns1/ns2.yandexcloud.net` | Timed out from local network. | PUBLIC DNS blocked |
| Yandex CLI | `Get-Command yc`, `yc version`, read-only list commands | `yc` not found; live cloud inspection stopped. | YANDEX CLOUD CLI blocked |
| Production SSH | Allowed `ssh deploy@130.193.62.91` metadata/connectivity commands | Port 22 timed out; live server inspection stopped. | PRODUCTION SERVER blocked |

## Unverified Assumptions

- The public Yandex Cloud DNS zone is in the same folder/cloud as the production VM.
- The production VM has an attached Yandex Cloud service account.
- Postbox is enabled/available in the production cloud and folder.
- The billing account is active and allows Postbox/Yandex 360 usage.
- Existing Yandex Cloud IAM policies can support least-privilege `postbox.sender`, viewer, Data Streams, Monitoring, and Lockbox access.
- The production VM can reach `postbox.cloud.yandex.net` over HTTPS and SMTP ports.
- Yandex 360 plan/tariff selection will support the selected mailbox/alias/shared-mailbox model.
