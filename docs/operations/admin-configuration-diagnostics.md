# Admin Configuration Diagnostics

Stage 3.13C changes the admin configuration table from raw env-presence checks
to runtime-derived diagnostics. The server computes diagnostics dynamically via
`getAdminEnvironmentDisplayGroups()` and returns them through
`app/api/admin/health/route.ts` with `force-dynamic`, `revalidate=0`, and
`Cache-Control: no-store`.

## Row Contract

Each row is a bounded `AdminEnvDisplayItem`:

- `key`: runtime key or operational label.
- `area`: feature area.
- `status`: `configured`, `using_effective_default`, `disabled_by_design`,
  `not_applicable`, `missing_required`, or `invalid`.
- `valueSource`: `environment`, `default`, `derived`, or `not_applicable`.
- `configured`: whether a raw setting is present when that matters.
- `isSecret`: secret-classification flag.
- `value`: safe effective value only. Secret values are always `null`.
- `applicable`: whether the row matters under the current feature mode.
- `required`: whether the current feature mode requires it.
- `consumer`: runtime code that consumes the setting.
- `explanation`: safe operator-facing reason.

The browser component renders only this bounded model. It never enumerates
`process.env` and never receives masked or partial secret values.

## Coverage Matrix

The typed registry in `lib/config/server-runtime-settings.ts` is the executable
source of truth. Administrative descriptors are projected directly from it.
The table below is asserted equal to the registry in both directions, including
the secret column. A TypeScript-compiler-API verifier scans the promised auth,
session, proxy, password-reset, email, worker, retry, retention, Postbox, Data
Streams, provider-event, and sensitive-payload modules. Direct, bracketed,
destructured, aliased, dynamic, helper-mediated, unregistered, or unused
configuration access fails validation.

