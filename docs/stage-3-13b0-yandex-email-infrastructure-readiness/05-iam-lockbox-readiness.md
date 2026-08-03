# IAM and Lockbox Readiness

## Current State

| Item | Status | Evidence source |
| --- | --- | --- |
| `yc` availability | BLOCKED | YANDEX CLOUD CLI |
| Current cloud/folder IDs | NOT VERIFIED | YANDEX CLOUD CLI blocked |
| Service accounts in folder | NOT VERIFIED | YANDEX CLOUD CLI blocked |
| Production VM attached service account | NOT VERIFIED | YANDEX CLOUD CLI blocked, PRODUCTION SERVER blocked |
| Lockbox secrets metadata | NOT VERIFIED | YANDEX CLOUD CLI blocked |
| Lockbox payloads | NOT READ | Boundary intentionally preserved |

## Official Capability Summary

| Capability | Official finding | Evidence source |
| --- | --- | --- |
| VM service account | Compute Cloud VMs can have one linked service account. | OFFICIAL DOCUMENTATION |
| VM IAM token | A VM with a linked service account can obtain an IAM token from metadata using `Metadata-Flavor:Google`; token lifetime is less than 12 hours. | OFFICIAL DOCUMENTATION |
| Postbox IAM token | Postbox sending docs support IAM token for cURL/API and SMTP; docs say this is suitable for Compute Cloud VMs linked to a service account. | OFFICIAL DOCUMENTATION |
| Lockbox metadata roles | `lockbox.auditor`/`viewer` can view metadata; `lockbox.payloadViewer` can view secret contents; `lockbox.admin` includes payload viewing and management. | OFFICIAL DOCUMENTATION |
| Lockbox access | Access can be granted to service accounts at secret/folder/cloud levels; folder/cloud roles inherit to secrets. | OFFICIAL DOCUMENTATION |
| Least privilege | Official IAM guidance recommends service roles over primitive roles. | OFFICIAL DOCUMENTATION |

## Recommended Authentication Model

| Rank | Model | Recommendation |
| --- | --- | --- |
| Preferred | IAM token from attached production VM service account | Use if live verification confirms the VM has a suitable service account, metadata token access is enabled, and the selected Postbox API integration can refresh tokens safely. |
| Alternative | API/static key stored in Lockbox and retrieved by least-privilege service account | Use only if IAM-token integration is not practical for the chosen Postbox transport. Grant `lockbox.payloadViewer` only for the specific secret and `postbox.sender` only where needed. |
| Rejected by default | Owner mailbox credentials, committed secrets, `.env` values in repo, frontend/public env, templates, or direct self-hosted SMTP | Too much risk and poor auditability. |

## Minimum Future Role Model

| Actor | Minimum role | Scope | Notes |
| --- | --- | --- | --- |
| Email sender service account | `postbox.sender` | Folder containing Postbox address | Needed for sending only. |
| Email setup operator | `postbox.editor` temporarily, or admin/operator via console | Folder during setup | Remove elevated role after setup where possible. |
| Audit/read-only reviewer | `postbox.viewer` or `postbox.auditor` | Folder/cloud | For address/config inspection without sending. |
| Data Streams writer path | Confirm exact role from Data Streams setup | Stream/folder | Required for event destination pipeline. |
| Lockbox secret reader | `lockbox.payloadViewer` | Specific secret only | Only if persistent secret fallback is used. |
| Lockbox metadata reviewer | `lockbox.viewer`/`lockbox.auditor` | Secret/folder | Payloads not needed for audit. |
| Monitoring reviewer | Monitoring viewer role | Folder | For dashboards/metrics. |
| Audit Trails operator | Audit Trails role per trail setup | Organization/cloud/folder | Needed for trail configuration and review. |

## Readiness Gaps

| Gap | Impact | Manual check |
| --- | --- | --- |
| Current service accounts unknown | Cannot decide reuse vs new account. | `yc iam service-account list` or console IAM service accounts. |
| VM service account unknown | Cannot use preferred IAM-token path until confirmed. | Compute Cloud VM page -> Service account, or read-only `yc compute instance get`. |
| Metadata token access unknown | IAM-token retrieval from VM may be disabled. | VM metadata options or safe metadata-token check from VM that does not print the token. |
| Lockbox usage unknown | Cannot know if secret storage pattern already exists. | `yc lockbox secret list` or console metadata only. |
| Current roles unknown | Cannot verify least privilege. | IAM access bindings review; do not expose tokens/secrets. |

## Safe VM Metadata Check Pattern

When server access is available, verify only token availability without printing the token:

```bash
curl --silent --fail \
  --header Metadata-Flavor:Google \
  http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token \
  | jq -r 'has("access_token"), .token_type, (.expires_in | type)'
```

Expected evidence: token endpoint is reachable and returns a bearer token shape. Do not print `.access_token`.

Evidence source if performed later: PRODUCTION SERVER.
