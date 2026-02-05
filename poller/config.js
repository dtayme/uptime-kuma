const path = require("path");

/**
 * Parse an integer-like value or return fallback.
 * @param {string|number|null|undefined} value Value to parse
 * @param {number} fallback Fallback value
 * @returns {number} Parsed integer value
 */
function parseNumber(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse JSON or return fallback.
 * @param {string|object|null|undefined} value JSON string or object
 * @param {any} fallback Fallback value
 * @returns {any} Parsed JSON value
 */
function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/**
 * Parse a comma-delimited list.
 * @param {string|null|undefined} value List value
 * @returns {string[]} Parsed list
 */
function parseList(value) {
    if (!value) {
        return [];
    }

    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/**
 * Load poller configuration from environment variables.
 * @returns {object} Poller configuration object
 */
function loadConfig() {
    return {
        centralUrl: process.env.POLLER_SERVER_URL || "http://localhost:3001",
        pollerId: process.env.POLLER_ID || null,
        accessToken: process.env.POLLER_TOKEN || null,
        registrationToken: process.env.POLLER_REGISTRATION_TOKEN || null,
        region: process.env.POLLER_REGION || "local",
        datacenter: process.env.POLLER_DATACENTER || "",
        capabilities: parseJson(process.env.POLLER_CAPABILITIES_JSON, {}),
        dbPath: process.env.POLLER_DB_PATH || path.resolve(process.cwd(), "poller-data", "poller.sqlite"),
        dnsServers: parseList(process.env.POLLER_DNS_SERVERS),
        heartbeatIntervalMs: parseNumber(process.env.POLLER_HEARTBEAT_INTERVAL_SECONDS, 15) * 1000,
        assignmentsIntervalMs: parseNumber(process.env.POLLER_ASSIGNMENTS_INTERVAL_SECONDS, 30) * 1000,
        uploadIntervalMs: parseNumber(process.env.POLLER_UPLOAD_INTERVAL_SECONDS, 10) * 1000,
        schedulerIntervalMs: parseNumber(process.env.POLLER_SCHEDULER_INTERVAL_SECONDS, 5) * 1000,
        queueRetentionSeconds: parseNumber(process.env.POLLER_QUEUE_RETENTION_SECONDS, 86400),
        batchSize: parseNumber(process.env.POLLER_UPLOAD_BATCH_SIZE, 50),
    };
}

module.exports = {
    loadConfig,
};
