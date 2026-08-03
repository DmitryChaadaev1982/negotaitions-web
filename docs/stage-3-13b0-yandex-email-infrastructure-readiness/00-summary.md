# Stage 3.13B0 - Yandex Email Infrastructure Readiness Summary

Date: 2026-08-04
Branch: `audit/stage-3-13b0-yandex-email-infrastructure-readiness`
Source branch: `origin/docs/stage-3-13a-email-communication-audit`
Starting SHA: `845064a88c0a3d20a02a7487305edb414b353014`
Scope: read-only infrastructure and documentation audit. No email functionality, DNS changes, Yandex 360 resources, Postbox resources, IAM credentials, Lockbox secrets, runtime code, Prisma schema, migrations, deployment, merge, or production server configuration changes.

## Executive Recommendation

**CONDITIONAL GO**

Repository implementation planning can continue in Stage 3.13B1, but no real email may be sent until manual Yandex Cloud console/CLI and production server checks are completed and DNS is corrected.

| Area | Recommendation | Evidence source |
| --- | --- | --- |
| Repository implementation readiness | CONDITIONAL GO | REPOSITORY, USER DECISION, OFFICIAL DOCUMENTATION |
| Yandex 360 readiness | MANUAL VERIFICATION REQUIRED | USER DECISION, OFFICIAL DOCUMENTATION |
| Postbox readiness | MANUAL VERIFICATION REQUIRED | OFFICIAL DOCUMENTATION, NOT VERIFIED |
| DNS readiness | PARTIALLY READY | PUBLIC DNS |
| Server/worker readiness | MANUAL VERIFICATION REQUIRED | REPOSITORY, PRODUCTION SERVER blocked |
| Security readiness | CONDITIONAL GO | USER DECISION, OFFICIAL DOCUMENTATION, REPOSITORY |
| Legal/content readiness | DECISION REQUIRED | USER DECISION, REPOSITORY |

## Most Important Findings

| Finding | Status | Evidence source |
| --- | --- | --- |
| `negotaitions.ru` is delegated to Yandex Cloud DNS name servers `ns1.yandexcloud.net` and `ns2.yandexcloud.net`. | PARTIALLY READY | PUBLIC DNS |
| Public recursive DNS returned no MX, no root SPF TXT, and no `_dmarc` TXT. | NOT CONFIGURED | PUBLIC DNS |
| Root, `www`, `app`, `local`, and a random wildcard subdomain resolve publicly to `172.29.172.1` with TTL `0`. This must be reviewed before mail rollout. | BLOCKED for production hygiene | PUBLIC DNS |
| Yandex Cloud CLI `yc` is not available in the local shell, so Cloud DNS zone contents, Postbox resources, quotas, service accounts, Lockbox metadata, and VM service-account attachment were not live-verified. | MANUAL VERIFICATION REQUIRED | YANDEX CLOUD CLI blocked |
| SSH to `deploy@130.193.62.91:22` timed out, so production service metadata and outbound Postbox connectivity from the VM were not live-verified. | MANUAL VERIFICATION REQUIRED | PRODUCTION SERVER blocked |
| Official Postbox docs support SMTP, AWS-compatible API/SDK/CLI, and cURL; IAM-token sending is supported for Compute Cloud VMs linked to a service account. | READY as provider capability | OFFICIAL DOCUMENTATION |
| Official Postbox docs require/produce DKIM records for domain ownership and recommend SPF/DMARC. | READY as provider capability | OFFICIAL DOCUMENTATION |
| Official Yandex 360 docs support one mailbox with aliases, shared mailboxes, delegated access, and groups/mailing lists after domain connection. | READY as provider capability | OFFICIAL DOCUMENTATION |
| No Yandex 360 organization and no Postbox configuration exist by user decision/current state. | NOT CONFIGURED | USER DECISION |

## Readiness Matrix

