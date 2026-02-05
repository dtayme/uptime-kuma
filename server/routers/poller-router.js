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
const { RateLimiter } = require("limiter");
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
const registrationRateLimiters = new Map();
const DEFAULT_REGISTRATION_RATE_LIMIT_PER_MINUTE = 10;
const REGISTRATION_RATE_LIMIT_INTERVAL = "minute";
const REGISTRATION_RATE_LIMIT_MAX_ENTRIES = 5000;
const REGISTRATION_RATE_LIMIT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REGISTRATION_TOKEN_TTL_MINUTES = 60;
let cachedEnvRegistrationTokenExpiresAt = null;

/**
 * Parse a non-negative integer setting.
 * @param {string|number|null|undefined} value Raw value
 * @returns {number|null} Parsed integer or null
 */
function parseNonNegativeInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return null;
}

/**
 * Parse a positive integer setting.
 * @param {string|number|null|undefined} value Raw value
 * @returns {number|null} Parsed integer or null
 */
function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return null;
}

/**
 * Get registration rate limit per minute from env or settings.
 * @returns {Promise<number>} Rate limit per minute (0 to disable)
 */
async function getRegistrationRateLimitPerMinute() {
    const envValue = parseNonNegativeInt(process.env.POLLER_REGISTRATION_RATE_LIMIT_PER_MINUTE);
    if (envValue !== null) {
        return envValue;
    }
    const settingValue = parseNonNegativeInt(await Settings.get("pollerRegistrationRateLimitPerMinute"));
    if (settingValue !== null) {
        return settingValue;
    }
    return DEFAULT_REGISTRATION_RATE_LIMIT_PER_MINUTE;
}

/**
 * Get registration token TTL in minutes.
 * @returns {Promise<number>} TTL in minutes
 */
async function getRegistrationTokenTtlMinutes() {
    const envValue = parsePositiveInt(process.env.POLLER_REGISTRATION_TOKEN_TTL_MINUTES);
    if (envValue !== null) {
        return envValue;
    }
    const settingValue = parsePositiveInt(await Settings.get("pollerRegistrationTokenTtlMinutes"));
    if (settingValue !== null) {
        return settingValue;
    }
    return DEFAULT_REGISTRATION_TOKEN_TTL_MINUTES;
}

/**
 * Resolve registration token and expiry.
 * @returns {Promise<{token: string, expiresAt: string|null, source: string}>} Token details
 */
async function getRegistrationTokenDetails() {
    const envToken = process.env.POLLER_REGISTRATION_TOKEN;
    if (envToken) {
        const expiresAt = await getEnvRegistrationTokenExpiresAt();
        return {
            token: envToken,
            expiresAt,
            source: "env",
        };
    }

    const token = (await Settings.get("pollerRegistrationToken")) || "";
    let expiresAt = (await Settings.get("pollerRegistrationTokenExpiresAt")) || null;
    if (token && !expiresAt) {
        const ttlMinutes = await getRegistrationTokenTtlMinutes();
        expiresAt = dayjs.utc().add(ttlMinutes, "minute").toISOString();
        await Settings.set("pollerRegistrationTokenExpiresAt", expiresAt);
    }
    return {
        token,
        expiresAt,
        source: "settings",
    };
}

/**
 * Resolve expiry for env registration token.
 * @returns {Promise<string|null>} Expiry timestamp in ISO format
 */
async function getEnvRegistrationTokenExpiresAt() {
    if (cachedEnvRegistrationTokenExpiresAt) {
        return cachedEnvRegistrationTokenExpiresAt;
    }

    const envExpiresAt = process.env.POLLER_REGISTRATION_TOKEN_EXPIRES_AT;
    if (envExpiresAt) {
        const parsed = dayjs.utc(envExpiresAt);
        if (parsed.isValid()) {
            cachedEnvRegistrationTokenExpiresAt = parsed.toISOString();
            return cachedEnvRegistrationTokenExpiresAt;
        }
        log.warn("poller", "Invalid POLLER_REGISTRATION_TOKEN_EXPIRES_AT value");
    }

    const ttlMinutes = await getRegistrationTokenTtlMinutes();
    cachedEnvRegistrationTokenExpiresAt = dayjs.utc().add(ttlMinutes, "minute").toISOString();
    return cachedEnvRegistrationTokenExpiresAt;
}

