# Nginx Header Flow

Sanitized read-only inspection on 2026-08-05.

## Hosts

| Role | Host | Notes |
|------|------|-------|
| Public app VM | `130.193.62.91` (`negotaitions-app-poc`) | Active `negotaitions-poc`, nginx → `127.0.0.1:3000` |
| Reverse-tunnel gateway | `172.29.172.1` (`r1184253`) | Public `local.negotaitions.ru` via `91.149.255.127` |

## Production app VM (`negotaitions-poc` vhost)

Current directives (sanitized):

- `proxy_pass http://127.0.0.1:3000`
- `proxy_set_header Host $host`
- `proxy_set_header X-Real-IP $remote_addr` (overwrite)
- `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` (append)
- `proxy_set_header X-Forwarded-Proto $scheme`
- Upgrade/Connection for WebSocket compatibility
- timeouts 300s

Server names include `app.negotaitions.ru`, `negotaitions.ru`, `www.negotaitions.ru`.

## Local reverse tunnel

Gateway nginx for `local.negotaitions.ru`:

- `proxy_pass http://127.0.0.1:3300`
- Host / X-Forwarded-Host / Proto set
- `X-Forwarded-For $proxy_add_x_forwarded_for` (append)
- no dedicated application IP header

App-VM also has a local-dev vhost pointing at `127.0.0.1:3100` (stale when tunnel inactive; observed 502).

## Target change

Repository snippet: `deploy/nginx/trusted-client-ip-snippet.conf`

Overwrite:

- `X-NegotAItions-Client-IP $remote_addr`
- `X-Real-IP $remote_addr`
- `X-Forwarded-For $remote_addr`
- `X-Forwarded-Proto $scheme`
- `X-Forwarded-Host $host`

Do not activate remotely in this stage.
