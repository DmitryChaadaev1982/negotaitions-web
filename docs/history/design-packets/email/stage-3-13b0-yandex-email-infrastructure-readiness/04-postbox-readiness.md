# Yandex Cloud Postbox Readiness

## Current State

| Item | Status | Evidence source |
| --- | --- | --- |
| Service availability in current cloud/folder | MANUAL VERIFICATION REQUIRED | YANDEX CLOUD CLI blocked |
| Postbox address/identity | NOT CONFIGURED | USER DECISION |
| Domain ownership verification | NOT CONFIGURED | USER DECISION |
| Sender restriction/configuration set | NOT CONFIGURED | USER DECISION |
| Quota/usage | MANUAL VERIFICATION REQUIRED | YANDEX CLOUD CLI blocked |
| Billing status | MANUAL VERIFICATION REQUIRED | YANDEX CLOUD CLI blocked |

No Postbox resources were created or verified in B0.

## Official Capability Summary

| Capability | Official finding | Evidence source |
| --- | --- | --- |
| Use cases | Postbox is optimized for transactional emails, notifications, informational and marketing newsletters. | OFFICIAL DOCUMENTATION |
| Interfaces | Supports SMTP, AWS CLI, AWS SDK, AWS SES-compatible API, and cURL. | OFFICIAL DOCUMENTATION |
| Endpoint | API endpoint examples use `https://postbox.cloud.yandex.net`; SMTP host is `postbox.cloud.yandex.net`. | OFFICIAL DOCUMENTATION |
| SMTP/TLS | STARTTLS port `587`, SMTPS port `465`; TLS 1.2 and 1.3 supported. | OFFICIAL DOCUMENTATION |
| Authentication | Supports API key, static access key, and IAM token depending on method; IAM token is suitable for Compute Cloud VMs linked to a service account. | OFFICIAL DOCUMENTATION |
| Role | Sending requires `postbox.sender`; management/viewing has `postbox.viewer`, `postbox.auditor`, `postbox.editor`, `postbox.admin`, message/statistics reader roles. | OFFICIAL DOCUMENTATION |
| Address model | Create an address by specifying a sending domain; service account and address must be in the same folder for sending. | OFFICIAL DOCUMENTATION |
| DKIM | Simple DKIM generates two CNAME records; advanced DKIM supports 1024/2048-bit keys and one selector TXT record. | OFFICIAL DOCUMENTATION |
| SPF | `include:spf.postbox.yandexcloud.net` is recommended if using custom-domain SPF; exactly one SPF record is allowed. | OFFICIAL DOCUMENTATION |
| DMARC | Minimal monitoring policy example: `v=DMARC1;p=none`. | OFFICIAL DOCUMENTATION |
| Sender restrictions | Address creation supports optional sender restrictions. | OFFICIAL DOCUMENTATION |
| Configuration sets | Configuration sets support email operation notifications, TLS-only delivery settings, engagement statistics, and scenario statistics. | OFFICIAL DOCUMENTATION |
| Delivery events | Events can be published to Yandex Data Streams; event types include Bounce, Click, Complaint, Delivery, DeliveryDelay, Open, Rendering Failure, Send, and Subscription. | OFFICIAL DOCUMENTATION |
| Monitoring | Metrics include acceptance, delivery success/retry/spam/reject, processing duration, and event notification metrics. | OFFICIAL DOCUMENTATION |
| Audit Trails | Postbox control-plane events include create/update/delete identity and configuration set. | OFFICIAL DOCUMENTATION |
| Quotas | Defaults include 50 recipients/email, 10 MB message size, 10 addresses, 1 email/sec send rate, 200 emails/24h, 5 configuration sets. | OFFICIAL DOCUMENTATION |
| Pricing | First 2,000 outbound emails/month are free; accepted messages are charged whether delivered or not. | OFFICIAL DOCUMENTATION |
| Yandex 360 coexistence | Official FAQ says a Yandex 360 organization primary domain can be used for Postbox mailings. | OFFICIAL DOCUMENTATION |

## Recommended Target Setup

| Decision | Recommendation | Evidence source |
| --- | --- | --- |
| Cloud/folder | Prefer the same folder as the production VM, or at minimum the same folder as the sending service account/address, because docs require address and service account folder consistency. | OFFICIAL DOCUMENTATION, INFERENCE |
| Identity | Use one domain identity for `negotaitions.ru` if Postbox permits the planned sender set from that domain. | OFFICIAL DOCUMENTATION, INFERENCE |
| Automated senders | Start with `no-reply@`, `invitations@`, `notifications@`; restrict sender list if Postbox identity supports it. | USER DECISION, OFFICIAL DOCUMENTATION |
| Transport | Prefer HTTPS API/cURL or SDK with IAM token from attached VM service account; SMTP IAM token is possible but operationally awkward because tokens expire. | OFFICIAL DOCUMENTATION, INFERENCE |
| Authentication | Preferred: IAM token. Alternative: API/static key stored in Lockbox. Rejected: mailbox password, committed secrets, frontend/public env. | OFFICIAL DOCUMENTATION, INFERENCE |
| Configuration set | Create one transactional configuration set with delivery events to Data Streams and engagement tracking disabled initially. | OFFICIAL DOCUMENTATION, INFERENCE |
| Events | Capture Send, Delivery, DeliveryDelay, Bounce, Complaint, Rendering Failure, and reject/spam-equivalent provider metrics. | OFFICIAL DOCUMENTATION, INFERENCE |
| Monitoring | Add dashboards/alerts for acceptance issues, quota issues, delivery rejects/spam, notification errors, and send volume. | OFFICIAL DOCUMENTATION, INFERENCE |
| Quota | Default 200/day and 1/sec are enough for first security/admin emails, but likely insufficient for reminders/results at scale. Request quota only after volume estimate. | OFFICIAL DOCUMENTATION, INFERENCE |

## Template API vs Repository Templates

Postbox supports provider-side sending APIs but B0 found no reason to make provider templates the source of truth. Use repository templates first:

| Model | Recommendation |
| --- | --- |
| Repository templates | Preferred. Version-controlled, reviewable, RU/EN, HTML/text, manifest-validated, provider-independent. |
| Postbox/provider templates | Do not use as the first template source of truth. They increase provider coupling and make code review/versioning weaker. Reconsider only if Postbox template APIs later provide a strong operational benefit. |
| React email components | Reasonable future option, but adds build/runtime complexity. |
| Handlebars/constrained engine | Recommended initial renderer if B1 implements templates: simple, audited helpers only, escaping by default. |

## Quota Readiness

| Usage phase | Expected need | Quota impact |
| --- | --- | --- |
| Account security only | Verification, reset, changed-password, approval notices. | Default 200/day likely enough for first controlled rollout. |
| Invitations | Event/session invites can burst by participant count. | 50 recipients/email limit encourages one message per recipient or small batches. |
| Reminders/results | Reminder schedules and materials/results notifications multiply volume. | Likely need quota increase and stronger suppression before broad use. |
| Product/marketing | Deferred. | Requires consent, unsubscribe, suppression, higher quota, and legal approval. |

## Manual Verification Needed

- Confirm Postbox appears in the production cloud/folder console.
- Confirm current default quotas and usage.
- Confirm whether quota-manager access is available.
- Confirm billing account status.
- Confirm address identity model for a domain identity sending from `no-reply@`, `invitations@`, and `notifications@`.
- Confirm configuration set and Data Streams setup path in the console.
- Confirm Monitoring metrics appear after a future controlled test.
- Confirm Audit Trails trail destination and retention.
