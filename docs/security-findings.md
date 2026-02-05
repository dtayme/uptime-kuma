# Security Findings Tracker

Last updated: 2026-02-05

**Finding 1 (High): Container runs as root + sudo for nscd**
Status: Partial
Scope: `docker/dockerfile`, `docker/debian-base.dockerfile`, `docker/etc/sudoers`, `server/uptime-kuma-server.js`
Recommendation: set `USER node` in the release stage (or run rootless by default), and remove or narrow sudo usage. If DNS caching is needed, use an entrypoint/init or sidecar instead of sudo inside the app.
Progress:

- [x] Remove nscd/sudo packages and app-level nscd controls (commit 8c6783a5).
- [ ] Set `USER node` in release stage or adopt rootless default.

**Finding 2 (Medium): WebSocket origin validation bypass**
Status: Mitigated
Scope: `server/uptime-kuma-server.js`
Recommendation: validate `Origin` against an allowlist (e.g., configured base URL) and use `x-forwarded-host` when `trustProxy` is enabled. Consider stricter defaults.
Notes:

- Implemented allowlist using `primaryBaseURL` plus `webSocketAllowedOrigins`, with a fallback to `Host`/`X-Forwarded-Host` when configuration is missing.
- Caveat: leaving the allowlist empty keeps the compatibility fallback, which is less strict than a hard allowlist.

**Finding 3 (Medium): Push endpoint token exposure + no rate limit**
Status: Mitigated
Scope: `server/routers/api-router.js`, `src/pages/EditMonitor.vue`, `src/util.ts`
Recommendation: add per-IP rate limiting, prefer POST with token in header, and optionally allow server-side token rotation.
Notes:

- Added per-IP rate limiting on push requests and a header-based token flow (`X-Push-Token` or `Authorization: Bearer`) with `POST /api/push`.
- Caveat: legacy URL-token push requests remain for compatibility; tokens in URLs can still leak via logs/referers if used.

**Finding 4 (Medium): Sensitive notification/settings stored unencrypted**
Status: Open
Scope: `server/notification.js`, `server/settings.js`
Recommendation: encrypt sensitive fields at rest (KMS or app-level key) and document backup handling.
Notes:

- Open question: the operational overhead of encryption/decryption may not be justified if the stored data is not critical enough.

**Finding 5 (Medium): Poller registration token is a shared secret with no rate limiting; a leaked token allows unauthorized poller registration and results submission.**
Status: Mitigated
Scope: `server/routers/poller-router.js`
Recommendation: rate-limit registration, log failed attempts, optionally add IP allowlists or time-limited tokens.
Notes:

- Added per-IP registration rate limiting with configurable limits and warning logs on failures.
- Registration tokens now expire by default (TTL minutes), with optional overrides for TTL or explicit expiry.

**Finding 6 (Low): Status page logo upload has no size limit**
Status: Mitigated
Scope: `server/socket-handlers/status-page-socket-handler.js`, `server/server.js` (public `/upload`)
Recommendation: enforce max size and reject oversized payloads before decode/write.
Notes:

- Status page logo uploads now enforce a configurable max size for data URI PNGs (default 1MB).

**Finding 7 (Low): Missing CSP/Referrer-Policy/Permissions-Policy headers**
Status: Mitigated
Scope: `server/server.js`
Recommendation: add `helmet` with a tailored CSP and standard security headers.
Notes:

- Added Helmet with a tailored CSP plus Referrer-Policy and Permissions-Policy headers.

**Finding 8 (Low): Rate limiting is global, not per IP/user**
Status: Mitigated
Scope: `server/rate-limiter.js`, `server/auth.js`
Recommendation: key limits by IP and/or username.
Notes:

- Auth rate limiting now keys by client IP and username for API and basic auth flows.
