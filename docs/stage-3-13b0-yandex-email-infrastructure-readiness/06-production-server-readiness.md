# Production Server Readiness

Server: `130.193.62.91`
SSH user: `deploy`
Application path: `/var/www/negotaitions/app`
Service: `negotaitions-poc`

## Live Inspection Result

All B0 SSH checks timed out on port 22:

- `ssh deploy@130.193.62.91 "hostname"`
- `ssh deploy@130.193.62.91 "node --version"`
- `ssh deploy@130.193.62.91 "npm --version"`
- `ssh deploy@130.193.62.91 "systemctl is-active negotaitions-poc"`
- `ssh deploy@130.193.62.91 "systemctl show negotaitions-poc -p User -p Group -p WorkingDirectory -p ExecStart -p EnvironmentFiles"`
- `ssh deploy@130.193.62.91 "systemctl list-timers --all --no-pager"`
- `ssh deploy@130.193.62.91 "systemctl list-units --type=service --no-pager"`
- Postbox DNS/TCP/TLS checks from the VM.

Evidence source: PRODUCTION SERVER blocked.

## Repository Evidence

| Topic | Evidence | Source |
| --- | --- | --- |
| Runtime path | Docs list `/var/www/negotaitions/app-git` as canonical source and `/var/www/negotaitions/app` as runtime symlink. | REPOSITORY |
| Service | Docs list `negotaitions-poc`. | REPOSITORY |
| Reverse proxy | Docs state nginx in front of Node/Next app. | REPOSITORY |
| Secret handling | `.env.production` is runtime secret material and must never be committed. | REPOSITORY |
| Systemd worker precedent | Stage 3.10 maintenance uses oneshot service/timer, `www-data`, journal output, bounded execution, idempotent DB claims. | REPOSITORY |
| Current email worker | No email worker/outbox exists. | REPOSITORY |

## Future Worker Recommendation

Use a separate email worker service or timer, not inline HTTP delivery.

| Decision | Recommendation | Evidence source |
| --- | --- | --- |
| Process boundary | Separate `negotaitions-email-worker` service/timer from `negotaitions-poc`. | INFERENCE |
| OS user | Prefer same least-privilege runtime user convention only after confirming existing service user; repository Stage 3.10 template uses `www-data`. | REPOSITORY, NOT VERIFIED |
| Working directory | `/var/www/negotaitions/app` if production layout is confirmed. | REPOSITORY, PRODUCTION SERVER blocked |
| Logs | Separate journald unit name for email sends/retries; avoid full message bodies, tokens, transcripts, AI JSON, and raw provider secrets. | INFERENCE |
| Cleanup | Use a dedicated email retention cleanup task, not Stage 3.10 recording maintenance. | INFERENCE |
| Scheduling | Timer is acceptable for low volume; dedicated long-running worker may be better once reminder/result volume grows. | INFERENCE |

## Required Server Checks Before Real Email

Run only read-only or connectivity-only commands:

```bash
hostname
node --version
npm --version
systemctl is-active negotaitions-poc
systemctl show negotaitions-poc -p User -p Group -p WorkingDirectory -p ExecStart -p EnvironmentFiles
systemctl list-timers --all --no-pager
systemctl list-units --type=service --no-pager
getent hosts postbox.cloud.yandex.net
timeout 5 bash -lc '</dev/tcp/postbox.cloud.yandex.net/443' && echo tcp443=ok || echo tcp443=fail
timeout 5 bash -lc '</dev/tcp/postbox.cloud.yandex.net/587' && echo tcp587=ok || echo tcp587=fail
timeout 5 bash -lc '</dev/tcp/postbox.cloud.yandex.net/465' && echo tcp465=ok || echo tcp465=fail
timeout 8 openssl s_client -connect postbox.cloud.yandex.net:465 -servername postbox.cloud.yandex.net -brief </dev/null
```

Do not run `systemctl cat`, do not print environment files, and do not print secret values.

## Connectivity Preference

| Transport | Operational assessment |
| --- | --- |
| HTTPS API on 443 | Preferred if IAM-token sending is used. Easier firewall posture, short-lived credentials, structured responses. |
| SMTP 587/465 | Supported by Postbox; useful compatibility path. Requires careful credential/token refresh and TLS checks. |
| Self-hosted SMTP | Rejected by default due to deliverability, reputation, rDNS, abuse, and operational burden. |

## Manual Status

| Requirement | Status | Evidence source |
| --- | --- | --- |
| Service runs under dedicated OS user | NOT VERIFIED | PRODUCTION SERVER blocked |
| Existing systemd timers | NOT VERIFIED live; repo has template precedent | PRODUCTION SERVER blocked, REPOSITORY |
| Outbound HTTPS to Postbox | NOT VERIFIED | PRODUCTION SERVER blocked |
| Outbound SMTP 587/465 to Postbox | NOT VERIFIED | PRODUCTION SERVER blocked |
| VM attached service account | NOT VERIFIED | YANDEX CLOUD CLI blocked, PRODUCTION SERVER blocked |
| Lockbox/IAM-token access path | NOT VERIFIED | YANDEX CLOUD CLI blocked, PRODUCTION SERVER blocked |
| Log separation | PARTIALLY READY by design | REPOSITORY, INFERENCE |
