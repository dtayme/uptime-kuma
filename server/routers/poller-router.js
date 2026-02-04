const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { sendHttpError } = require("../util-server");
const { Settings } = require("../settings");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const Monitor = require("../model/monitor");
const { Prometheus } = require("../prometheus");
const { UptimeCalculator } = require("../uptime-calculator");
const {
    buildAssignmentsForPoller,
    computeAssignmentVersion,
    parseCapabilities,
    pollerHasCapability,
} = require("../poller/assignments");
const { log, UP, DOWN, PENDING, MAINTENANCE, flipStatus } = require("../../src/util");

const router = express.Router();
const server = UptimeKumaServer.getInstance();
const io = server.io;

/**
 * Check if pollers are enabled.
 * @returns {boolean} True when pollers are enabled
 */
function pollersEnabled() {
    return process.env.ENABLE_REMOTE_POLLERS === "1" || process.env.ENABLE_POLLERS === "1";
}

/**
 * Extract registration token from request.
 * @param {import("express").Request} request Incoming request
 * @returns {string} Registration token
 */
function getRegistrationToken(request) {
    return request.headers["x-poller-registration-token"] || request.body?.registration_token || "";
}

/**
 * Hash a token using SHA-256.
 * @param {string} token Raw token
 * @returns {string} SHA-256 hash
 */
function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Get current UTC time in ISO format.
 * @returns {string} ISO timestamp
 */
function nowIso() {
    return R.isoDateTimeMillis(dayjs.utc());
}

/**
 * Normalize poller mode.
 * @param {string|null|undefined} mode Poller mode value
 * @returns {string} Normalized mode
 */
function normalizePollerMode(mode) {
    return mode || "local";
}

/**
 * Parse result status value into enum value.
 * @param {string|number|null|undefined} statusValue Incoming status value
 * @returns {number|null} Parsed status enum
 */
function parseResultStatus(statusValue) {
    if (statusValue === undefined || statusValue === null) {
        return null;
    }
    if (typeof statusValue === "number") {
        return statusValue;
    }
    const normalized = String(statusValue).toLowerCase();
    if (normalized === "up") {
        return UP;
    }
    if (normalized === "down") {
        return DOWN;
    }
    if (normalized === "pending") {
        return PENDING;
    }
    if (normalized === "maintenance") {
        return MAINTENANCE;
    }
    return null;
}

/**
 * Compute heartbeat status with retries handling.
 * @param {number} status Parsed status
 * @param {object|null} previousHeartbeat Previous heartbeat row
 * @param {number} maxretries Max retries
 * @param {boolean} isUpsideDown Upside down flag
 * @param {object} bean Heartbeat bean
 * @returns {void}
 */
function determineStatus(status, previousHeartbeat, maxretries, isUpsideDown, bean) {
    let nextStatus = status;
    if (isUpsideDown) {
        nextStatus = flipStatus(status);
    }

    if (previousHeartbeat) {
        if (previousHeartbeat.status === UP && nextStatus === DOWN) {
            if (maxretries > 0 && previousHeartbeat.retries < maxretries) {
                bean.retries = previousHeartbeat.retries + 1;
                bean.status = PENDING;
            } else {
                bean.retries = 0;
                bean.status = DOWN;
            }
        } else if (previousHeartbeat.status === PENDING && nextStatus === DOWN && previousHeartbeat.retries < maxretries) {
            bean.retries = previousHeartbeat.retries + 1;
            bean.status = PENDING;
        } else {
            if (nextStatus === DOWN) {
                bean.retries = previousHeartbeat.retries + 1;
                bean.status = nextStatus;
            } else {
                bean.retries = 0;
                bean.status = nextStatus;
            }
        }
    } else {
        if (nextStatus === DOWN && maxretries > 0) {
            bean.retries = 1;
            bean.status = PENDING;
        } else {
            bean.retries = 0;
            bean.status = nextStatus;
        }
    }
}

/**
 * Apply a poller result to a monitor heartbeat.
 * @param {object} poller Poller record
 * @param {object} result Result payload
 * @returns {Promise<void>}
 */
