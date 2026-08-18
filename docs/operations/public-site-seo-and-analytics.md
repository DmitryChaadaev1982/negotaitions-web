# Public-site SEO and analytics

Production canonical host: `https://negotaitions.ru`.

Do not commit a real Metrica counter ID. Yandex Webmaster ownership is already
confirmed externally and does not use an application verification setting.

## URLs

| Resource | Production URL |
| --- | --- |
| Canonical origin | `https://negotaitions.ru` |
| Favicon | `https://negotaitions.ru/favicon.ico` |
| robots.txt | `https://negotaitions.ru/robots.txt` |
| sitemap.xml | `https://negotaitions.ru/sitemap.xml` |
| Open Graph image | `https://negotaitions.ru/opengraph-image` |

RU and EN share the same pathnames. Do not configure hreflang alternates.

## Yandex Webmaster ownership

Ownership of `https://negotaitions.ru` is already confirmed in Yandex
Webmaster using DNS TXT verification. Preserve that existing DNS record.
Application code does not emit `<meta name="yandex-verification">` and does
not require a Webmaster verification environment variable.

After Wave 3 is deployed, use Webmaster only for operational follow-up:

- check `robots.txt`;
- register or confirm `sitemap.xml`;
- submit key public pages for re-crawl;
- review site diagnostics.

Do not add a second ownership-verification mechanism in the application.

## Environment

Supply the optional Metrica counter in application `.env.production` (and keep
the worker env file aligned only if that process serves the Next.js app;
workers do not need this).

```
# Optional. Yandex Metrica counter ID (digits only).
# When empty or invalid, no Metrica script is loaded.
NEXT_PUBLIC_YANDEX_METRICA_ID=
```

`NEXT_PUBLIC_YANDEX_METRICA_ID` is read on the server for the public layout.
It is not treated as a secret and must not be logged as one.

## Analytics consent

Metrica loads only on `/`, `/about`, `/faq`, and `/support`, and only after
the visitor stores `analytics=true` in `negotaitions.cookieConsent.v2`.

Historical `negotaitions.cookieConsent.v1` is ignored. Existing browsers will
see the cookie banner again when this version is deployed.

Webvisor is off. No user identity, session IDs, case names, or custom product
events are sent.

Revoking analytics consent, or leaving the public site so the analytics
component unmounts, calls `ym(id, "destruct")` and stops further hits. It
does not erase data already received by Yandex. The previously downloaded
script may remain in the browser.

## Operator checks after deploy

1. `https://negotaitions.ru/favicon.ico` returns 200 without redirect, login,
   locale, or cookie requirements. Content-Type is `image/x-icon` or
   `image/vnd.microsoft.icon`.
2. Homepage HTML includes a `rel=icon` (or shortcut icon) reference to
   `/favicon.ico`.
3. In Yandex Webmaster: Site optimization / Diagnostics → favicon check.
   A warning may remain until the next crawl; it does not disappear immediately.
   Submit homepage `/` for re-crawl if the diagnostic is stale.
4. `https://negotaitions.ru/robots.txt` contains the production sitemap URL
   and does not disallow `/`, `/about`, `/faq`, `/support`, or `/favicon.ico`.
5. `https://negotaitions.ru/sitemap.xml` lists only those four canonical URLs.
6. Homepage HTML has `rel=canonical` `https://negotaitions.ru/` and is not
   `noindex`.
7. `/privacy` is reachable, `noindex, follow`, and canonical without
   `returnTo`.
8. `/login` and `/dashboard` are `noindex`.
9. Homepage `<head>` does not contain `<meta name="yandex-verification">`.
   Ownership remains the existing DNS TXT record in Webmaster.
10. In Webmaster, confirm robots.txt, sitemap.xml, re-crawl of `/`, `/about`,
    `/faq`, and `/support`, and review site diagnostics.
11. With analytics consent declined or unset, no `mc.yandex.ru` script loads.
12. With analytics consent granted and a counter ID configured, Metrica loads
    on `/` and does not load on `/login` or `/dashboard`.
