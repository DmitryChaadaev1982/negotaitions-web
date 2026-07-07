# Cookie & Storage Audit — NegotAItions MVP

**Generated:** 2026-06-25  
**Scope:** `C:\Projects\Negotiations AI\negotiations-web`  
**Auditor:** Phase 6 legal/consent implementation

---

## Summary

NegotAItions MVP uses **one HttpOnly auth cookie**, **one locale preference cookie**, and **two localStorage keys**. There are **no analytics, marketing, or third-party tracking scripts** in the codebase.

---

## 1. Cookies

### 1.1 `auth_session` — **Strictly Necessary**

| Property | Value |
|----------|-------|
| Name | `auth_session` |
| Set by | `lib/auth/session.ts` → `cookieStore.set()` |
| HttpOnly | ✅ Yes |
| Secure | ✅ In production |
| SameSite | `lax` |
| Expires | `expiresAt` (session-lifetime, ~30 days) |
| Value | Opaque random token (hashed to `sessionTokenHash` in DB) |
| Contains PII? | No — token only, hashed server-side |
| Purpose | Authenticates registered users. Required for login/logout/session access. |
| Category | **Strictly Necessary** |

### 1.2 `negotaitions_locale` — **Functional / Strictly Necessary**

| Property | Value |
|----------|-------|
| Name | `negotaitions_locale` |
| Set by | `lib/i18n/useI18n.tsx` → `document.cookie` |
| HttpOnly | No (client-readable, needed for SSR locale selection) |
| Secure | No explicit flag (low-sensitivity preference) |
| SameSite | `lax` |
| Max-Age | 1 year (`31536000`) |
| Value | `"en"` or `"ru"` |
| Contains PII? | No |
| Purpose | Remembers user's chosen display language (RU/EN). |
| Category | **Strictly Necessary / Functional** (language preference; no behavioral tracking) |

---

## 2. localStorage

### 2.1 `negotaitions_locale` — **Functional / Strictly Necessary**

| Property | Value |
|----------|-------|
| Key | `negotaitions_locale` (constant from `lib/i18n/config.ts`) |
| Set by | `lib/i18n/useI18n.tsx` → `localStorage.setItem()` |
| Value | `"en"` or `"ru"` |
| Contains PII? | No |
| Purpose | Mirrors locale cookie for client-side locale switching without page reload. |
| Category | **Strictly Necessary / Functional** |

### 2.2 `negotaitions.recovery.v1` — **Strictly Necessary**

| Property | Value |
|----------|-------|
| Key | `negotaitions.recovery.v1` (constant from `lib/rejoin/recovery-storage.ts`) |
| Set by | `components/join-recovery-sync.tsx` after joining a room |
| TTL | 12 hours (`DEFAULT_RECOVERY_TTL_MS = 12 * 60 * 60 * 1000`) |
| Value | JSON object: `{ hostToken?, participantToken?, joinToken?, displayName?, sessionId, eventId?, expiresAt, version }` |
| Contains PII? | **Contains tokens** — joinToken, participantToken, hostToken, displayName |
| Purpose | Allows guests to rejoin their current session if they accidentally close the tab or get disconnected. Required for guest rejoin UX. |
| Category | **Strictly Necessary** (session continuity for guests; not analytics) |
| Security note | Contains session tokens. Must NOT be included in cookie consent preferences value. Must be cleared on session end / TTL expiry. |

### 2.3 `negotaitions.cookieConsent.v1` — **Consent Record** *(added by Phase 6)*

| Property | Value |
|----------|-------|
| Key | `negotaitions.cookieConsent.v1` |
| Set by | `components/cookie-banner.tsx` (Phase 6) |
| Value | `{ version: 1, necessary: true, analytics: false, marketing: false, updatedAt: "<ISO>" }` |
| Contains PII? | No |
| Purpose | Stores user cookie consent preferences. Necessary is always true. |
| Category | **Strictly Necessary** (stores consent state itself) |
| Does NOT contain | auth tokens, sessionTokenHash, joinToken, hostToken, participantToken, passwordHash |

---

## 3. sessionStorage

**Not used in production code.**

`lib/room-auth.ts` contains a comment explicitly stating `joinToken` must NOT be stored in sessionStorage for account users. No production code writes to sessionStorage.

---

## 4. Analytics / Marketing / Third-party Tracking

**None implemented.**

- No Google Analytics / Google Tag Manager scripts
- No Yandex Metrica scripts
- No Facebook Pixel / LinkedIn Insight Tag / marketing pixels
- No A/B testing tools
- No error tracking (Sentry, Datadog, etc.)
- No heatmap tools (Hotjar, etc.)
- No CDN-loaded third-party JS (except Google Fonts via Next.js font optimization)

**Google Fonts** are loaded via `next/font/google` which downloads and self-hosts font files at build time. No runtime requests to google.com. This does not constitute a cookie or tracking integration.

---

## 5. Classification Summary

| Item | Key / Name | Category | Mandatory |
|------|-----------|----------|-----------|
| Auth session | `auth_session` | Strictly Necessary | Always on |
| Locale cookie | `negotaitions_locale` | Strictly Necessary / Functional | Always on |
| Locale localStorage | `negotaitions_locale` | Strictly Necessary / Functional | Always on |
| Guest recovery | `negotaitions.recovery.v1` | Strictly Necessary | Always on |
| Consent preference | `negotaitions.cookieConsent.v1` | Strictly Necessary | Always on |
| Analytics | — | Analytics | Not implemented |
| Marketing | — | Marketing | Not implemented |

---

## 6. Consent Model

Because **no optional (analytics/marketing) cookies exist**, the consent model is simplified:

- **necessary**: Always `true`, cannot be disabled by user
- **analytics**: Defaults to `false`; no scripts currently gated by this
- **marketing**: Defaults to `false`; no scripts currently gated by this

The `hasCookieConsent(category)` helper in `lib/consent/cookie-consent.ts` provides future-proof gating for analytics/marketing features.

---

## 7. Sensitive Data in Storage — Security Notes

The `negotaitions.recovery.v1` localStorage item **contains session tokens** (`joinToken`, `participantToken`, `hostToken`, `displayName`). These are:
- Used only for guest room rejoin; not authentication tokens
- Cleared after TTL (12 hours)
- Only writable by the same origin
- Must never be included in consent preference storage or transmitted to third parties

---

## 8. TODOs Before Production Launch

- [ ] Confirm cookie policy with legal counsel
- [ ] Add explicit `Secure` and `__Host-` prefix to `auth_session` in production if running on a dedicated domain
- [ ] Review if locale cookie needs `Secure` flag
- [ ] Determine if third-party services (LiveKit, OpenAI, Yandex Object Storage) may set their own cookies — if so, audit separately
- [ ] Decide on session token expiry duration (currently ~30 days)
- [ ] Implement GDPR-compliant cookie consent management if analytics/marketing are added later
- [ ] Consider clearing `negotaitions.recovery.v1` after session completion for privacy hygiene