| Runtime key | Parser/owner | Effective default | Secret | Required condition | Display rule |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | typed runtime registry | `development` | no | never | effective bounded runtime mode |
| `VIDEO_PROVIDER` | `lib/config/provider-runtime.ts` | `livekit` | no | always | derived effective provider |
| `TRANSCRIPTION_PROVIDER` | `lib/config/provider-runtime.ts` | `openai` | no | always | derived effective provider |
| `AI_ANALYSIS_PROVIDER` | `lib/config/provider-runtime.ts` | `openai` | no | always | derived effective provider |
| `DATABASE_URL` | `lib/prisma.ts` | none | yes | always | configured/missing only, value always null |
| `AUTH_SECRET` | `lib/auth/client-ip.ts` | none | yes | always | configured/missing only, value always null |
| `ADMIN_EMAILS` | `lib/auth/admin.ts` | empty list | no | never (empty is valid) | `configured list` or `empty list`, never the addresses |
| `TRUSTED_PROXY_ENABLED` | `lib/auth/trusted-proxy.ts` | `false` | no | trusted nginx activation | effective boolean, environment/default source |
| `CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS` | `lib/auth/credential-dispatch-fence.ts` | bounded default | no | credential dispatch fence | effective bounded integer |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `lib/auth/password-reset-config.ts` | `30` | no | password reset | effective integer default |
| `PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS` | `lib/auth/password-reset-config.ts` | bounded default | no | password reset | effective integer default |
| `PASSWORD_RESET_MAX_REQUESTS_PER_HOUR` | `lib/auth/password-reset-config.ts` | bounded default | no | password reset | effective integer default |
| `PASSWORD_RESET_RESPONSE_FLOOR_MS` | `lib/auth/response-timing-floor.ts` | bounded default | no | public forgot-password intake | effective anti-enumeration floor |
| `EMAIL_DELIVERY_ENABLED` | `lib/email/config.ts` | `false` | no | delivery activation | disabled-by-design when false |
| `EMAIL_PROVIDER` | `lib/email/config.ts` | `disabled` | no | email runtime | effective provider |
| `EMAIL_CANONICAL_BASE_URL` | `lib/email/config.ts` | `https://negotaitions.ru` | no | account-security email links | effective canonical origin |
| `EMAIL_LOCAL_PREVIEW_ENABLED` | `lib/email/config.ts` | `false` | no | development preview only | disabled-by-design when false |
| `EMAIL_ADMIN_TEST_ENABLED` | `lib/email/config.ts` | `false` | no | admin test email action | disabled-by-design when false |
| `EMAIL_OPERATOR_NAME` | `lib/email/config.ts` | operator identity default | no | email footer | effective string |
| `EMAIL_FROM_NO_REPLY` | `lib/email/config.ts` | `no-reply@negotaitions.ru` | no | delivery enabled | effective validated sender |
| `EMAIL_FROM_NOTIFICATIONS` | `lib/email/config.ts` | `notifications@negotaitions.ru` | no | delivery enabled | effective validated sender |
| `EMAIL_FROM_INVITATIONS` | `lib/email/config.ts` | `invitations@negotaitions.ru` | no | delivery enabled | effective validated sender |
| `EMAIL_REPLY_TO_SUPPORT` | `lib/email/config.ts` | `support@negotaitions.ru` | no | delivery enabled | effective validated reply-to |
| `EMAIL_REPLY_TO_SECURITY` | `lib/email/config.ts` | `security@negotaitions.ru` | no | delivery enabled | effective validated reply-to |
| `EMAIL_REPLY_TO_BUSINESS` | `lib/email/config.ts` | `business@negotaitions.ru` | no | delivery enabled | effective validated reply-to |
| `EMAIL_SENSITIVE_PAYLOAD_KEY` | `lib/email/sensitive-payload.ts` | none | yes | password-reset intake active | configured/missing only, value always null |
| `YANDEX_POSTBOX_REGION` | `lib/email/config.ts` | `ru-central1` | no | Postbox readiness | effective default when absent |
| `YANDEX_POSTBOX_ENDPOINT` | `lib/email/config.ts` | `https://postbox.cloud.yandex.net` | no | Postbox readiness | effective default when absent |
| `YANDEX_POSTBOX_CONFIGURATION_SET` | `lib/email/config.ts` | none | no | only when the chosen Postbox strategy uses it | optional/not applicable, never missing solely due to absence |
| `YANDEX_POSTBOX_ACCESS_KEY_ID` | `lib/email/config.ts` | none | yes | delivery enabled with Postbox | configured/missing only, value always null |
| `YANDEX_POSTBOX_SECRET_ACCESS_KEY` | `lib/email/config.ts` | none | yes | delivery enabled with Postbox | configured/missing only, value always null |
| `EMAIL_WORKER_BATCH_SIZE` | `lib/email/config.ts` | bounded default | no | worker sweeps | effective bounded integer |
| `EMAIL_MAX_ATTEMPTS` | `lib/email/config.ts` | bounded default | no | worker retries | effective bounded integer |
| `EMAIL_RETRY_BASE_SECONDS` | `lib/email/config.ts` | bounded default | no | worker retries | effective bounded integer |
| `EMAIL_RETRY_MAX_SECONDS` | `lib/email/config.ts` | bounded default | no | worker retries | effective bounded integer |
| `EMAIL_PROCESSING_LEASE_SECONDS` | `lib/email/config.ts` | bounded default | no | worker claim lease | effective bounded integer |
| `EMAIL_PROVIDER_REQUEST_TIMEOUT_MS` | `lib/email/config.ts` | bounded default | no | provider request | effective bounded integer |
| `EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS` | `lib/email/config.ts` | bounded default | no | provider request | effective bounded integer |
| `EMAIL_CONTENT_RETENTION_DAYS` | `lib/email/config.ts` | bounded default | no | retention sweeps | effective bounded integer |
| `EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS` | `lib/email/config.ts` | bounded default | no | retention sweeps | effective bounded integer |
| `EMAIL_PROVIDER_ID_RETENTION_DAYS` | `lib/email/config.ts` | bounded default | no | retention sweeps | effective bounded integer |
| `EMAIL_PROVIDER_EVENT_RETENTION_DAYS` | `lib/email/config.ts` | bounded default | no | retention sweeps | effective bounded integer |
| `EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS` | `lib/email/config.ts` | bounded default | no | retention sweeps | effective bounded integer |
| `EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS` | `lib/email/config.ts` | bounded default | no | provider-event reconciliation | effective bounded integer |
| `EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS` | `lib/email/config.ts` | bounded default | no | provider-event reconciliation | effective bounded integer |
| `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED` | `lib/email/config.ts` | `false` | no | live provider-event ingestion | feature-level disabled-by-design when false |
| `YANDEX_DATA_STREAMS_ENDPOINT` | `lib/email/config.ts` | none | no | provider-event ingestion enabled | required only when enabled; HTTPS Yandex endpoint |
| `YANDEX_DATA_STREAMS_STREAM_NAME` | `lib/email/config.ts` | none | no | provider-event ingestion enabled | required only when enabled |
| `YANDEX_DATA_STREAMS_REGION` | `lib/email/config.ts` | `ru-central1` | no | provider-event readiness | effective default |
| `YANDEX_DATA_STREAMS_ACCESS_KEY_ID` | `lib/email/config.ts` | none | yes | provider-event ingestion enabled | configured/missing only, value always null |
| `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY` | `lib/email/config.ts` | none | yes | provider-event ingestion enabled | configured/missing only, value always null |
| `EMAIL_PROVIDER_EVENT_INITIAL_POSITION` | `lib/email/config.ts` | `LATEST` | no | provider-event readiness | effective default/enum |
| `EMAIL_PROVIDER_EVENT_RECORD_LIMIT` | `lib/email/config.ts` | bounded default | no | provider-event readiness | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS` | `lib/email/config.ts` | bounded default | no | per-shard GetRecords pacing | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS` | `lib/email/config.ts` | bounded default | no | shard discovery and lock liveness | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS` | `lib/email/config.ts` | bounded default | no | transient retry backoff base | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES` | `lib/email/config.ts` | bounded default | no | deterministic oversize rejection | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS` | `lib/email/config.ts` | bounded default | no | enforced CLI shutdown budget | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY` | `lib/email/config.ts` | bounded default | no | fair scheduler slice concurrency | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS` | `lib/email/config.ts` | bounded default | no | fair scheduler slice bound | bounded effective integer |
| `EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES` | `lib/email/config.ts` | bounded default | no | bounded transient retry exhaustion | bounded effective integer |

Obsolete, test-only, or currently unconsumed keys are not displayed. Inactive
feature child settings are not reported as missing; the feature receives a
clear disabled/not-applicable status instead.

Secrets carry no value under any status. There is no masking, prefix, suffix,
length, or fingerprint: `value` is `null` for every secret descriptor, and the
reversible `maskSecretValue` helper has been removed.

## Emergency Route Contract

The outer admin-health catch returns one deeply frozen, literal response with
`ADMIN_HEALTH_UNAVAILABLE` and `RUNTIME_CONFIGURATION_UNAVAILABLE`. It contains
no webhook state, endpoint, override, parser result, environment value, error
message, stack, or secret-presence detail. The fallback is deterministic and
bounded; authorization still runs before diagnostics, and server logging is
limited to a stable event code, route name, and `error`/`non_error` category.