async function processPollerResult(poller, result) {
    const monitorIdRaw = result.monitor_id ?? result.monitorId;
    const monitorId = Number.parseInt(monitorIdRaw, 10);
    if (Number.isNaN(monitorId)) {
        throw new Error("Invalid monitor id");
    }

    const monitor = await R.findOne("monitor", " id = ? ", [monitorId]);
    if (!monitor) {
        throw new Error(`Monitor ${monitorId} not found`);
    }

    const mode = normalizePollerMode(monitor.pollerMode ?? monitor.poller_mode);
    if (mode === "local") {
        throw new Error(`Monitor ${monitorId} is not assigned to a poller`);
    }

    const requiredCapability = monitor.pollerCapability ?? monitor.poller_capability;
    const pollerCaps = parseCapabilities(poller.capabilities);
    if (!pollerHasCapability(pollerCaps, requiredCapability)) {
        throw new Error(`Poller lacks required capability for monitor ${monitorId}`);
    }

    if (mode === "pinned") {
        const pinnedId = monitor.pollerId ?? monitor.poller_id;
        if (pinnedId !== poller.id) {
            throw new Error(`Monitor ${monitorId} is pinned to another poller`);
        }
    } else if (mode === "grouped") {
        const region = monitor.pollerRegion ?? monitor.poller_region;
        const datacenter = monitor.pollerDatacenter ?? monitor.poller_datacenter;
        if (region && poller.region !== region) {
            throw new Error(`Poller region mismatch for monitor ${monitorId}`);
        }
        if (datacenter && poller.datacenter !== datacenter) {
            throw new Error(`Poller datacenter mismatch for monitor ${monitorId}`);
        }
    }

    const previousHeartbeat = await Monitor.getPreviousHeartbeat(monitorId);
    const isFirstBeat = !previousHeartbeat;

    let bean = R.dispense("heartbeat");
    const rawTime = result.ts ?? result.time;
    let time = dayjs.utc();
    if (rawTime !== undefined && rawTime !== null) {
        const parsed = dayjs(rawTime);
        if (parsed.isValid()) {
            time = parsed.utc();
        }
    }

    bean.time = R.isoDateTimeMillis(time);
    bean.monitor_id = monitorId;
    const latency = result.ping ?? result.latency_ms ?? result.latencyMs;
    if (latency !== undefined && latency !== null) {
        const ping = Number.parseFloat(latency);
        if (!Number.isNaN(ping)) {
            bean.ping = ping;
        }
    }
    bean.msg = result.msg || result.message || "OK";
    bean.downCount = previousHeartbeat?.downCount || 0;

    if (previousHeartbeat) {
        bean.duration = dayjs(bean.time).diff(dayjs(previousHeartbeat.time), "second");
    }

    const statusValue = parseResultStatus(result.status);

    if (await Monitor.isUnderMaintenance(monitorId)) {
        bean.msg = "Monitor under maintenance";
        bean.status = MAINTENANCE;
    } else if (statusValue === MAINTENANCE || statusValue === PENDING) {
        bean.status = statusValue;
    } else if (statusValue !== null) {
        determineStatus(statusValue, previousHeartbeat, monitor.maxretries, monitor.isUpsideDown(), bean);
    } else {
        throw new Error(`Invalid status for monitor ${monitorId}`);
    }

    const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorId);
    let endTimeDayjs = await uptimeCalculator.update(bean.status, parseFloat(bean.ping));
    bean.end_time = R.isoDateTimeMillis(endTimeDayjs);

    bean.important = Monitor.isImportantBeat(isFirstBeat, previousHeartbeat?.status, bean.status);

    if (Monitor.isImportantForNotification(isFirstBeat, previousHeartbeat?.status, bean.status)) {
        bean.downCount = 0;
        log.debug("monitor", `[${monitor.name}] sendNotification`);
        await Monitor.sendNotification(isFirstBeat, monitor, bean);
    } else if (bean.status === DOWN && monitor.resendInterval > 0) {
        ++bean.downCount;
        if (bean.downCount >= monitor.resendInterval) {
            log.debug(
                "monitor",
                `[${monitor.name}] sendNotification again: Down Count: ${bean.downCount} | Resend Interval: ${monitor.resendInterval}`
            );
            await Monitor.sendNotification(isFirstBeat, monitor, bean);
            bean.downCount = 0;
        }
    }

    await R.store(bean);

    io.to(monitor.user_id).emit("heartbeat", bean.toJSON());
    Monitor.sendStats(io, monitor.id, monitor.user_id);

    try {
        new Prometheus(monitor, []).update(bean, undefined);
    } catch (error) {
        log.error("prometheus", "Poller Prometheus update error: ", error.message);
    }
}

/**
 * Express middleware to validate poller auth.
 * @param {import("express").Request} request Incoming request
 * @param {import("express").Response} response Response object
 * @param {import("express").NextFunction} next Next middleware
 * @returns {Promise<void>}
 */
async function requirePollerAuth(request, response, next) {
    if (!pollersEnabled()) {
        return response.status(404).json({ ok: false, msg: "Pollers are disabled" });
    }

    const authHeader = request.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const altToken = request.headers["x-poller-token"];
    const rawToken = token || altToken || "";

    if (!rawToken) {
        return response.status(401).json({ ok: false, msg: "Missing poller token" });
    }

    const tokenHash = hashToken(rawToken);
    const pollerToken = await R.findOne("poller_token", "hashed_token = ? AND active = 1", [tokenHash]);
    if (!pollerToken) {
        return response.status(401).json({ ok: false, msg: "Invalid poller token" });
    }
    if (pollerToken.expires_at && dayjs.utc(pollerToken.expires_at).isBefore(dayjs.utc())) {
        return response.status(401).json({ ok: false, msg: "Poller token expired" });
    }

    const poller = await R.findOne("poller", "id = ?", [pollerToken.poller_id]);
    if (!poller) {
        return response.status(401).json({ ok: false, msg: "Unknown poller" });
    }

    pollerToken.last_used_at = nowIso();
    await R.store(pollerToken);

    request.poller = poller;
    request.pollerToken = pollerToken;
    next();
}

