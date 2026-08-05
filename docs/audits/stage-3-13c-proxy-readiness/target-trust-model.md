# Target Trust Model

## One-proxy model (preferred)

Public internet → nginx → Next.js on `127.0.0.1:3000`.

Nginx overwrites:

```nginx
proxy_set_header X-NegotAItions-Client-IP $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

Application:

- `TRUSTED_PROXY_ENABLED=true` only after nginx overwrite is live
- reads only `X-NegotAItions-Client-IP`
- rejects multi-value / malformed / hostname / port values
- HMAC-SHA-256 fingerprints for rate-limit and consent identifiers
- never logs raw IP

## Local development

- `TRUSTED_PROXY_ENABLED=false`
- unknown bucket for all clients
- local reverse tunnel remains supported via Host-based same-origin when nginx sets `Host`

## Invalid configuration

Unrecognized `TRUSTED_PROXY_ENABLED` values fail closed to the unknown bucket at identity extraction time.

## Future activation prerequisites

1. Backup nginx site files
2. Apply snippet to production and tunnel vhosts
3. `nginx -t`
4. Safe reload
5. Set production `TRUSTED_PROXY_ENABLED=true`
6. Spoof-header verification
7. Rollback plan ready
