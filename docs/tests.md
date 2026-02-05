# Tests

This document summarizes the test suites in this repo and how to run them.  
When new tests are added or behavior changes (env flags, required services, etc.), update this file.

**Backend (Node.js test runner)**
Run all backend tests:
`npm run test-backend`

Run a subset:
`npx cross-env TEST_BACKEND=1 node --test --test-reporter=spec test/backend-test/<file-or-glob>`

Long-running stress tests:
Set `TEST_LONG=1` to enable opt-in stress tests (for example the year-long `UptimeCalculator` simulation).

Backend test locations:

- `test/backend-test/*.js` core backend/unit tests
- `test/backend-test/monitors/*.js` monitor-type tests
- `test/backend-test/poller/*.js` poller logic and integration tests

**Backend Tests (Core)**

- `test/backend-test/check-translations.test.js` translation key coverage and placeholder checks
- `test/backend-test/test-auth-rate-limiter.js` rate limiter behavior keyed per user/IP
- `test/backend-test/test-cert-hostname-match.js` TLS hostname validation
- `test/backend-test/test-domain.js` domain expiry parsing and notification behavior
- `test/backend-test/test-globalping.js` Globalping monitor adapter behavior
- `test/backend-test/test-migration.js` DB migrations for SQLite/MariaDB/MySQL
- `test/backend-test/test-monitor-response.js` monitor response storage and truncation
- `test/backend-test/test-poller-registration.js` poller registration flow
- `test/backend-test/test-push-endpoint.js` push API token behaviors and rate limiting
- `test/backend-test/test-security-headers.js` CSP/referrer/permissions headers via helmet
- `test/backend-test/test-snmp.js` SNMP monitor behavior
- `test/backend-test/test-status-page-logo-size.js` status page logo upload size limits
- `test/backend-test/test-status-page.js` status page rendering helpers
- `test/backend-test/test-system-service.js` system service monitor behavior
- `test/backend-test/test-uptime-calculator.js` uptime calculator correctness and long-run simulation
- `test/backend-test/test-util-server.js` server utility helpers
- `test/backend-test/test-util.js` shared utility helpers

**Backend Tests (Monitors)**

- `test/backend-test/monitors/test-gamedig.js` GameDig monitor behavior
- `test/backend-test/monitors/test-grpc.js` gRPC keyword monitor behavior
- `test/backend-test/monitors/test-mqtt.js` MQTT monitor behavior
- `test/backend-test/monitors/test-mssql.js` MSSQL monitor behavior
- `test/backend-test/monitors/test-mysql.js` MySQL/MariaDB monitor behavior
- `test/backend-test/monitors/test-postgres.js` Postgres monitor behavior
- `test/backend-test/monitors/test-rabbitmq.js` RabbitMQ monitor behavior
- `test/backend-test/monitors/test-tcp.js` TCP/SSL monitor behavior
- `test/backend-test/monitors/test-websocket.js` WebSocket monitor behavior

**Backend Tests (Poller)**

- `test/backend-test/poller/test-api-client.js` poller API client behavior
- `test/backend-test/poller/test-assignments.js` poller assignment logic
- `test/backend-test/poller/test-executor.js` poller execution pipeline
- `test/backend-test/poller/test-integration-mqtt.js` MQTT integration via poller
- `test/backend-test/poller/test-integration-mssql.js` MSSQL integration via poller
- `test/backend-test/poller/test-integration-mysql.js` MySQL integration via poller
- `test/backend-test/poller/test-integration-postgres.js` Postgres integration via poller
- `test/backend-test/poller/test-integration-snmp.js` SNMP integration via poller
- `test/backend-test/poller/test-queue.js` poller queue behavior
- `test/backend-test/poller/test-scheduler.js` poller scheduler behavior

**E2E (Playwright)**
Run end-to-end tests:
`npm run test-e2e`

The Playwright config lives at `config/playwright.config.js` and spins up the app on `http://localhost:30001`.

**E2E Tests**

- `test/e2e/specs/example.spec.js` example smoke flow
- `test/e2e/specs/fridendly-name.spec.js` friendly name UI behavior
- `test/e2e/specs/incident-history.spec.js` incident history UI behavior
- `test/e2e/specs/monitor-form.spec.js` monitor creation/edit flow
- `test/e2e/specs/setup-process.once.js` first-run setup flow
- `test/e2e/specs/status-page.spec.js` status page UI behavior

**Notes**

- Some suites rely on external services or containers (e.g., database or broker tests). Check their test files for setup details.
- CI may skip long-running tests by default; use `TEST_LONG=1` locally to opt in.
