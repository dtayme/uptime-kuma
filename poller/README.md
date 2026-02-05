# Remote Poller (Scaffold)

This directory contains the initial scaffold for the remote poller runtime. It is not
fully functional yet, but provides the structure for configuration, local queueing,
and API plumbing.

## Quick Start (Local Dev)

```bash
node poller/index.js
```

## Docker

Build the poller image:

```bash
docker build -f docker/poller.dockerfile -t fognetx/uptimekuma:poller .
```

Run the poller with registration (recommended for first start):

```bash
docker run --rm \
  -e POLLER_SERVER_URL=https://central.example.com \
  -e POLLER_REGISTRATION_TOKEN=replace-with-registration-token \
  -e POLLER_REGION=us-east \
  -e POLLER_DATACENTER=dc-1 \
  -e POLLER_CAPABILITIES_JSON='{"http":true,"icmp":true,"tcp":true,"dns":true}' \
  -v poller-data:/app/poller-data \
  fognetx/uptimekuma:poller
```

Run the poller with an existing token:

```bash
docker run --rm \
  -e POLLER_SERVER_URL=https://central.example.com \
  -e POLLER_ID=1 \
  -e POLLER_TOKEN=replace-with-access-token \
  -e POLLER_REGION=us-east \
  -v poller-data:/app/poller-data \
  fognetx/uptimekuma:poller
```

Optional environment variables:

- `POLLER_SERVER_URL` (default: `http://localhost:3001`)
- `POLLER_ID`
- `POLLER_TOKEN`
- `POLLER_REGISTRATION_TOKEN`
- `POLLER_REGISTRATION_TOKEN_TTL_MINUTES` (default: `60`)
- `POLLER_REGISTRATION_TOKEN_EXPIRES_AT` (optional ISO timestamp, overrides TTL)
- `POLLER_REGISTRATION_RATE_LIMIT_PER_MINUTE` (default: `10`, set `0` to disable)
- `POLLER_REGION` (default: `local`)
- `POLLER_DATACENTER`
- `POLLER_CAPABILITIES_JSON` (default: `{}`)
- `POLLER_DB_PATH` (default: `./poller-data/poller.sqlite`)
- `POLLER_DNS_SERVERS` (comma-delimited list of upstream DNS servers for poller lookups)
- `POLLER_DNS_CACHE_REDIS_URL` (optional Redis URL to store DNS cache entries)
- `POLLER_DNS_CACHE_REDIS_PREFIX` (optional Redis key prefix, default: `poller:dns-cache:`)
- `POLLER_HEARTBEAT_INTERVAL_SECONDS` (default: `15`)
- `POLLER_ASSIGNMENTS_INTERVAL_SECONDS` (default: `30`)
- `POLLER_UPLOAD_INTERVAL_SECONDS` (default: `10`)
- `POLLER_SCHEDULER_INTERVAL_SECONDS` (default: `5`)
- `POLLER_QUEUE_RETENTION_SECONDS` (default: `86400`)

## How To Use (Central + Poller)

1. Start central with pollers enabled and a registration token.

```bash
docker run --rm \
  -e ENABLE_POLLERS=1 \
  -e POLLER_REGISTRATION_TOKEN=replace-with-registration-token \
  -p 3001:3001 \
  -v uptimekuma-data:/app/data \
  fognetx/uptimekuma:nightly
```

2. Register the poller (first run) to receive `poller_id` and `access_token`.

```bash
docker run --rm \
  -e POLLER_SERVER_URL=http://host.docker.internal:3001 \
  -e POLLER_REGISTRATION_TOKEN=replace-with-registration-token \
  -e POLLER_REGION=us-east \
  -v poller-data:/app/poller-data \
  fognetx/uptimekuma:poller
```

3. Run the poller using the returned credentials.

```bash
docker run --rm \
  -e POLLER_SERVER_URL=http://host.docker.internal:3001 \
  -e POLLER_ID=1 \
  -e POLLER_TOKEN=replace-with-access-token \
  -e POLLER_REGION=us-east \
  -v poller-data:/app/poller-data \
  fognetx/uptimekuma:poller
```

Notes:

- You can also set the registration token in Settings -> Pollers instead of the env var.
- If you are running central and poller in the same Docker network, use the service name for `POLLER_SERVER_URL`.
- Registration tokens expire (default: 60 minutes). Regenerate a new token if the poller cannot register.

## DNS Settings

- Poller DNS caching is controlled from Settings -> Pollers (max TTL seconds). Set to `0` to disable caching.
- Each monitor can opt out of poller DNS caching in the monitor editor (useful for rapidly changing DNS records).
- To override upstream DNS servers, set `POLLER_DNS_SERVERS` or configure Docker with `--dns`.
- To share cache entries across pollers, set `POLLER_DNS_CACHE_REDIS_URL` so lookups are stored in Redis.

Example with Docker DNS override:

```bash
docker run --rm \
  --dns 1.1.1.1 \
  --dns 8.8.8.8 \
  -e POLLER_SERVER_URL=https://central.example.com \
  -e POLLER_REGISTRATION_TOKEN=replace-with-registration-token \
  -v poller-data:/app/poller-data \
  fognetx/uptimekuma:poller
```

## ICMP Ping Privileges

ICMP ping requires raw socket privileges. Granting `CAP_NET_RAW` (or setting `cap_net_raw` on `/bin/ping`)
allows ICMP checks to run without full root, but it still expands the network‑level attack surface. Even in a
rootless container, raw sockets can be abused for scanning or crafted traffic within the container network.

Options to address this:

- Prefer TCP/HTTP checks when possible (no extra privileges required).
- Use a small sidecar ping proxy with `CAP_NET_RAW` and keep the poller container unprivileged.
- If you must allow ICMP directly, add only `CAP_NET_RAW`, keep the filesystem read‑only, and drop all other caps.

## Notes

- The poller currently runs in a safe "idle" mode if no `POLLER_ID` or `POLLER_TOKEN`
  is provided. It will initialize the local queue DB but will not attempt to call
  central APIs.
- This is an initial scaffold to be expanded as the control plane and data plane
  APIs are implemented.
