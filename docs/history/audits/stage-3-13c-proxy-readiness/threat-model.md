# Threat Model

## Spoofing before Stage 3.13C-P

**Yes — spoofing was possible for process-local IP rate limits.**

A client could vary:

- `X-Forwarded-For`
- `X-Real-IP`
- and other common forwarding headers

and create a new process-local IP identity for password-reset requests.

## What was not broken by spoofing

- Durable per-account cooldown/hourly limits for known users
- Public anti-enumeration response body/status for successful same-origin requests
- Hash-only reset tokens
- Fake/provider delivery semantics

## Additional risks addressed

- Same-origin candidates from `X-Forwarded-Host` / `X-Forwarded-Proto` without proxy trust
- Next.js listening on all interfaces (mitigated by UFW today; bind hardened for future deploys)
- Appended `X-Forwarded-For` chains on nginx (`$proxy_add_x_forwarded_for`)

## Residual risks

- Process-local IP limiter is not distributed across multiple app instances
- Split-DNS/VPN traffic that traverses two nginx hops collapses to the final hop `$remote_addr` under the dedicated-header overwrite model (by design)
- Provider-event statuses (`DELIVERED`/`BOUNCED`/`COMPLAINED`) are not yet ingested
