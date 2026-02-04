const crypto = require("crypto");
const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { checkLogin } = require("../util-server");
const { Settings } = require("../settings");
const { sendPollerList } = require("../client");
const { buildAssignmentsForPoller } = require("../poller/assignments");
const { log, genSecret } = require("../../src/util");

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
            callback({
                ok: true,
                token,
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
            await Settings.set("pollerRegistrationToken", token);
            callback({
                ok: true,
                token,
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
