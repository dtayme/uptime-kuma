<div align="center" width="100%">
    <img src="./public/icon.svg" width="128" alt="Uptime Kuma Distributed Logo" />
</div>

# Uptime Kuma Distributed

Uptime Kuma Distributed is an easy-to-use self-hosted monitoring tool, forked from Uptime Kuma by Louis Lam.

<a target="_blank" href="https://github.com/dtayme/uptime-kuma-distributed"><img src="https://img.shields.io/github/stars/dtayme/uptime-kuma-distributed?style=flat" /></a> <a target="_blank" href="https://hub.docker.com/r/fognetx/uptime-kuma-distributed"><img src="https://img.shields.io/docker/pulls/fognetx/uptime-kuma-distributed" /></a> <a target="_blank" href="https://hub.docker.com/r/fognetx/uptime-kuma-distributed"><img src="https://img.shields.io/docker/v/fognetx/uptime-kuma-distributed?label=docker%20image%20ver." /></a> <a target="_blank" href="https://github.com/dtayme/uptime-kuma-distributed"><img src="https://img.shields.io/github/last-commit/dtayme/uptime-kuma-distributed" /></a>
<a href="https://weblate.kuma.pet/projects/uptime-kuma/uptime-kuma/"></a>

[![Auto Test](https://github.com/dtayme/uptime-kuma-distributed/actions/workflows/auto-test.yml/badge.svg)](https://github.com/dtayme/uptime-kuma-distributed/actions/workflows/auto-test.yml)

## ⭐ Features

- Distributed monitoring with a central server and remote pollers for scale and network segmentation
- Poller assignment modes per monitor: local, auto, grouped (region/datacenter), or pinned to a specific poller
- Poller management controls: registration tokens with TTL, rotate/revoke tokens, per-poller weight and capabilities, assignment previews
- Poller DNS cache with optional Redis backing and per-monitor opt-out for fast-changing records
- Dedicated poller runtime and Docker image for remote execution
- Monitoring uptime for HTTP(s) / TCP / HTTP(s) Keyword / HTTP(s) Json Query / Websocket / Ping / DNS Record / Push / Steam Game Server / Docker Containers
- Fancy, Reactive, Fast UI/UX
- Notifications via Telegram, Discord, Gotify, Slack, Pushover, Email (SMTP), and [90+ notification services, click here for the full list](https://github.com/dtayme/uptime-kuma-distributed/tree/master/src/components/notifications)
- 20-second intervals
- [Multi Languages](https://github.com/dtayme/uptime-kuma-distributed/tree/master/src/lang)
- Multiple status pages
- Map status pages to specific domains
- Ping chart
- Certificate info
- Proxy support
- 2FA support

### Security Posture

Uptime Kuma Distributed favors secure defaults and explicit controls. Healthchecks verify TLS by default, sensitive tokens can be rotated or revoked (including poller registration), and setup entry points are rate-limited. Code scanning is enabled with documented exceptions, and hardening notes are captured in the repository so operational decisions remain visible.

- [GitHub Issues](https://github.com/dtayme/uptime-kuma-distributed/issues)

For upstream project discussions, see the Uptime Kuma subreddit.

- [Subreddit (r/UptimeKuma)](https://www.reddit.com/r/UptimeKuma/)

### Test Beta Version

Check out the latest beta release here: <https://github.com/dtayme/uptime-kuma-distributed/releases>

### Bug Reports / Feature Requests

If you want to report a bug or request a new feature, feel free to open a [new issue](https://github.com/dtayme/uptime-kuma-distributed/issues).

### WebSocket Origin Check

WebSocket connections validate the `Origin` header against the configured **Primary Base URL**.  
You can add extra allowed origins in Settings -> General (comma-separated).  
If you run behind a reverse proxy, ensure it forwards `X-Forwarded-Host` and enable `trustProxy` in settings.  
If no base URL is configured, the server falls back to matching against the request host.

### Push Monitor Tokens

Prefer `POST /api/push` with the token in `X-Push-Token` or `Authorization: Bearer` to avoid exposing tokens in URLs.  
Legacy URL-token push endpoints remain available for compatibility.

### Healthcheck TLS Verification

Healthcheck scripts now verify TLS certificates by default when HTTPS is enabled.
If you use a self-signed certificate, set `UPTIME_KUMA_SSL_CERT` to either the CA file path or a PEM string so the healthcheck can trust it.
For local or emergency use only, you can disable verification by setting `UPTIME_KUMA_HEALTHCHECK_INSECURE=1` (not recommended for production).

### NTLM Legacy Crypto

NTLM authentication requires legacy algorithms (MD4/MD5/DES) for protocol compatibility.
Use NTLM only when required and in trusted environments; prefer modern authentication mechanisms when available.

### Translations

If you want to translate Uptime Kuma Distributed into your language, please visit [Weblate Readme](src/lang/README.md).

### Spelling & Grammar

Feel free to correct the grammar in the documentation or code.
