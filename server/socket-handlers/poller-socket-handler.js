const crypto = require("crypto");
const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { checkLogin } = require("../util-server");
const { Settings } = require("../settings");
const { sendPollerList } = require("../client");
const { buildAssignmentsForPoller } = require("../poller/assignments");
const { log, genSecret } = require("../../src/util");

const DEFAULT_POLLER_DNS_CACHE_MAX_TTL_SECONDS = 60;
const DEFAULT_REGISTRATION_TOKEN_TTL_MINUTES = 60;

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
 * Hash a token using SHA-256.
 * @param {string} token Raw token
 * @returns {string} SHA-256 hash
 */
function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Handlers for poller management
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.pollerSocketHandler = (socket) => {
    socket.on("getPollerList", async (callback) => {
        try {
            checkLogin(socket);
            await sendPollerList(socket);
            callback({
                ok: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("getPollerRegistrationToken", async (callback) => {
        try {
            checkLogin(socket);
            const token = (await Settings.get("pollerRegistrationToken")) || "";
            let expiresAt = (await Settings.get("pollerRegistrationTokenExpiresAt")) || null;
            if (token && !expiresAt) {
                const ttlMinutes = await getRegistrationTokenTtlMinutes();
                expiresAt = dayjs.utc().add(ttlMinutes, "minute").toISOString();
                await Settings.set("pollerRegistrationTokenExpiresAt", expiresAt);
            }
            callback({
                ok: true,
                token,
                expiresAt,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("getPollerDnsCacheSettings", async (callback) => {
        try {
            checkLogin(socket);
            const rawMaxTtl = await Settings.get("pollerDnsCacheMaxTtlSeconds");
            const parsedMaxTtl = Number.parseInt(rawMaxTtl, 10);
            const maxTtlSeconds =
                Number.isFinite(parsedMaxTtl) && parsedMaxTtl >= 0
                    ? parsedMaxTtl
                    : DEFAULT_POLLER_DNS_CACHE_MAX_TTL_SECONDS;
            callback({
                ok: true,
                maxTtlSeconds,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("setPollerDnsCacheSettings", async (payload, callback) => {
        try {
            checkLogin(socket);
            const parsedMaxTtl = Number.parseInt(payload?.maxTtlSeconds, 10);
            if (!Number.isFinite(parsedMaxTtl) || parsedMaxTtl < 0) {
                throw new Error("Max TTL must be 0 or a positive integer (seconds).");
            }
            await Settings.set("pollerDnsCacheMaxTtlSeconds", parsedMaxTtl);
            callback({
                ok: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("generatePollerRegistrationToken", async (callback) => {
        try {
            checkLogin(socket);
            const token = genSecret(48);
            const ttlMinutes = await getRegistrationTokenTtlMinutes();
            const expiresAt = dayjs.utc().add(ttlMinutes, "minute").toISOString();
            await Settings.set("pollerRegistrationToken", token);
            await Settings.set("pollerRegistrationTokenExpiresAt", expiresAt);
            callback({
                ok: true,
                token,
                expiresAt,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("rotatePollerToken", async (pollerId, callback) => {
        try {
            checkLogin(socket);
            const id = Number.parseInt(pollerId, 10);
            if (Number.isNaN(id)) {
                throw new Error("Invalid poller id");
            }

            await R.exec("UPDATE poller_token SET active = 0 WHERE poller_id = ?", [id]);

            const rawToken = crypto.randomBytes(32).toString("hex");
            const pollerToken = R.dispense("poller_token");
            pollerToken.poller_id = id;
            pollerToken.hashed_token = hashToken(rawToken);
            pollerToken.active = true;
            pollerToken.created_at = R.isoDateTimeMillis(dayjs.utc());
            pollerToken.expires_at = null;
            await R.store(pollerToken);

            await sendPollerList(socket);

            callback({
                ok: true,
                token: rawToken,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("revokePollerTokens", async (pollerId, callback) => {
        try {
            checkLogin(socket);
            const id = Number.parseInt(pollerId, 10);
            if (Number.isNaN(id)) {
                throw new Error("Invalid poller id");
            }

            await R.exec("UPDATE poller_token SET active = 0 WHERE poller_id = ?", [id]);
            log.info("poller", `Revoked tokens for poller ${id}`);

            await sendPollerList(socket);

            callback({
                ok: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("updatePoller", async (payload, callback) => {
        try {
            checkLogin(socket);
            const id = Number.parseInt(payload?.id, 10);
            if (Number.isNaN(id)) {
                throw new Error("Invalid poller id");
            }

            const poller = await R.findOne("poller", "id = ?", [id]);
            if (!poller) {
                throw new Error("Poller not found");
            }

            let updated = false;

            if (payload?.weight !== undefined) {
                const parsedWeight = Number.parseInt(payload.weight, 10);
                if (Number.isNaN(parsedWeight) || parsedWeight <= 0) {
                    throw new Error("Invalid poller weight");
                }
                poller.weight = parsedWeight;
                updated = true;
            }

            if (payload?.capabilities !== undefined) {
                let capabilities = payload.capabilities;
                if (capabilities === null) {
                    capabilities = {};
                }
                if (typeof capabilities === "string") {
                    try {
                        capabilities = JSON.parse(capabilities);
                    } catch {
                        throw new Error("Invalid poller capabilities");
                    }
                }
                if (typeof capabilities !== "object") {
                    throw new Error("Invalid poller capabilities");
                }
                poller.capabilities = JSON.stringify(capabilities);
                updated = true;
            }

            if (!updated) {
                throw new Error("No updates provided");
            }

            poller.updated_at = R.isoDateTimeMillis(dayjs.utc());
            await R.store(poller);

            await sendPollerList(socket);

            callback({
                ok: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("getPollerAssignmentPreview", async (pollerId, callback) => {
        try {
            checkLogin(socket);
            const id = Number.parseInt(pollerId, 10);
            if (Number.isNaN(id)) {
                throw new Error("Invalid poller id");
            }

            const poller = await R.findOne("poller", "id = ?", [id]);
            if (!poller) {
                throw new Error("Poller not found");
            }

            const assignments = await buildAssignmentsForPoller(poller);

            callback({
                ok: true,
                assignments,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });
};
