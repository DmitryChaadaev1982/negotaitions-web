# Yandex Cloud POC Environment — NegotAItions

## Purpose

POC deployment of NegotAItions web application on Yandex Cloud.

This file stores non-secret infrastructure parameters only.
Do not put passwords, tokens, private keys, OAuth secrets, Voximplant secrets, Yandex API keys, or database passwords here.

---

## Environment

| Parameter | Value |
|---|---|
| Environment | `poc` |
| Cloud provider | `Yandex Cloud` |
| App hostname | `negotaitions-app-poc` |
| Public IP | `130.193.62.91` |
| Primary domain | `negotaitions.ru` |
| WWW domain | `www.negotaitions.ru` |
| App subdomain | `app.negotaitions.ru` |
| SSH user | `deploy` |
| SSH alias on local PC | `negotaitions-poc` |
| SSH command | `ssh negotaitions-poc` |
| Direct SSH command | `ssh deploy@130.193.62.91` |

---

## DNS

Current DNS target:

| Record | Type | Value |
|---|---|---|
| `negotaitions.ru` | `A` | `130.193.62.91` |
| `www.negotaitions.ru` | `CNAME` or `A` | `negotaitions.ru` / `130.193.62.91` |
| `app.negotaitions.ru` | `A` | `130.193.62.91` |

Validation commands from local PC:

```powershell
nslookup negotaitions.ru
nslookup www.negotaitions.ru
nslookup app.negotaitions.ru
curl.exe -I http://negotaitions.ru
curl.exe -I http://www.negotaitions.ru
curl.exe -I http://app.negotaitions.ru