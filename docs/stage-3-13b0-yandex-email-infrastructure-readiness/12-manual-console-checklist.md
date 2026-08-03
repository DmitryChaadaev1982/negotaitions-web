# Manual Console and Read-Only Verification Checklist

Use this checklist because `yc` was not available locally and SSH to the production VM timed out in B0. Do not paste credentials, tokens, key values, or complete env files into chat or docs.

## Yandex Cloud CLI/Console

| Check | Safe method | Record |
| --- | --- | --- |
| Install/availability | `yc version` after installing locally, or console-only if CLI unavailable | CLI version or console path used |
| Current cloud/folder IDs | `yc config get cloud-id`, `yc config get folder-id`; never `yc config get token` | Redacted cloud/folder IDs |
| Folders | `yc resource-manager folder list` | Candidate production folder |
| DNS zones | `yc dns zone list` | Zone name/ID for `negotaitions.ru` |
| DNS zone details | `yc dns zone get <ZONE>` | Public/private, zone suffix, labels |
| DNS records | `yc dns zone list-records <ZONE>` | Current records; redact sensitive verification tokens |
| Postbox visibility | Console: target folder -> Cloud Postbox | Service visible? |
| Postbox identities | Console or read-only list if CLI supports it | Address/domain identities and verification status |
| Postbox quotas | Console Quota Manager / Postbox quotas | Current quota, usage, ability to request increase |
| Billing | Billing console | Active billing status; no payment details in docs |
| Service accounts | `yc iam service-account list` | Existing accounts that could be reused |
| Service account roles | IAM access bindings read-only | Whether least-privilege reuse is possible |
| Lockbox metadata | `yc lockbox secret list` | Secret names/metadata only; no payloads |
| Compute VM | `yc compute instance list` and read-only instance detail | VM name, folder, network, attached service account ID if any |
| Audit Trails | Console Audit Trails | Existing trail destination and retention |
| Monitoring | Console Monitoring metrics | Whether Postbox metrics are visible after future test |
| Data Streams | Console Data Streams/YDB | Existing stream suitability or need for new stream |

## Yandex 360 Owner Setup

Do not perform in B0. Owner manual steps:

1. Select/administer the Yandex account that will own the organization.
2. Create Yandex 360 organization.
3. Select tariff.
4. Connect `negotaitions.ru`.
5. Verify domain ownership.
6. Configure MX, SPF, and DKIM through Yandex Cloud DNS.
7. Create the owner mailbox.
8. Add `support@`, `security@`, `business@` aliases or mailboxes per final model.
9. Configure recovery contacts.
10. Enable MFA/login verification where available.
11. Test web, desktop, and mobile receiving/reply-from behavior.
12. Document admin break-glass and delegation policy.

## Production Server

Run only read-only/connectivity commands:

```bash
ssh deploy@130.193.62.91 "hostname"
ssh deploy@130.193.62.91 "node --version"
ssh deploy@130.193.62.91 "npm --version"
ssh deploy@130.193.62.91 "systemctl is-active negotaitions-poc"
ssh deploy@130.193.62.91 "systemctl show negotaitions-poc -p User -p Group -p WorkingDirectory -p ExecStart -p EnvironmentFiles"
ssh deploy@130.193.62.91 "systemctl list-timers --all --no-pager"
ssh deploy@130.193.62.91 "systemctl list-units --type=service --no-pager"
ssh deploy@130.193.62.91 "getent hosts postbox.cloud.yandex.net"
ssh deploy@130.193.62.91 "timeout 5 bash -lc '</dev/tcp/postbox.cloud.yandex.net/443' && echo tcp443=ok || echo tcp443=fail"
ssh deploy@130.193.62.91 "timeout 5 bash -lc '</dev/tcp/postbox.cloud.yandex.net/587' && echo tcp587=ok || echo tcp587=fail"
ssh deploy@130.193.62.91 "timeout 5 bash -lc '</dev/tcp/postbox.cloud.yandex.net/465' && echo tcp465=ok || echo tcp465=fail"
ssh deploy@130.193.62.91 "timeout 8 openssl s_client -connect postbox.cloud.yandex.net:465 -servername postbox.cloud.yandex.net -brief </dev/null"
```

Do not run `systemctl cat` if units might include inline secrets. Do not print environment files.

## Required Before First Real Email

- DNS wildcard/private A behavior understood and corrected/approved.
- Yandex 360 domain connected if inbound addresses are public.
- Postbox identity verified.
- Single SPF record validated.
- DKIM records verified for both Yandex 360 and Postbox.
- DMARC monitoring record configured.
- VM service account and IAM-token path verified, or Lockbox fallback configured.
- Postbox quota and billing confirmed.
- Data Streams/Monitoring/Audit Trails plan accepted.
- Legal/footer/operator contact approved.
- Admin/support owner ready to receive replies, bounces, and reports.
