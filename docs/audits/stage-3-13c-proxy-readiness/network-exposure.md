# Network Exposure

Sanitized read-only inspection on 2026-08-05 (app VM `130.193.62.91`).

## Listening sockets (relevant)

- `0.0.0.0:80` / `[::]:80` — nginx
- `0.0.0.0:443` / `[::]:443` — nginx
- `*:3000` — `next-server` (all interfaces before Stage 3.13C-P bind fix)
- SSH on 22

External probe of `http://130.193.62.91:3000/` timed out (UFW blocks).

## UFW

Active, default deny incoming. Allowed: 22/tcp, 80/tcp, 443/tcp (IPv4/IPv6).

## systemd

- Unit: `negotaitions-poc`
- `WorkingDirectory=/var/www/negotaitions/app`
- `ExecStart=/usr/bin/npm run start`
- `EnvironmentFile=.../.env.production`
- No `TRUSTED_PROXY_*` keys present at inspection time
- Email delivery remains inactive (`EMAIL_PROVIDER` present; Postbox activation not done)

## Application bind hardening in this stage

`package.json` `start` now uses `next start -H 127.0.0.1` so future deploys bind localhost only. Not applied to production in this stage.

## Tunnel differences

Tunnel gateway exposes nginx publicly and forwards to SSH reverse port `3300`. Developer machine binds Next.js locally. Trust boundary is gateway nginx `$remote_addr`, not browser headers.
