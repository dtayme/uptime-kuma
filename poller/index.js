const path = require("path");

const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { openDatabase } = require("./db");
const {
    initSchema,
    queueDepth,
    pruneExpired,
    loadAssignments,
    saveAssignments,
    enqueueResult,
    dequeueBatch,
    markDelivered,
    updateRetry,
} = require("./queue");
const { PollerApiClient } = require("./api-client");
const { Scheduler } = require("./scheduler");
const { executeAssignment } = require("./executor");

const config = loadConfig();
const log = createLogger("poller");

const packageJsonPath = path.resolve(__dirname, "..", "package.json");
const appVersion = require(packageJsonPath).version;

const db = openDatabase(config.dbPath);
initSchema(db);

const apiClient = new PollerApiClient({
    baseUrl: config.centralUrl,
    accessToken: config.accessToken,
    pollerId: config.pollerId,
});

const scheduler = new Scheduler({
    logger: log,
    executeAssignment,
    enqueueResult: (record) => enqueueResult(db, record),
});

log.info(`Poller scaffold starting (version ${appVersion})`);
log.info(`Central URL: ${config.centralUrl}`);
log.info(`Queue DB: ${config.dbPath}`);
if (config.dnsServers && config.dnsServers.length) {
    log.info(`DNS servers: ${config.dnsServers.join(", ")}`);
}
if (process.env.POLLER_DNS_CACHE_REDIS_URL) {
    log.info("DNS cache: Redis enabled");
}

let isConfigured = Boolean(config.pollerId && config.accessToken);
if (!isConfigured && config.registrationToken) {
    log.info("Registration token provided. Attempting poller registration.");
}
if (!isConfigured && !config.registrationToken) {
    log.warn("POLLER_ID or POLLER_TOKEN not set. Running in idle mode.");
}

let assignmentVersion = null;
const cachedAssignments = loadAssignments(db);
if (cachedAssignments) {
    assignmentVersion = cachedAssignments.assignmentVersion;
    scheduler.updateAssignments(cachedAssignments.assignments);
}

/**
 * Send poller heartbeat to the central server.
 * @returns {Promise<void>}
 */
async function heartbeat() {
    if (!isConfigured) {
        await attemptRegistration();
        return;
    }

    const payload = {
        poller_id: config.pollerId,
        region: config.region,
        datacenter: config.datacenter,
        version: appVersion,
        queue_depth: queueDepth(db),
        capabilities: config.capabilities,
        status: "online",
    };

    try {
        await apiClient.heartbeat(payload);
    } catch (error) {
        log.warn(`Heartbeat failed: ${error.message}`);
    }
}

/**
 * Attempt poller registration if configured.
 * @returns {Promise<void>}
 */
async function attemptRegistration() {
    if (isConfigured || !config.registrationToken) {
        return;
    }

    try {
        const response = await apiClient.registerPoller(
            {
                name: `poller-${Date.now()}`,
                region: config.region,
                datacenter: config.datacenter,
                capabilities: config.capabilities,
                version: appVersion,
            },
            config.registrationToken
        );

        if (response?.poller_id && response?.access_token) {
            config.pollerId = response.poller_id;
            config.accessToken = response.access_token;
            apiClient.pollerId = response.poller_id;
            apiClient.accessToken = response.access_token;
            isConfigured = true;
            log.info(`Registered poller as ${response.poller_id}`);
        }
    } catch (error) {
        log.warn(`Registration failed: ${error.message}`);
    }
}

/**
 * Refresh assignments from the central server.
 * @returns {Promise<void>}
 */
async function refreshAssignments() {
    if (!isConfigured) {
        await attemptRegistration();
        return;
    }

    try {
        const response = await apiClient.fetchAssignments(assignmentVersion);
        if (response && response.assignment_version !== undefined) {
            assignmentVersion = response.assignment_version;
            if (Array.isArray(response.assignments)) {
                saveAssignments(db, assignmentVersion, { assignments: response.assignments });
                scheduler.updateAssignments(response.assignments);
            }
        }
    } catch (error) {
        log.warn(`Assignment refresh failed: ${error.message}`);
    }
}

/**
 * Perform periodic maintenance tasks.
 * @returns {void}
 */
function maintenance() {
    pruneExpired(db, config.queueRetentionSeconds);
}

/**
 * Upload queued results to the central server.
 * @returns {Promise<void>}
 */
async function uploadQueue() {
    if (!isConfigured) {
        return;
    }

    const batch = dequeueBatch(db, config.batchSize);
    if (!batch.length) {
        return;
    }

    const results = batch.map((row) => ({
        client_id: row.id,
        monitor_id: row.monitor_id,
        ts: row.ts,
        status: row.status,
        latency_ms: row.latency_ms,
        msg: row.msg,
        meta: row.meta ? JSON.parse(row.meta) : undefined,
    }));

    try {
        const response = await apiClient.postResults(results);
        const errorIds = new Set(
            Array.isArray(response?.errors)
                ? response.errors.map((entry) => entry.client_id).filter((id) => id !== null && id !== undefined)
                : []
        );

        const deliveredIds = batch.filter((row) => !errorIds.has(row.id)).map((row) => row.id);
        markDelivered(db, deliveredIds);

        if (errorIds.size > 0) {
            const failedRows = batch.filter((row) => errorIds.has(row.id));
            for (const row of failedRows) {
                const attempts = (row.attempts || 0) + 1;
                const delaySeconds = backoffSeconds(attempts);
                updateRetry(db, row.id, attempts, Date.now() + delaySeconds * 1000);
            }
        }
    } catch (error) {
        for (const row of batch) {
            const attempts = (row.attempts || 0) + 1;
            const delaySeconds = backoffSeconds(attempts);
            updateRetry(db, row.id, attempts, Date.now() + delaySeconds * 1000);
        }
        log.warn(`Result upload failed: ${error.message}`);
    }
}

/**
 * Calculate retry backoff delay in seconds.
 * @param {number} attempts Attempt count
 * @returns {number} Delay in seconds
 */
function backoffSeconds(attempts) {
    const delays = [2, 5, 15, 30, 60, 120, 300];
    const index = Math.min(attempts - 1, delays.length - 1);
    return delays[index];
}

setInterval(() => {
    heartbeat();
}, config.heartbeatIntervalMs);

setInterval(() => {
    refreshAssignments();
}, config.assignmentsIntervalMs);

setInterval(() => {
    maintenance();
}, Math.max(config.uploadIntervalMs, 10000));

scheduler.start(config.schedulerIntervalMs);

setInterval(() => {
    uploadQueue();
}, config.uploadIntervalMs);

attemptRegistration();
heartbeat();
refreshAssignments();
