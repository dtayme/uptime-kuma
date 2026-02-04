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
- `POLLER_REGION` (default: `local`)
- `POLLER_DATACENTER`
- `POLLER_CAPABILITIES_JSON` (default: `{}`)
- `POLLER_DB_PATH` (default: `./poller-data/poller.sqlite`)
- `POLLER_HEARTBEAT_INTERVAL_SECONDS` (default: `15`)
- `POLLER_ASSIGNMENTS_INTERVAL_SECONDS` (default: `30`)
- `POLLER_UPLOAD_INTERVAL_SECONDS` (default: `10`)
- `POLLER_SCHEDULER_INTERVAL_SECONDS` (default: `5`)
- `POLLER_QUEUE_RETENTION_SECONDS` (default: `86400`)

## Notes

- The poller currently runs in a safe "idle" mode if no `POLLER_ID` or `POLLER_TOKEN`
  is provided. It will initialize the local queue DB but will not attempt to call
  central APIs.
- This is an initial scaffold to be expanded as the control plane and data plane
  APIs are implemented.