| Component | Status | Notes | Evidence source |
| --- | --- | --- | --- |
| Yandex Cloud DNS ownership | PARTIALLY READY | Public NS confirms Yandex Cloud DNS delegation; folder/zone ownership not CLI-verified. | PUBLIC DNS, NOT VERIFIED |
| Authoritative zone | MANUAL VERIFICATION REQUIRED | Recursive DNS confirms `ns1/ns2.yandexcloud.net`; direct authoritative queries timed out locally and `yc dns zone list` could not run. | PUBLIC DNS, YANDEX CLOUD CLI blocked |
| MX | NOT CONFIGURED | No MX response, only SOA negative response. | PUBLIC DNS |
| SPF | NOT CONFIGURED | No root TXT/SPF response. | PUBLIC DNS |
| DKIM | NOT CONFIGURED | No provider selectors known yet; no selectors guessed. | USER DECISION, NOT VERIFIED |
| DMARC | NOT CONFIGURED | `_dmarc.negotaitions.ru` returned no TXT. | PUBLIC DNS |
| Yandex 360 organization | NOT CONFIGURED | Organization has not been created. | USER DECISION |
| Domain verification | NOT CONFIGURED | Requires Yandex 360 and/or Postbox-generated records. | USER DECISION, OFFICIAL DOCUMENTATION |
| Mailbox model | DECISION REQUIRED | Initial recommendation: one real owner mailbox plus aliases, with future shared mailboxes/groups when delegation starts. | USER DECISION, OFFICIAL DOCUMENTATION |
| Owner client access | MANUAL VERIFICATION REQUIRED | Desktop/mobile client setup not live-tested; official docs support mail clients/shared access. | OFFICIAL DOCUMENTATION |
| Postbox service availability | MANUAL VERIFICATION REQUIRED | Officially documented, but not verified in the current cloud/folder. | OFFICIAL DOCUMENTATION, YANDEX CLOUD CLI blocked |
| Postbox address identity | NOT CONFIGURED | No address/identity created in B0. | USER DECISION |
| IAM service account | MANUAL VERIFICATION REQUIRED | Current service accounts could not be listed. | YANDEX CLOUD CLI blocked |
| Attached VM service account | MANUAL VERIFICATION REQUIRED | VM metadata could not be inspected. | YANDEX CLOUD CLI blocked, PRODUCTION SERVER blocked |
| Postbox authentication | PARTIALLY READY | IAM-token mode is preferred if VM service account is attached; static/API key fallback requires Lockbox. | OFFICIAL DOCUMENTATION |
| Lockbox | MANUAL VERIFICATION REQUIRED | Metadata not inspectable because `yc` unavailable; payloads were not read. | YANDEX CLOUD CLI blocked |
| Quotas | MANUAL VERIFICATION REQUIRED | Official defaults known; current quota/usage not verified. | OFFICIAL DOCUMENTATION |
| Billing | MANUAL VERIFICATION REQUIRED | Official pricing known; production billing account not verified. | OFFICIAL DOCUMENTATION |
| Data Streams delivery events | PARTIALLY READY | Official configuration sets can stream events; no stream/config exists yet. | OFFICIAL DOCUMENTATION |
| Monitoring | READY as capability | Postbox metrics are documented in Yandex Monitoring. | OFFICIAL DOCUMENTATION |
| Audit Trails | READY as capability | Postbox control-plane events are documented in Audit Trails. | OFFICIAL DOCUMENTATION |
| Server outbound HTTPS | MANUAL VERIFICATION REQUIRED | SSH timed out; no VM-side connectivity check. | PRODUCTION SERVER blocked |
| Server outbound SMTP | MANUAL VERIFICATION REQUIRED | SSH timed out; no VM-side connectivity check to 587/465. | PRODUCTION SERVER blocked |
| Worker hosting | PARTIALLY READY | Repo has systemd/timer maintenance precedent; no email worker exists. | REPOSITORY |
| Systemd timer | PARTIALLY READY | Stage 3.10 maintenance service/timer templates exist. | REPOSITORY |
| Support/security/business ownership | DECISION REQUIRED | User decision names one individual operator and initial recipient; legal publication needs approval. | USER DECISION |
| Template model | READY for design | Recommend repository-owned editable files with manifest validation, not Postbox provider templates. | USER DECISION, INFERENCE |
| Retention decisions | DECISION REQUIRED | Defaults refined in this audit; legal confirmation required. | USER DECISION, INFERENCE |
| Legal/operator information | DECISION REQUIRED | Current legal pages still have placeholders; do not publish residential address without approval. | REPOSITORY, USER DECISION |

## Initial Architecture Recommendation

Use the Yandex-native split already approved in Stage 3.13A:

1. **Yandex 360** for real inbound human mailboxes, aliases, groups, shared/delegated access, and desktop/mobile client use.
2. **Yandex Cloud Postbox** for automated application-originated transactional mail.
3. **Yandex Cloud DNS** for MX, SPF, DKIM, DMARC, and verification records.
4. **IAM-token sending from an attached VM service account** if live checks confirm the VM can obtain service-account IAM tokens and the selected Postbox integration supports it operationally.
5. **Lockbox fallback** only for unavoidable persistent API/static keys.
6. **PostgreSQL outbox plus dedicated worker/systemd service or timer** for durable asynchronous delivery.

## Go/No-Go by Area

| Area | Result | Reason |
| --- | --- | --- |
| Repository implementation readiness | CONDITIONAL GO | Existing Stage 3.13A architecture, invite/access model, maintenance patterns, and env hygiene docs are sufficient to design B1. |
| Yandex 360 readiness | CONDITIONAL GO after manual setup | Provider capability is known, but organization/domain/mailboxes are not configured. |
| Postbox readiness | CONDITIONAL GO after manual setup | Provider capability is known, but current folder availability, identity, quota, billing, and service account status are not verified. |
| DNS readiness | NO-GO for live sending until fixed | MX/SPF/DMARC/DKIM are absent and wildcard/private A responses need review. |
| Server/worker readiness | CONDITIONAL GO after SSH/cloud verification | Repo has a timer precedent, but VM service account and outbound connectivity were not verified. |
| Security readiness | CONDITIONAL GO | IAM-token preferred path is viable by docs; Lockbox fallback requires least-privilege setup and no payload exposure. |
| Legal/content readiness | DECISION REQUIRED | Operator/contact/disclaimer/retention decisions need legal approval before publication. |

## B1 Entry Conditions

Stage 3.13B1 may start repository-only implementation design and mocked provider scaffolding if it does not send real email. Before any real outbound email test, complete:

- Yandex Cloud console/CLI verification in `12-manual-console-checklist.md`.
- Production VM service-account and outbound connectivity checks in `06-production-server-readiness.md`.
- DNS cleanup and planned MX/SPF/DKIM/DMARC rollout in `07-target-dns-plan.md`.
- Legal approval for public contact/operator details and email disclaimers.
