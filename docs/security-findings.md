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
Status: Open
Scope: `server/routers/api-router.js`, `src/pages/EditMonitor.vue`, `src/util.ts`
Recommendation: add per-IP rate limiting, prefer POST with token in header, and optionally allow server-side token rotation.

**Finding 4 (Medium): Sensitive notification/settings stored unencrypted**
Status: Open
Scope: `server/notification.js`, `server/settings.js`
Recommendation: encrypt sensitive fields at rest (KMS or app-level key) and document backup handling.

**Finding 5 (Medium): Poller registration token has no rate limit**
Status: Open
Scope: `server/routers/poller-router.js`
Recommendation: rate-limit registration, log failed attempts, optionally add IP allowlists or time-limited tokens.

**Finding 6 (Low): Status page logo upload has no size limit**
Status: Open
Scope: `server/socket-handlers/status-page-socket-handler.js`, `server/server.js` (public `/upload`)
Recommendation: enforce max size and reject oversized payloads before decode/write.

**Finding 7 (Low): Missing CSP/Referrer-Policy/Permissions-Policy headers**
Status: Open
Scope: `server/server.js`
Recommendation: add `helmet` with a tailored CSP and standard security headers.

**Finding 8 (Low): Rate limiting is global, not per IP/user**
Status: Open
Scope: `server/rate-limiter.js`, `server/auth.js`
Recommendation: key limits by IP and/or username.
