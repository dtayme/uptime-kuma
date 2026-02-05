const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("path");
const dayjs = require("dayjs");

dayjs.extend(require("dayjs/plugin/utc"));

const repoRoot = path.resolve(__dirname, "..", "..");

const settingsStore = new Map();
const Settings = {
    get: async (key) => settingsStore.get(key),
    set: async (key, value) => {
        settingsStore.set(key, value);
    },
};

/**
 * Resolve client IP from test headers.
 * @param {string} _remoteAddress Remote address
 * @param {Record<string, string>} headers Request headers
 * @returns {Promise<string>} Client IP
 */
async function getClientIPwithProxy(_remoteAddress, headers) {
    return headers["x-test-ip"] || "127.0.0.1";
}

const stubServer = {
    io: {
        to() {
            return { emit() {} };
        },
    },
    getClientIPwithProxy,
};

const stubUptimeKumaServer = {
    getInstance: () => stubServer,
};

let nextId = 1;
const stubR = {
    dispense() {
        return {};
    },
    isoDateTimeMillis(date) {
        return date.toISOString();
    },
    async store(bean) {
        if (!bean.id) {
            bean.id = nextId++;
        }
        return bean;
    },
    async findOne() {
        return null;
    },
};

const stubMonitor = {
    async getPreviousHeartbeat() {
        return null;
    },
    async isUnderMaintenance() {
        return false;
    },
    isImportantBeat() {
        return true;
    },
    isImportantForNotification() {
        return false;
    },
    async sendNotification() {},
    sendStats() {},
};

const stubUptimeCalculator = {
    async getUptimeCalculator() {
        return {
            async update() {
                return new Date();
            },
        };
    },
};

class StubPrometheus {
    /**
     * No-op metrics update for tests.
     * @returns {void}
     */
    update() {}
}

const stubAssignments = {
    buildAssignmentsForPoller: async () => [],
    computeAssignmentVersion: () => 0,
    parseCapabilities: () => ({}),
    pollerHasCapability: () => true,
};

const stubUtil = {
    log: {
        info() {},
        warn() {},
        error() {},
        debug() {},
    },
    UP: 1,
    DOWN: 0,
    PENDING: 2,
    MAINTENANCE: 3,
    flipStatus(status) {
        return status === 1 ? 0 : 1;
    },
};

/**
 * Register a stub module in Node's require cache.
 * @param {string} modulePath Module path
 * @param {object} exports Module exports
 * @returns {void}
 */
function stubModule(modulePath, exports) {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
    };
}

stubModule(require.resolve("redbean-node"), { R: stubR });
stubModule(path.join(repoRoot, "server", "settings.js"), { Settings });
stubModule(path.join(repoRoot, "server", "uptime-kuma-server.js"), { UptimeKumaServer: stubUptimeKumaServer });
stubModule(path.join(repoRoot, "server", "util-server.js"), {
    sendHttpError(response, msg) {
        response.status(500).json({ ok: false, msg });
    },
});
stubModule(path.join(repoRoot, "server", "model", "monitor.js"), stubMonitor);
stubModule(path.join(repoRoot, "server", "prometheus.js"), { Prometheus: StubPrometheus });
stubModule(path.join(repoRoot, "server", "uptime-calculator.js"), { UptimeCalculator: stubUptimeCalculator });
stubModule(path.join(repoRoot, "server", "poller", "assignments.js"), stubAssignments);
stubModule(path.join(repoRoot, "src", "util.js"), stubUtil);

const router = require(path.join(repoRoot, "server", "routers", "poller-router.js"));

/**
 * Create a test express server with the poller router.
 * @returns {Promise<{server: import("http").Server, request: function}>} Server and request helper
 */
async function createTestServer() {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(router);

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    /**
     * Issue a request against the test server.
     * @param {string} pathname Path
     * @param {RequestInit} options Fetch options
     * @returns {Promise<{status: number, body: object}>} Response payload
     */
    async function request(pathname, options = {}) {
        const res = await fetch(`${baseUrl}${pathname}`, options);
        let body;
        try {
            body = await res.json();
        } catch {
            body = { error: "non-json" };
        }
        return { status: res.status, body };
    }

    return { server, request };
}

test("poller registration rejects expired tokens", async () => {
    process.env.ENABLE_POLLERS = "1";
    settingsStore.clear();
    settingsStore.set("pollerRegistrationToken", "token");
    settingsStore.set("pollerRegistrationTokenExpiresAt", dayjs.utc().subtract(1, "minute").toISOString());

    const { server, request } = await createTestServer();

    try {
        const res = await request("/api/poller/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Poller-Registration-Token": "token",
                "X-Test-IP": "192.0.2.10",
            },
            body: JSON.stringify({}),
        });

        assert.equal(res.status, 403);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.msg, "Registration token expired");
    } finally {
        server.close();
    }
});

test("poller registration sets expiry when missing and succeeds", async () => {
    process.env.ENABLE_POLLERS = "1";
    settingsStore.clear();
    settingsStore.set("pollerRegistrationToken", "token");
    settingsStore.delete("pollerRegistrationTokenExpiresAt");

    const { server, request } = await createTestServer();

    try {
        const res = await request("/api/poller/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Poller-Registration-Token": "token",
                "X-Test-IP": "192.0.2.20",
            },
            body: JSON.stringify({ name: "test-poller" }),
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
        assert.ok(res.body.poller_id);
        assert.ok(res.body.access_token);
        assert.ok(settingsStore.get("pollerRegistrationTokenExpiresAt"));
    } finally {
        server.close();
    }
});

test("poller registration rate limiting blocks repeated attempts", async () => {
    process.env.ENABLE_POLLERS = "1";
    process.env.POLLER_REGISTRATION_RATE_LIMIT_PER_MINUTE = "2";
    settingsStore.clear();
    settingsStore.set("pollerRegistrationToken", "token");
    settingsStore.set("pollerRegistrationTokenExpiresAt", dayjs.utc().add(10, "minute").toISOString());

    const { server, request } = await createTestServer();

    try {
        for (let i = 0; i < 2; i++) {
            const res = await request("/api/poller/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Poller-Registration-Token": "token",
                    "X-Test-IP": "192.0.2.30",
                },
                body: JSON.stringify({}),
            });
            assert.equal(res.status, 200);
        }

        const blocked = await request("/api/poller/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Poller-Registration-Token": "token",
                "X-Test-IP": "192.0.2.30",
            },
            body: JSON.stringify({}),
        });

        assert.equal(blocked.status, 429);
        assert.equal(blocked.body.ok, false);
    } finally {
        server.close();
        delete process.env.POLLER_REGISTRATION_RATE_LIMIT_PER_MINUTE;
    }
});
