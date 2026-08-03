# Source Register

Access date: 2026-08-04

## Official Documentation

| Title | Publisher | URL | Capability/restriction verified |
| --- | --- | --- | --- |
| Yandex Cloud Postbox | Yandex Cloud | https://yandex.cloud/en/docs/postbox/ | Postbox is an email service with Monitoring/Logging integration and service docs. |
| Yandex Cloud Postbox overview | Yandex Cloud | https://yandex.cloud/en/docs/postbox/concepts/ | Transactional/notification/newsletter use cases; SMTP; AWS API; DNS; Data Streams/DataLens integration. |
| Getting started with Yandex Cloud Postbox | Yandex Cloud | https://yandex.cloud/en/docs/postbox/quickstart | Billing prerequisite, `postbox.sender`, API/static keys, address creation, DKIM verification, SMTP ports. |
| Sending an email | Yandex Cloud | https://yandex.cloud/en/docs/postbox/operations/send-email | AWS CLI, SMTP, AWS SDK, cURL; API key/static key/IAM token; VM service account IAM-token suitability. |
| Mailing service Yandex Cloud Postbox | Yandex Cloud | https://yandex.cloud/en/services/postbox | Service marketing page: SMTP/API, TLS 1.2+, Logging/Monitoring/DataLens, 2,000 free/month, scale claims. |
| Yandex Cloud Postbox quotas and limits | Yandex Cloud | https://yandex.cloud/en/docs/postbox/concepts/limits | Default quotas: 50 recipients, 10 MB, 10 identities, 1/sec, 200/day, 5 config sets; quota-manager role. |
| Yandex Cloud Postbox pricing policy | Yandex Cloud | https://yandex.cloud/en/docs/postbox/pricing | First 2,000 outbound emails/month free; accepted messages charged; recipient-based billing. |
| Access management in Yandex Cloud Postbox | Yandex Cloud | https://yandex.cloud/en/docs/postbox/security/ | `postbox.sender`, viewer/auditor/editor/admin, message/statistics reader roles. |
| DNS records for working with Yandex Cloud Postbox | Yandex Cloud | https://yandex.cloud/en/docs/postbox/concepts/dns-records | DKIM mandatory, SPF/DMARC recommended, one SPF record, Postbox SPF include. |
| Creating an address | Yandex Cloud | https://yandex.cloud/en/docs/postbox/operations/create-address | Domain identity, DKIM simple/advanced modes, sender restrictions, logging option. |
| Setting up a DMARC policy | Yandex Cloud | https://yandex.cloud/en/docs/postbox/operations/setup-dmarc | DMARC `_dmarc` TXT and minimal `v=DMARC1;p=none`. |
| Email event notifications | Yandex Cloud | https://yandex.cloud/en/docs/postbox/concepts/notification | Data Streams JSON notifications; Bounce/Complaint/Delivery and other event shapes. |
| Creating a configuration | Yandex Cloud | https://yandex.cloud/en/docs/postbox/operations/create-configuration | Configuration sets, subscriptions to Data Streams, TLS-only delivery, engagement statistics. |
| Streaming Yandex Cloud Postbox events to Yandex Data Streams and analyzing them using Yandex DataLens | Yandex Cloud | https://yandex.cloud/en/docs/postbox/tutorials/events-from-postbox-to-yds | Event stream pipeline and example event schema/storage. |
| FAQ about Yandex Cloud Postbox | Yandex Cloud | https://yandex.cloud/en/docs/postbox/qa/ | Yandex 360 primary domain can be used for Postbox; SPF not strictly required but recommended for strict recipients. |
| Yandex Cloud Postbox metrics | Yandex Cloud | https://yandex.cloud/en/docs/monitoring/metrics-ref/postbox-ref | Monitoring metrics for acceptance, delivery, reject/spam, and notification publishing. |
| Control plane event reference Yandex Audit Trails | Yandex Cloud | https://yandex.cloud/en/docs/audit-trails/concepts/events | Postbox Audit Trails events for identity/configuration set create/update/delete. |
| Resource records | Yandex Cloud DNS | https://yandex.cloud/en/docs/dns/concepts/resource-record | Record types, record sets, TTL, SOA behavior, TXT limitations, CNAME coexistence warning. |
| Cloud DNS API, REST: DnsZone.ListRecordSets | Yandex Cloud DNS | https://yandex.cloud/en/docs/dns/api-ref/DnsZone/listRecordSets | Read-only record list API and fields. |
| Initial setup | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/mail/start | Required MX/SPF/DKIM records for corporate mail. |
| MX record | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/domains/dns/mx | MX target `mx.yandex.net.`, priority 10, TTL 21600, propagation guidance. |
| SPF record | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/domains/dns/spf | Yandex 360 SPF redirect and include-based SPF when other senders exist. |
| DKIM signature | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/domains/dns/dkim | `mail._domainkey` TXT with admin-generated public key. |
| Synonymous addresses (aliases) | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/mail/mailbox-management/aliases | Up to 10 aliases per mailbox; receive/send/login from aliases; same alias cannot be on multiple mailboxes. |
| Shared mailboxes | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/mail/sharing/shared | Shared mailbox creation and access after connected domain. |
| Shared access: shared and delegated mailboxes | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/mail/sharing/ | Shared/delegated mailbox limits and send-as/send-on-behalf modes. |
| Groups | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/projects | Groups/mailing list addresses for connected mail domains. |
| Create an account | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/add-users | Creating employee accounts/mailboxes; domain and balance prerequisites. |
| Yandex 360 for Business plans | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/purchase/en/plans/payment-plans | Basic/Optimal/Extended plan features and business email inclusion. |
| How to estimate the monthly cost | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/purchase/en/plans/calculate-price | Cost formula: plan x employees plus add-ons; inactive/blocked users count. |
| Guidelines on security and safe use of Yandex 360 | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/security/security-recommendations | Admin security recommendations, 2FA, recovery, password policy. |
| Login verification for Yandex 360 services | Yandex 360 for Business | https://yandex.com/support/yandex-360/business/admin/en/security/set-2fa | Login verification/MFA availability and configuration. |
| Access management in Yandex Lockbox | Yandex Cloud | https://yandex.cloud/en/docs/lockbox/security/ | Lockbox roles, metadata vs payload viewing, least-privilege implications. |
| Configuring access to a secret | Yandex Cloud | https://yandex.cloud/en/docs/lockbox/operations/secret-access | Granting secret access to service accounts; do not read payloads in audit. |
| Using Yandex Cloud from within a VM | Yandex Cloud Compute | https://yandex.cloud/en/docs/compute/operations/vm-connect/auth-inside-vm | VM service account, metadata IAM token, token lifetime, authorization header. |
| Linking the service account to your VM | Yandex Cloud Compute | https://yandex.cloud/en/docs/compute/operations/vm-control/vm-connect-sa | One service account per VM and linking prerequisites. |

## Live Evidence

| Evidence | Source | Result |
| --- | --- | --- |
| Git preflight | Local Git | Source branch matched short SHA `845064a`; worktree created. |
| DNS queries | Local PowerShell `Resolve-DnsName` | Public recursive DNS evidence in `02-current-dns-snapshot.md`. |
| Yandex Cloud CLI | Local PowerShell | `yc` command not found; cloud inspection blocked. |
| Production server SSH | Local PowerShell SSH | Connection to `130.193.62.91:22` timed out; server inspection blocked. |
