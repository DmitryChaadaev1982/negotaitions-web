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
- `status`: `configured`, `using_intrinsic_default`, `disabled_by_design`,
  `not_applicable`, `unconfigured_optional`, `missing_required`, or `invalid`.
- `valueSource`: `environment`, `missing`, `intrinsic`, `derived`, or
  `not_applicable`.
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
configuration access fails validation. The sole reviewed bootstrap exception is
the literal `process.env.NODE_ENV` read in `next.config.ts`, required before
Next's application module resolver exists; the verifier permits that exact
module/key/form and rejects every other direct read.

| Runtime key | Parser/owner | Missing-value behavior | Secret | Required condition | Display rule |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | typed runtime registry | intrinsic `development` fallback | no | never | intrinsic source is explicit |
| `VIDEO_PROVIDER` | `lib/config/provider-runtime.ts` | missing/error | no | always | environment only |
| `TRANSCRIPTION_PROVIDER` | `lib/config/provider-runtime.ts` | missing/error | no | always | environment only |
| `AI_ANALYSIS_PROVIDER` | `lib/config/provider-runtime.ts` | missing/error | no | always | environment only |
| `DATABASE_URL` | `lib/prisma.ts` | missing/error | yes | always | presence only, value always null |
| `AUTH_SECRET` | `lib/auth/client-ip.ts` | missing/error | yes | always | presence only, value always null |
| `ADMIN_EMAILS` | `lib/auth/admin.ts` | missing/error | no | always | configured-list state, never addresses |
| `TRUSTED_PROXY_ENABLED` | `lib/auth/trusted-proxy.ts` | missing/error | no | always | environment boolean |
| `CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS` | `lib/auth/credential-dispatch-fence.ts` | missing/error | no | always | bounded environment integer |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `lib/auth/password-reset-config.ts` | missing/error | no | always | bounded environment integer |
| `PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS` | `lib/auth/password-reset-config.ts` | missing/error | no | always | bounded environment integer |
| `PASSWORD_RESET_MAX_REQUESTS_PER_HOUR` | `lib/auth/password-reset-config.ts` | missing/error | no | always | bounded environment integer |
| `PASSWORD_RESET_RESPONSE_FLOOR_MS` | `lib/auth/response-timing-floor.ts` | missing/error | no | always | bounded environment integer |
| `SESSION_DEBRIEF_EMPTY_CLOSE_MS` | `lib/config/session-lifecycle-settings.ts` | optional/unconfigured | no | never | bounded empty-Debrief business timeout; default 60000. Stage 3.18A production deploy must set this explicitly so a leftover `DEBRIEF_AUTO_CLOSE_GRACE_MS=30000` cannot keep 30s compatibility. |
| `SESSION_DEBRIEF_MAX_DURATION_MS` | `lib/config/session-lifecycle-settings.ts` | optional/unconfigured | no | never | bounded Debrief hard-maximum business timeout; default 7200000 |
| `SESSION_ABANDONED_CLOSE_MS` | `lib/config/session-lifecycle-settings.ts` | optional/unconfigured | no | never | bounded abandoned-Session business timeout; default 10800000 |
| `DEBRIEF_AUTO_CLOSE_GRACE_MS` | `lib/config/session-lifecycle-settings.ts` | optional/unconfigured | no | never | legacy alias used only when SESSION_DEBRIEF_EMPTY_CLOSE_MS is unset |
| `EMAIL_DELIVERY_ENABLED` | `lib/email/config.ts` | missing/error | no | always | disabled-by-design when explicitly false |
| `EMAIL_PROVIDER` | `lib/email/config.ts` | missing/error | no | always | environment enum |
| `EMAIL_CANONICAL_BASE_URL` | `lib/email/config.ts` | missing/error | no | always | validated environment origin |
| `EMAIL_LOCAL_PREVIEW_ENABLED` | `lib/email/config.ts` | missing/error | no | always | disabled-by-design when explicitly false |
| `EMAIL_ADMIN_TEST_ENABLED` | `lib/email/config.ts` | missing/error | no | always | disabled-by-design when explicitly false |
| `EMAIL_OPERATOR_NAME` | `lib/email/config.ts` | missing/error | no | always | environment identity |
| `EMAIL_FROM_NO_REPLY` | `lib/email/config.ts` | missing/error | no | always | validated environment sender |
| `EMAIL_FROM_NOTIFICATIONS` | `lib/email/config.ts` | missing/error | no | always | validated environment sender |
| `EMAIL_FROM_INVITATIONS` | `lib/email/config.ts` | missing/error | no | always | validated environment sender |
| `EMAIL_REPLY_TO_SUPPORT` | `lib/email/config.ts` | missing/error | no | always | validated environment reply-to |
| `EMAIL_REPLY_TO_SECURITY` | `lib/email/config.ts` | missing/error | no | always | validated environment reply-to |
| `EMAIL_REPLY_TO_BUSINESS` | `lib/email/config.ts` | missing/error | no | always | validated environment reply-to |
| `EMAIL_SENSITIVE_PAYLOAD_KEY` | `lib/email/sensitive-payload.ts` | missing/error | yes | always | presence only, value always null |
| `YANDEX_POSTBOX_REGION` | `lib/email/config.ts` | not applicable or missing/error | no | enabled Postbox delivery | environment only |
| `YANDEX_POSTBOX_ENDPOINT` | `lib/email/config.ts` | not applicable or missing/error | no | enabled Postbox delivery | environment only |
| `YANDEX_POSTBOX_ALLOWED_SENDERS` | `lib/email/config.ts` | not applicable or missing/error | no | enabled Postbox delivery | verified sender allowlist |
| `YANDEX_POSTBOX_CONFIGURATION_SET` | `lib/email/config.ts` | optional/unconfigured | no | optional under Postbox delivery | no invented configuration |
| `YANDEX_POSTBOX_ACCESS_KEY_ID` | `lib/email/config.ts` | not applicable or missing/error | yes | enabled Postbox delivery | presence only, value always null |
| `YANDEX_POSTBOX_SECRET_ACCESS_KEY` | `lib/email/config.ts` | not applicable or missing/error | yes | enabled Postbox delivery | presence only, value always null |
| `EMAIL_WORKER_BATCH_SIZE` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_MAX_ATTEMPTS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_RETRY_BASE_SECONDS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_RETRY_MAX_SECONDS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROCESSING_LEASE_SECONDS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_REQUEST_TIMEOUT_MS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_CONTENT_RETENTION_DAYS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_ID_RETENTION_DAYS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_RETENTION_DAYS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS` | `lib/email/config.ts` | missing/error | no | always | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED` | `lib/email/config.ts` | missing/error | no | always | disabled-by-design when explicitly false |
| `YANDEX_DATA_STREAMS_ENDPOINT` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | validated HTTPS endpoint |
| `YANDEX_DATA_STREAMS_STREAM_NAME` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | validated stream name/path |
| `YANDEX_DATA_STREAMS_REGION` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | environment only |
| `YANDEX_DATA_STREAMS_ACCESS_KEY_ID` | `lib/email/config.ts` | not applicable or missing/error | yes | ingestion enabled | presence only, value always null |
| `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY` | `lib/email/config.ts` | not applicable or missing/error | yes | ingestion enabled | presence only, value always null |
| `EMAIL_PROVIDER_EVENT_INITIAL_POSITION` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | environment enum |
| `EMAIL_PROVIDER_EVENT_RECORD_LIMIT` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |
| `EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES` | `lib/email/config.ts` | not applicable or missing/error | no | ingestion enabled | bounded environment integer |

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