router.post("/api/poller/register", async (request, response) => {
    try {
        if (!pollersEnabled()) {
            return response.status(404).json({ ok: false, msg: "Pollers are disabled" });
        }

        const registrationSecret =
            process.env.POLLER_REGISTRATION_TOKEN || (await Settings.get("pollerRegistrationToken")) || "";
        if (!registrationSecret) {
            return response.status(503).json({ ok: false, msg: "Registration is disabled" });
        }

        const providedToken = getRegistrationToken(request);
        if (!providedToken || providedToken !== registrationSecret) {
            return response.status(403).json({ ok: false, msg: "Invalid registration token" });
        }

        const payload = request.body || {};
        const now = nowIso();
        const pollerBean = R.dispense("poller");
        pollerBean.name = payload.name || `poller-${Date.now()}`;
        pollerBean.region = payload.region || "local";
        pollerBean.datacenter = payload.datacenter || "";
        const capabilities =
            typeof payload.capabilities === "string" ? payload.capabilities : JSON.stringify(payload.capabilities || {});
        pollerBean.capabilities = capabilities;
        pollerBean.version = payload.version || "";
        pollerBean.status = "offline";
        pollerBean.queue_depth = 0;
        pollerBean.assignment_version = 0;
        pollerBean.weight = 100;
        pollerBean.created_at = now;
        pollerBean.updated_at = now;
        await R.store(pollerBean);

        const rawToken = crypto.randomBytes(32).toString("hex");
        const pollerToken = R.dispense("poller_token");
        pollerToken.poller_id = pollerBean.id;
        pollerToken.hashed_token = hashToken(rawToken);
        pollerToken.active = true;
        pollerToken.created_at = now;
        pollerToken.expires_at = null;
        await R.store(pollerToken);

        log.info("poller", `Registered poller ${pollerBean.id}`);

        return response.json({
            ok: true,
            poller_id: pollerBean.id,
            access_token: rawToken,
        });
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.post("/api/poller/heartbeat", requirePollerAuth, async (request, response) => {
    try {
        const payload = request.body || {};
        const poller = request.poller;
        const status = ["online", "degraded", "offline"].includes(payload.status) ? payload.status : "online";

        poller.last_heartbeat_at = nowIso();
        poller.status = status;
        const parsedQueueDepth = Number.parseInt(payload.queue_depth, 10);
        poller.queue_depth = Number.isNaN(parsedQueueDepth) ? poller.queue_depth : parsedQueueDepth;
        poller.version = payload.version || poller.version;
        poller.region = payload.region || poller.region;
        poller.datacenter = payload.datacenter || poller.datacenter;
        if (payload.capabilities) {
            poller.capabilities =
                typeof payload.capabilities === "string" ? payload.capabilities : JSON.stringify(payload.capabilities);
        }
        poller.updated_at = nowIso();

        await R.store(poller);

        return response.json({
            ok: true,
            assignment_version: poller.assignment_version || 0,
        });
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/poller/assignments", requirePollerAuth, async (request, response) => {
    try {
        const poller = request.poller;
        poller.last_assignment_pull_at = nowIso();
        poller.updated_at = nowIso();
        await R.store(poller);

        const assignments = await buildAssignmentsForPoller(poller);
        const version = computeAssignmentVersion(assignments);
        const sinceVersion = request.query?.since_version ? Number.parseInt(request.query.since_version, 10) : null;

        if (poller.assignment_version !== version) {
            poller.assignment_version = version;
            poller.updated_at = nowIso();
            await R.store(poller);
        }

        return response.json({
            ok: true,
            assignment_version: version,
            assignments: sinceVersion === version ? [] : assignments,
        });
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.post("/api/poller/results", requirePollerAuth, async (request, response) => {
    try {
        const poller = request.poller;
        const payload = request.body || {};
        const results = Array.isArray(payload.results) ? payload.results : [];

        let accepted = 0;
        const errors = [];

        for (const result of results) {
            try {
                await processPollerResult(poller, result);
                accepted += 1;
            } catch (error) {
                errors.push({
                    monitor_id: result?.monitor_id ?? result?.monitorId ?? null,
                    client_id: result?.client_id ?? result?.clientId ?? null,
                    msg: error.message,
                });
            }
        }

        poller.last_results_at = nowIso();
        poller.updated_at = nowIso();
        await R.store(poller);

        return response.json({
            ok: true,
            accepted,
            errors,
        });
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

module.exports = router;
