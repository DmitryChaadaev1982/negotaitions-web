# Current Client IP Flow

## Call sites (pre-hardening)

Password-reset requests (`POST /api/auth/forgot-password`) previously read:

1. first `X-Forwarded-For` hop
2. otherwise `X-Real-IP`

Registration consent hashing (`app/actions/auth.ts`) used the same pattern and stored a truncated SHA-256 of the raw value.

## Rate-limit use

`ProcessLocalPasswordResetLimiter` keyed IP buckets by `HMAC-SHA256(AUTH_SECRET, rawIp)`.

## Finding

Any browser-supplied forwarding header could change the process-local IP identity. Durable per-account limits remained intact; unknown-email and multi-account IP abuse limits were spoofable.

## Post-hardening flow

1. `getTrustedClientIdentity(headers)` is the only public API.
2. When `TRUSTED_PROXY_ENABLED` is false/unset, identity is the stable `unknown` HMAC bucket.
3. When enabled, only `X-NegotAItions-Client-IP` is accepted after strict normalization.
4. Arbitrary `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP`, and `True-Client-IP` are ignored.
5. Consent storage uses a truncated HMAC fingerprint, not a raw IP hash.
