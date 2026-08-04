# Yandex Email Readiness

All checks in Stage 3.13B were read-only. No Yandex resources, DNS records, mailboxes, senders, service accounts, IAM roles, billing settings, or credentials were created or changed.

## Evidence

- Local `yc` CLI was not available from this worktree shell, so cloud-side inventory is `UNKNOWN`.
- Public DNS lookup through `1.1.1.1` returned nameservers `ns1.yandexcloud.net` and `ns2.yandexcloud.net`.
- Public DNS lookup did not return MX, SPF, DKIM, or DMARC TXT answers from the queried resolver; the resolver returned SOA authority data for those no-answer cases.
- User-provided Yandex Cloud DNS screenshot shows current zone records:
  - `negotaitions.ru` A `130.193.62.91`
  - `app.negotaitions.ru` A `130.193.62.91`
  - `local.negotaitions.ru` A `91.149.255.127`
  - `negotaitions.ru` NS `ns1.yandexcloud.net`, `ns2.yandexcloud.net`
  - `negotaitions.ru` SOA
  - `www.negotaitions.ru` CNAME `negotaitions.ru`
  - No MX/TXT mail records visible in the screenshot.
- A non-interactive SSH probe to the production IP did not complete before interruption, so server-side systemd/cron/outbound checks remain `UNKNOWN`.

## Readiness Matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Yandex Cloud DNS access | UNKNOWN | `yc` CLI unavailable locally; screenshot provided by owner. |
| Current DNS cleanliness | READY | Existing public/screenshot records show web A/CNAME/NS/SOA and no visible conflicting mail records. |
| MX | NOT_CONFIGURED | No public MX answer and none visible in screenshot. |
| SPF | NOT_CONFIGURED | No public SPF TXT answer and none visible in screenshot. |
| DKIM | NOT_CONFIGURED | No public DKIM selector evidence and none visible in screenshot. |
| DMARC | NOT_CONFIGURED | `_dmarc.negotaitions.ru` returned no TXT answer. |
| Yandex 360 | NOT_CONFIGURED | Product decision says organization has not been created. |
| Postbox availability | UNKNOWN | Official docs confirm service and SES-compatible API, but cloud inventory was not accessible. |
| Postbox sender identity | NOT_CONFIGURED | Expected current state; no sender was created. |
| Postbox quota | UNKNOWN | Requires authenticated cloud quota view. |
| Billing | UNKNOWN | Requires authenticated cloud billing/quota view. |
| IAM | NOT_CONFIGURED | No service account or roles created in this stage. |
| Secret storage | UNKNOWN | Production secret-storage pattern could not be verified read-only. |
| Provider events | NOT_CONFIGURED | Official docs require configuration set plus Data Streams/EventRouter-style pipeline. |
| Worker/systemd readiness | UNKNOWN | Production server read-only SSH inventory not completed. |
| Production outbound connectivity | UNKNOWN | Not tested to avoid production side effects. |
| Owner mailbox plan | READY | Human-operated Dmitry mailbox/aliases plan documented; Yandex 360 setup deferred. |

## Official Documentation Findings

Yandex 360 custom domain mail requires MX `mx.yandex.net`, SPF composition, and DKIM generated from the admin portal. If the domain is delegated to Yandex, mail DNS can be automated by Yandex 360, but this domain is managed in Yandex Cloud DNS, so records should be composed and applied deliberately.

Yandex Cloud Postbox supports SMTP and an AWS SES-compatible API. The chosen application transport is API-first via SES v2 compatible adapter. Event notifications are delivered at least once and include event ids, so ingestion must be idempotent.

## Read-only Commands for Owner

```shell
yc config get cloud-id
yc config get folder-id
yc dns zone list --format json
yc dns zone list-records --name <zone-name> --format json
yc quota-manager quota-limit list --service postbox --format json
```

Do not include `--debug`, token output, or credential values in shared logs.
