# Security Best Practices Report

Executive summary:
CodeQL currently reports 6 open alerts on `master` (latest update 2026-02-05). The highest-impact risks are TLS certificate verification being disabled in the healthcheck scripts and password-related hashing patterns that CodeQL flags as insufficient. Two findings are protocol-driven (NTLM uses MD4/MD5/DES by design) and may require documented risk acceptance or targeted suppression, not algorithm changes. One finding (setup-database rate limiting) appears to be a false positive because a custom limiter is in use, but it is not recognized by CodeQL.

Scope and evidence:
Results pulled from GitHub CodeQL alerts for `dtayme/uptime-kuma-distributed` and validated against local source files. Lines referenced below are from the current workspace.

## High severity findings

SBP-001
Rule ID: js/disabling-certificate-validation
Severity: High
Location: extra/healthcheck-src/healthcheck.js:12 (script main)
Evidence:
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
Impact: Disables TLS certificate validation, enabling man-in-the-middle attacks if this script is used against any HTTPS endpoint.
Fix: Remove the global disable and instead trust the configured certificate by loading `UPTIME_KUMA_SSL_CERT` as a CA for the HTTPS request. Only allow insecure mode via an explicit opt-in env var that defaults off.
Mitigation: If you must keep insecure mode for local dev, gate it behind `UPTIME_KUMA_HEALTHCHECK_INSECURE=1` and log a warning.
False positive notes: The file header indicates this script is deprecated but still referenced; if it is truly unused in production, document and consider excluding it from scans.

SBP-002
Rule ID: go/disabled-certificate-check
Severity: High
Location: extra/healthcheck-src/healthcheck.go:27-28 (main)
Evidence:
http.DefaultTransport.(\*http.Transport).TLSClientConfig = &tls.Config{
InsecureSkipVerify: true,
}
Impact: Disables TLS certificate validation, enabling man-in-the-middle attacks on HTTPS checks.
Fix: Build a custom `http.Transport` with `TLSClientConfig` that uses a CA pool populated from `UPTIME_KUMA_SSL_CERT` (self-signed cert supported) and keep `InsecureSkipVerify` false.
Mitigation: Provide an opt-in `UPTIME_KUMA_HEALTHCHECK_INSECURE=1` switch if local dev absolutely needs it, otherwise fail fast.
False positive notes: The script is intended for local health checks, but it runs in containerized deployments; treat as production reachable unless verified otherwise.

SBP-003
Rule ID: js/insufficient-password-hash
Severity: High
Location: server/util-server.js:835-839 (shake256)
Evidence:
return crypto.createHash("shake256", { outputLength: len }).update(data).digest("hex");
Impact: CodeQL flags this as insufficient password hashing because the input is ultimately derived from `user.password` for JWT validation. If treated as a password hash, it is too fast and vulnerable to offline attacks.
Fix: Replace the JWT “password change” marker with an HMAC keyed by `server.jwtSecret` (or a dedicated server secret), or use a server-side `token_version`/`passwordChangedAt` stored in the DB and embedded in the JWT.
Mitigation: If changing schema is too heavy, use `crypto.createHmac("sha256", server.jwtSecret).update(user.password).digest("hex")` and a constant-time compare.
False positive notes: The input is already a stored password hash, not plaintext. Even so, using a keyed MAC avoids weak-hash signals and improves resistance if tokens are stolen.

SBP-004
Rule ID: js/weak-cryptographic-algorithm
Severity: High
Location: server/modules/axios-ntlm/lib/hash.js:42-64 (createNTLMHash/createNTLMv2Hash)
Evidence:
var md4sum = crypto.createHash("md4");
var hmac = crypto.createHmac("md5", ntlmhash);
Impact: MD4/MD5/DES are broken for general use. In NTLM they are protocol-mandated; using NTLM exposes users to legacy-crypto risk and downgrade concerns.
Fix: Prefer modern auth mechanisms (Kerberos/Negotiate) where possible and make NTLM support explicitly opt-in with clear warnings. If NTLM must remain, document the risk and isolate use to this module.
Mitigation: Consider restricting NTLM usage to trusted networks, and add documentation clarifying it is legacy-only.
False positive notes: This appears to be required by the NTLM protocol; replacing the algorithm would break compatibility.

SBP-005
Rule ID: js/insufficient-password-hash
Severity: High
Location: server/modules/axios-ntlm/lib/hash.js:55-59 (createNTLMHash)
Evidence:
var md4sum = crypto.createHash("md4");
md4sum.update(new Buffer.from(password, "ucs2"));
Impact: MD4 is not suitable for password hashing; in NTLM it is the required password hash and therefore inherits NTLM’s legacy risks.
Fix: Same as SBP-004. Long term, deprecate NTLM use where possible.
Mitigation: Gate NTLM behind explicit configuration and document that it is a legacy protocol.
False positive notes: Protocol-required hashing; safe resolution is documentation and feature gating rather than algorithm replacement.

SBP-006
Rule ID: js/missing-rate-limiting
Severity: High
Location: server/setup-database.js:169-299 (POST /setup-database)
Evidence:
const allowed = await setupRateLimiter.pass((err) => {
response.status(429).json(err);
});
Impact: CodeQL flags missing rate limiting on a DB setup endpoint that performs database access. If the limiter fails or is bypassed, it could be abused for DoS.
Fix: Implement a dedicated Express middleware that wraps `setupRateLimiter` and attach it to the route, or adopt an established middleware like `express-rate-limit` for this endpoint.
Mitigation: Add additional guardrails such as checking `this.runningSetup` early (already present) and enforce a single in-flight setup.
False positive notes: A custom limiter is already in use; CodeQL may not recognize it. A small refactor to a named middleware could both clarify intent and potentially satisfy scanning heuristics.

## Proposed resolution plan

1. Remove TLS verification bypasses in the healthcheck scripts.
   - Implement CA-based trust using `UPTIME_KUMA_SSL_CERT` and keep verification enabled by default.
   - If absolutely required, add an explicit `UPTIME_KUMA_HEALTHCHECK_INSECURE=1` override with loud logging and documentation.

2. Replace the JWT password-change marker hashing.
   - Prefer an HMAC keyed by the server secret or a DB-backed `token_version` so the token invalidates on password change without using a fast hash of `user.password`.
   - Use constant-time compare for the marker.

3. Address NTLM legacy crypto findings.
   - Decide whether NTLM support is required. If not, deprecate/disable.
   - If required, explicitly gate it behind config, document the risk, and consider CodeQL suppression or path-exclusion only for this module with justification.

4. Make setup-database rate limiting unambiguous to CodeQL.
   - Wrap the existing limiter as an Express middleware and attach it to the route.
   - Add a comment describing the rate limiter so future scanners or reviewers understand the protection.

5. Re-run CodeQL and verify no new findings.
   - Confirm the alerts are closed or explicitly dismissed with justification for protocol-required cases.

Report generated on 2026-02-05.
