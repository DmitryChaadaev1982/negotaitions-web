# Quotas, Cost, and Capacity

## Postbox Quotas

Official default quotas and limits:

| Quota/limit | Official default | Readiness impact | Evidence source |
| --- | --- | --- | --- |
| Recipients per email | 50 | Use per-recipient messages for personalization and privacy; do not rely on large recipient lists. | OFFICIAL DOCUMENTATION |
| Message size with attachments | 10 MB | ICS attachment is fine; do not attach recordings/transcripts/materials. | OFFICIAL DOCUMENTATION |
| Addresses/identities | 10 | Enough for `no-reply@`, `invitations@`, `notifications@`; verify domain identity behavior. | OFFICIAL DOCUMENTATION |
| Send rate | 1 email/sec | Fine for first security/account emails; may constrain bulk invites/reminders. | OFFICIAL DOCUMENTATION |
| 24-hour volume | 200 emails | May be enough for first controlled rollout; likely insufficient for larger events/reminders/results. | OFFICIAL DOCUMENTATION |
| Configuration sets | 5 | Enough for initial transactional configuration. | OFFICIAL DOCUMENTATION |

Current quota/usage in the production cloud was not verified because `yc` is unavailable and no console inspection was performed.

Evidence source: YANDEX CLOUD CLI blocked.

## Postbox Pricing

Official pricing documentation states:

- First 2,000 outbound emails per month are free.
- All emails accepted for sending are charged whether delivered or not.
- If one email is sent to multiple recipients, outbound email count equals recipient count.
- Higher volume tiers apply after the free allowance.

Evidence source: OFFICIAL DOCUMENTATION.

## Yandex 360 Costs

Official Yandex 360 plan docs state:

- Plans include Basic, Optimal, Extended.
- Cost is per employee per month.
- Cost formula includes the number of employees added to the organization, including inactive and blocked users.
- Business email is included; additional plan features differ.
- Login verification controls vary by plan/API support.

Evidence source: OFFICIAL DOCUMENTATION.

## Capacity Forecast

| Phase | Email types | Volume risk | Quota posture |
| --- | --- | --- | --- |
| B1/B2 mocked/local | Test templates, mocked provider | None live | No Postbox quota needed. |
| First controlled provider smoke | One admin test email | Minimal | Default quota enough. |
| Account security rollout | Verification, reset, password changed, approval notices | Low to moderate | Default quota likely enough if user count is small. |
| Invitations rollout | Event/session invitations | Bursty by participant count | May need quota increase and per-recipient queue throttling. |
| Reminders/results rollout | Scheduled reminders and materials/results publication | Recurring/bursty | Likely quota increase needed before broad enablement. |
| Product/marketing | Optional communications/campaigns | High and reputation-sensitive | Deferred until consent, unsubscribe, suppression, higher quota, legal approval. |

## Cost Controls

- Keep product/marketing disabled until separate approval.
- One email per recipient is safer for privacy and personalization; count this in capacity estimates.
- Do not include recordings/transcripts/materials inline or as attachments.
- Keep ICS attachments small and optional.
- Add usage counters and alerts before enabling reminders/results.
- Track accepted-for-sending count, not only delivered count, because billing follows accepted messages.

## Quota Increase Readiness

Before requesting increases:

1. Estimate monthly active users.
2. Estimate average Event invite count.
3. Estimate reminder offsets per Event/Session.
4. Estimate materials/results notification rate.
5. Define throttling behavior in the email worker.
6. Confirm bounce/complaint handling and suppression.
7. Confirm owner support capacity for delivery issues.

Official docs say quota increases require a support request and `quota-manager.requestOperator` or higher.

Evidence source: OFFICIAL DOCUMENTATION.
