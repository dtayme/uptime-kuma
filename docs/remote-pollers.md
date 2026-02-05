# Remote Pollers Plan

This document captures the phased plan to add support for multiple remote pollers.

## Requirements

- Scale: 3 initial pollers, up to 20.
- Latency: sub‑50ms to central server.
- Connectivity: outbound‑only from pollers.
- Scheduling: pollers pull assignments and cache if central is unreachable.
- Poller offline threshold: 60 seconds.
- Cache retention: user‑definable.
- Deployment: Docker.
- Constraints: reuse existing poller logic and keep modular.

## Step 2: Control Plane

Status:

- [x] Poller registry tables (`poller`, `poller_token`)
- [x] Monitor assignment columns (`poller_mode`, `poller_id`, `poller_region`, `poller_datacenter`, `poller_capability`)
- [x] Control plane API endpoints (`/api/poller/register`, `/api/poller/heartbeat`, `/api/poller/assignments`, `/api/poller/results`)

### Poller Registry (DB)

Table: `poller`

- `id` (uuid, PK)
- `name` (string)
- `region` (string)
- `datacenter` (string, optional)
- `capabilities` (json)
- `version` (string)
- `last_heartbeat_at` (datetime)
- `status` (`online`, `offline`, `degraded`)
- `created_at`, `updated_at`

Table: `poller_token`

- `id` (uuid, PK)
- `poller_id` (fk)
- `hashed_token` (string)
- `expires_at` (datetime)
- `created_at`

### Monitor Assignment

Extend `monitor`:

- `poller_mode` (`auto`, `pinned`, `grouped`)
- `poller_id` (nullable, FK)
- `poller_region` (nullable)
- `poller_datacenter` (nullable)
- `poller_capability` (nullable)

### Assignment Rules

- `auto`: any online poller with capability.
- `grouped`: pollers by region/datacenter.
- `pinned`: fixed `poller_id`.
- Optional failover for offline pollers (configurable).

### Heartbeats

- Pollers heartbeat every 10–15s.
- Mark offline if no heartbeat in 60s.
- Mark degraded if queue backlog exceeds threshold.

### Control Plane API

- `POST /api/poller/register`
- `POST /api/poller/heartbeat`
- `GET /api/poller/assignments`
- `POST /api/poller/results`

### Assignment Versioning

- Central maintains `assignment_version`.
- Pollers pull deltas with `since_version`.
- Pollers cache snapshot locally.

## Step 3: Data Plane

Status:

- [x] SQLite queue schema on poller
- [x] Poller registration + token bootstrap
- [x] Poller assignments pull + local cache
- [x] Batch result upload and heartbeat ingestion
- [x] Poller DNS cache (max TTL + per-monitor opt-out)
- [ ] Access token refresh / rotation
- [ ] Optional mTLS support

### Transport

- HTTPS only.
- Per‑poller short‑lived access token + refresh token.
- Optional future mTLS.

### Result Ingestion

- Batch uploads.
- Validate ownership and assignment scope.
- Store raw results and derived monitor status.

### Poller Execution

- Pull assignment on startup.
- Run local scheduler based on assignment.
- Queue results before upload.
- Poller DNS cache honors a global max TTL (Settings -> Pollers).
- Monitors can opt out of poller DNS cache when needed.
- Poller DNS servers can be overridden via `POLLER_DNS_SERVERS` or Docker `--dns`.
- Poller DNS cache can be shared via Redis (`POLLER_DNS_CACHE_REDIS_URL`).

### SQLite Queue (Poller)

Table: `poller_queue`

- `id` (integer PK)
- `monitor_id`
- `ts`
- `status`
- `latency_ms`
- `msg`
- `meta` (json)
- `attempts`
- `next_retry_at`

Table: `poller_assignments`

- `assignment_version`
- `snapshot_json`
- `updated_at`

Table: `poller_state`

- `last_upload_at`
- `last_heartbeat_at`
- `queue_depth`

### Retry/Backoff

- Exponential backoff: 2s, 5s, 15s, 30s, 60s, 2m, 5m.
- Retention‑bounded retries.
- Prune by retention window.

### Batching

- Flush when `queue_depth >= N` or every `X` seconds.
- Suggested defaults: `N=50`, `X=10s`.

### Failure Modes

- Central unreachable: continue checks and queue.
- Queue exceeds retention: `degraded` poller.
- Stale results: `stale` monitor status.

## Step 4: UI + API Updates

Status:

- [x] Poller settings panel (list + status)
- [x] Registration token support (env or settings)
- [ ] Advanced filters/management UX (region/datacenter filters, rotate/revoke tokens)
- [ ] Friendly poller aliases and ability to delete poller entries from the settings menu (should revoke/disable tokens)
- [ ] Add unit tests for DNS caching and extend poller tests to validate cache behavior

### Poller Management

- Poller list with region/datacenter, status, version, queue depth.
- Registration token creation, revoke, rotate.
- Capability and health visibility.

### Monitor Configuration

- `poller_mode` selection: `auto`, `grouped`, `pinned`.
- Region/datacenter selection for grouped.
- Poller selection for pinned.
- Required capability selection.
- Optional per-monitor poller DNS cache opt-out.

### Monitor Status

- Show poller + last poll time.
- `stale` badge when poller offline > 60s.
- Warnings for delayed data.

## Step 5: Implementation Phases

1. Poller registry + tokens (feature flag off by default).
2. Assignment model + endpoints.
3. Poller runtime with SQLite queue.
4. Central ingestion + derived status.
5. UI + observability.
6. Rollout and gradual enablement.
