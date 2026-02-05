const crypto = require("crypto");
const { R } = require("redbean-node");
const { Settings } = require("../settings");

const DEFAULT_POLLER_DNS_CACHE_MAX_TTL_SECONDS = 60;

/**
 * Parse poller capabilities JSON.
 * @param {string|object|null|undefined} value Capabilities payload
 * @returns {object} Parsed capabilities map
 */
function parseCapabilities(value) {
    if (!value) {
        return {};
    }
    try {
        return typeof value === "string" ? JSON.parse(value) : value;
    } catch {
        return {};
    }
}

/**
 * Check if a poller has the required capability.
 * @param {object} pollerCaps Capabilities map
 * @param {string} required Required capability key
 * @returns {boolean} True when capability is present
 */
function pollerHasCapability(pollerCaps, required) {
    if (!required) {
        return true;
    }
    return Boolean(pollerCaps?.[required]);
}

/**
 * Compute poller selection weight based on configuration and load.
 * @param {object} poller Poller record
 * @returns {number} Weighted score value
 */
function pollerWeight(poller) {
    const parsedWeight = Number.parseFloat(poller.weight);
    const baseWeight = Number.isFinite(parsedWeight) ? parsedWeight : 100;
    let weight = Math.max(baseWeight / 100, 0.05);
    if (poller.status === "degraded") {
        weight *= 0.5;
    }
    const parsedDepth = Number.parseInt(poller.queue_depth, 10);
    const depth = Number.isFinite(parsedDepth) ? parsedDepth : 0;
    weight *= 1 / (1 + Math.max(0, depth));
    return Math.max(weight, 0.05);
}

/**
 * Hash a string to a [0,1] unit interval.
 * @param {string} value Input string
 * @returns {number} Normalized hash value
 */
function hashToUnit(value) {
    const digest = crypto.createHash("sha1").update(value).digest();
    const int = digest.readUInt32BE(0);
    return int / 0xffffffff;
}

/**
 * Select the target poller for a monitor using weighted hashing.
 * @param {object} monitor Monitor record
 * @param {object[]} pollers Candidate pollers
 * @returns {number|null} Selected poller id
 */
function selectPollerIdForMonitor(monitor, pollers) {
    if (!pollers.length) {
        return null;
    }

    let bestId = null;
    let bestScore = -1;

    for (const poller of pollers) {
        const weight = pollerWeight(poller);
        const score = hashToUnit(`${monitor.id}:${poller.id}`) * weight;
        if (score > bestScore) {
            bestScore = score;
            bestId = poller.id;
        }
    }

    return bestId;
}

/**
 * Compute a stable assignment version for a poller.
 * @param {object[]} assignments Assignment list
 * @returns {number} Deterministic version number
 */
function computeAssignmentVersion(assignments) {
    const payload = JSON.stringify(assignments || []);
    const digest = crypto.createHash("sha1").update(payload).digest("hex").slice(0, 8);
    return Number.parseInt(digest, 16);
}

/**
 * Build a monitor config payload for the poller.
 * @param {object} monitor Monitor record
 * @returns {object} Monitor configuration payload
 */
function buildMonitorConfig(monitor, options = {}) {
    const { pollerDnsCacheMaxTtlSeconds } = options;
    return {
        url: monitor.url,
        hostname: monitor.hostname,
        port: monitor.port,
        method: monitor.method,
        body: monitor.body,
        headers: monitor.headers,
        keyword: monitor.keyword,
        invertKeyword: monitor.invertKeyword,
        timeout: monitor.timeout,
        maxretries: monitor.maxretries,
        retryInterval: monitor.retryInterval,
        resendInterval: monitor.resendInterval,
        ignoreTls: monitor.ignoreTls,
        upsideDown: monitor.upsideDown,
        packetSize: monitor.packetSize,
        ping_count: monitor.ping_count,
        ping_numeric: monitor.ping_numeric,
        ping_per_request_timeout: monitor.ping_per_request_timeout,
        dns_resolve_type: monitor.dns_resolve_type,
        dns_resolve_server: monitor.dns_resolve_server,
        mqttTopic: monitor.mqttTopic,
        mqttSuccessMessage: monitor.mqttSuccessMessage,
        mqttCheckType: monitor.mqttCheckType,
        mqttUsername: monitor.mqttUsername,
        mqttPassword: monitor.mqttPassword,
        mqttWebsocketPath: monitor.mqttWebsocketPath,
        databaseConnectionString: monitor.databaseConnectionString,
        databaseQuery: monitor.databaseQuery,
        authMethod: monitor.authMethod,
        grpcUrl: monitor.grpcUrl,
        grpcProtobuf: monitor.grpcProtobuf,
        grpcMethod: monitor.grpcMethod,
        grpcServiceName: monitor.grpcServiceName,
        grpcEnableTls: monitor.grpcEnableTls,
        radiusUsername: monitor.radiusUsername,
        radiusPassword: monitor.radiusPassword,
        radiusSecret: monitor.radiusSecret,
        game: monitor.game,
        gamedigGivenPortOnly: monitor.gamedigGivenPortOnly,
        jsonPath: monitor.jsonPath,
        jsonPathOperator: monitor.jsonPathOperator,
        expectedValue: monitor.expectedValue,
        accepted_statuscodes_json: monitor.accepted_statuscodes_json,
        snmpOid: monitor.snmpOid,
        snmpVersion: monitor.snmpVersion,
        snmp_v3_username: monitor.snmp_v3_username,
        conditions: monitor.conditions,
        pollerDnsCacheDisabled: monitor.pollerDnsCacheDisabled ?? monitor.poller_dns_cache_disabled ?? false,
        pollerDnsCacheMaxTtlSeconds: pollerDnsCacheMaxTtlSeconds ?? DEFAULT_POLLER_DNS_CACHE_MAX_TTL_SECONDS,
    };
}

