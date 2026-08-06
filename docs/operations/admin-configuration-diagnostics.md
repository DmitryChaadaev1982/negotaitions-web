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

| Runtime key | Parser/owner | Effective default | Secret | Required condition | Display rule | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `AUTH_SECRET` | `lib/auth/session.ts` / auth runtime | local process fallback outside production contract | yes | production auth | configured/missing only, no value | `admin-env-display.test.ts` |
| `APP_URL` / canonical origin | email/auth origin helpers | none | no | email/reset links and origin policy | configured/derived safe origin | `same-origin.test.ts`, admin diagnostics |
| `TRUSTED_PROXY_ENABLED` | `lib/auth/client-ip.ts` | `false` | no | trusted nginx activation | effective boolean, environment/default source | `client-ip.test.ts`, admin diagnostics |
| `CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS` | credential fence | `5000` | no | password reset/dispatch fence | effective integer default | Stage 3.13C verifier/docs |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | account security config | `30` | no | password reset | effective integer default | `admin-env-display.test.ts` |
| `PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS` | account security config | `60` | no | password reset | effective integer default | `admin-env-display.test.ts` |
| `PASSWORD_RESET_MAX_REQUESTS_PER_HOUR` | account security config | `5` | no | password reset | effective integer default | `admin-env-display.test.ts` |
| `EMAIL_PROVIDER` | `lib/email/config.ts` | `disabled` | no | email runtime | effective provider | `admin-env-display.test.ts` |
| `EMAIL_DELIVERY_ENABLED` | `lib/email/config.ts` | `false` | no | delivery activation | disabled-by-design when false | `admin-env-display.test.ts` |
| `EMAIL_FROM_ADDRESS` | `lib/email/config.ts` | none | no | delivery enabled | missing only when required | email config/tests |
| `EMAIL_PROVIDER_REQUEST_TIMEOUT_MS` | `lib/email/config.ts` | bounded default | no | delivery enabled | effective integer | email foundation tests |
| `EMAIL_WORKER_BATCH_SIZE` | `lib/email/config.ts` | bounded default | no | worker/sweeps | effective integer | email foundation tests |
| `EMAIL_RETENTION_*` | email retention config | bounded defaults | no | retention sweeps | effective defaults | Stage 3.13C tests |
| `EMAIL_SENSITIVE_PAYLOAD_KEY` | sensitive payload config | none | yes | password reset email delivery | configured/missing only, no value | sensitive payload/admin tests |
| `YANDEX_POSTBOX_REGION` | `lib/email/config.ts` | `ru-central1` | no | Postbox readiness | effective default when absent | `admin-env-display.test.ts` |
| `YANDEX_POSTBOX_ENDPOINT` | `lib/email/config.ts` | `https://postbox.cloud.yandex.net` | no | Postbox readiness | effective default when absent | `admin-env-display.test.ts` |
| `YANDEX_POSTBOX_CONFIGURATION_SET` | `lib/email/config.ts` | none | no | only when chosen Postbox strategy uses it | optional/not applicable, never missing solely due to absence | `admin-env-display.test.ts` |
| `YANDEX_POSTBOX_ACCESS_KEY_ID` | `lib/email/config.ts` | none | yes | delivery enabled with Postbox | configured/missing only, no value | admin diagnostics |
| `YANDEX_POSTBOX_SECRET_ACCESS_KEY` | `lib/email/config.ts` | none | yes | delivery enabled with Postbox | configured/missing only, no value | `admin-env-display.test.ts` |
| `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED` | `lib/email/config.ts` | `false` | no | live provider-event ingestion | feature-level disabled-by-design when false | provider consumer/admin tests |
| `YANDEX_DATA_STREAMS_ENDPOINT` | `lib/email/config.ts` | none | no | provider-event ingestion enabled | required only when enabled; HTTPS Yandex endpoint | provider consumer/admin tests |
| `YANDEX_DATA_STREAMS_REGION` | `lib/email/config.ts` | `ru-central1` | no | provider-event readiness | effective default | provider consumer/admin tests |
| `YANDEX_DATA_STREAMS_STREAM_NAME` | `lib/email/config.ts` | none | no | provider-event ingestion enabled | required only when enabled | provider consumer/admin tests |
| `YANDEX_DATA_STREAMS_ACCESS_KEY_ID` | `lib/email/config.ts` | none | yes | provider-event ingestion enabled | configured/missing only, no value | provider consumer/admin tests |
| `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY` | `lib/email/config.ts` | none | yes | provider-event ingestion enabled | configured/missing only, no value | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_INITIAL_POSITION` | `lib/email/config.ts` | `LATEST` | no | provider-event readiness | effective default/enum | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_RECORD_LIMIT` | `lib/email/config.ts` | `100` | no | provider-event readiness | bounded effective integer | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS` | `lib/email/config.ts` | `1000` | no | provider-event readiness | bounded effective integer | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS` | `lib/email/config.ts` | `60` | no | provider-event readiness | bounded effective integer | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS` | `lib/email/config.ts` | `2000` | no | provider-event readiness | bounded effective integer | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES` | `lib/email/config.ts` | `262144` | no | provider-event readiness | bounded effective integer | provider consumer/admin tests |
| `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS` | `lib/email/config.ts` | `15000` | no | provider-event readiness | bounded effective integer | provider consumer/admin tests |

Obsolete, test-only, or currently unconsumed keys are not displayed. Inactive
feature child settings are not reported as missing; the feature receives a
clear disabled/not-applicable status instead.