/**
 * Ensure a rate limiter entry for a given IP.
 * @param {string} ip Client IP
 * @param {number} tokensPerInterval Tokens per minute
 * @returns {RateLimiter} Rate limiter instance
 */
function getRegistrationRateLimiter(ip, tokensPerInterval) {
    const now = Date.now();
    let entry = registrationRateLimiters.get(ip);

    if (entry && now - entry.lastSeen > REGISTRATION_RATE_LIMIT_TTL_MS) {
        registrationRateLimiters.delete(ip);
        entry = null;
    }

    if (!entry || entry.tokensPerInterval !== tokensPerInterval) {
        entry = {
            limiter: new RateLimiter({
                tokensPerInterval,
                interval: REGISTRATION_RATE_LIMIT_INTERVAL,
                fireImmediately: true,
            }),
            lastSeen: now,
            tokensPerInterval,
        };
        registrationRateLimiters.set(ip, entry);
    } else {
        entry.lastSeen = now;
    }

    if (registrationRateLimiters.size > REGISTRATION_RATE_LIMIT_MAX_ENTRIES) {
        for (const [key, value] of registrationRateLimiters) {
            if (now - value.lastSeen > REGISTRATION_RATE_LIMIT_TTL_MS) {
                registrationRateLimiters.delete(key);
            }
            if (registrationRateLimiters.size <= REGISTRATION_RATE_LIMIT_MAX_ENTRIES) {
                break;
            }
        }
    }

    return entry.limiter;
}

/**
 * Enforce per-IP rate limiting for poller registration.
 * @param {import("express").Request} request Incoming request
 * @param {import("express").Response} response Response object
 * @returns {Promise<boolean>} True if allowed
 */
async function checkRegistrationRateLimit(request, response) {
    const limit = await getRegistrationRateLimitPerMinute();
    if (limit === 0) {
        return true;
    }

    const clientIP = await server.getClientIPwithProxy(
        request.socket?.remoteAddress || request.connection?.remoteAddress,
        request.headers
    );
    const limiter = getRegistrationRateLimiter(clientIP || "unknown", limit);
    const remaining = await limiter.removeTokens(1);
    if (remaining < 0) {
        log.warn("poller", `Poller registration rate limit exceeded (${clientIP || "unknown"})`);
        response.status(429).json({ ok: false, msg: "Too frequently, try again later." });
        return false;
    }
    return true;
}

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
        } else if (
            previousHeartbeat.status === PENDING &&
            nextStatus === DOWN &&
            previousHeartbeat.retries < maxretries
        ) {
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

        if (!(await checkRegistrationRateLimit(request, response))) {
            return;
        }

        const { token: registrationSecret, expiresAt, source } = await getRegistrationTokenDetails();
        if (!registrationSecret) {
            return response.status(503).json({ ok: false, msg: "Registration is disabled" });
        }

        if (expiresAt && dayjs.utc(expiresAt).isBefore(dayjs.utc())) {
            log.warn("poller", `Poller registration token expired (${source})`);
            return response.status(403).json({ ok: false, msg: "Registration token expired" });
        }

        const providedToken = getRegistrationToken(request);
        if (!providedToken || providedToken !== registrationSecret) {
            const clientIP = await server.getClientIPwithProxy(
                request.socket?.remoteAddress || request.connection?.remoteAddress,
                request.headers
            );
            log.warn("poller", `Invalid poller registration token (${clientIP || "unknown"})`);
            return response.status(403).json({ ok: false, msg: "Invalid registration token" });
        }

        const payload = request.body || {};
        const now = nowIso();
        const pollerBean = R.dispense("poller");
        pollerBean.name = payload.name || `poller-${Date.now()}`;
        pollerBean.region = payload.region || "local";
        pollerBean.datacenter = payload.datacenter || "";
        const capabilities =
            typeof payload.capabilities === "string"
                ? payload.capabilities
                : JSON.stringify(payload.capabilities || {});
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