/**
 * Normalize poller mode value.
 * @param {string|null|undefined} mode Poller mode
 * @returns {string} Normalized mode value
 */
function normalizePollerMode(mode) {
    return mode || "local";
}

/**
 * Build assignments list for a poller.
 * @param {object} poller Poller record
 * @returns {Promise<object[]>} Assignment list
 */
async function buildAssignmentsForPoller(poller) {
    const rawMaxTtl = await Settings.get("pollerDnsCacheMaxTtlSeconds");
    const parsedMaxTtl = Number.parseInt(rawMaxTtl, 10);
    const pollerDnsCacheMaxTtlSeconds =
        Number.isFinite(parsedMaxTtl) && parsedMaxTtl >= 0 ? parsedMaxTtl : DEFAULT_POLLER_DNS_CACHE_MAX_TTL_SECONDS;
    const pollers = await R.find("poller");
    const onlinePollers = pollers.filter((p) => p.status !== "offline");
    const pollerCaps = parseCapabilities(poller.capabilities);

    const monitors = await R.find("monitor", " active = 1 AND poller_mode IS NOT NULL AND poller_mode != 'local' ");

    const assignments = [];

    for (const monitor of monitors) {
        const mode = normalizePollerMode(monitor.pollerMode ?? monitor.poller_mode);
        if (mode === "local") {
            continue;
        }

        const requiredCapability = monitor.pollerCapability ?? monitor.poller_capability;
        if (!pollerHasCapability(pollerCaps, requiredCapability)) {
            continue;
        }

        if (mode === "pinned") {
            const pinnedId = monitor.pollerId ?? monitor.poller_id;
            if (pinnedId !== poller.id) {
                continue;
            }
        } else if (mode === "grouped") {
            const region = monitor.pollerRegion ?? monitor.poller_region;
            const datacenter = monitor.pollerDatacenter ?? monitor.poller_datacenter;
            const candidates = onlinePollers.filter((p) => {
                if (region && p.region !== region) {
                    return false;
                }
                if (datacenter && p.datacenter !== datacenter) {
                    return false;
                }
                const caps = parseCapabilities(p.capabilities);
                return pollerHasCapability(caps, requiredCapability);
            });
            const assignedId = selectPollerIdForMonitor(monitor, candidates);
            if (assignedId !== poller.id) {
                continue;
            }
        } else {
            const candidates = onlinePollers.filter((p) => {
                const caps = parseCapabilities(p.capabilities);
                return pollerHasCapability(caps, requiredCapability);
            });
            const assignedId = selectPollerIdForMonitor(monitor, candidates);
            if (assignedId !== poller.id) {
                continue;
            }
        }

        assignments.push({
            monitor_id: monitor.id,
            interval: monitor.interval,
            type: monitor.type,
            config: buildMonitorConfig(monitor, { pollerDnsCacheMaxTtlSeconds }),
        });
    }

    assignments.sort((a, b) => a.monitor_id - b.monitor_id);

    return assignments;
}

module.exports = {
    buildAssignmentsForPoller,
    computeAssignmentVersion,
    parseCapabilities,
    pollerHasCapability,
    pollerWeight,
};
