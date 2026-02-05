const basicAuth = require("express-basic-auth");
const passwordHash = require("./password-hash");
const { R } = require("redbean-node");
const { setting } = require("./util-server");
const { log } = require("../src/util");
const { loginRateLimiter, apiRateLimiter } = require("./rate-limiter");
const { Settings } = require("./settings");
const dayjs = require("dayjs");
const { UptimeKumaServer } = require("./uptime-kuma-server");

const server = UptimeKumaServer.getInstance();

/**
 * Build a rate limit key for auth attempts.
 * @param {express.Request} req Express request
 * @param {string} username Username
 * @param {string} prefix Key prefix
 * @returns {Promise<string>} Rate limit key
 */
async function buildAuthRateLimitKey(req, username, prefix) {
    const clientIP = await server.getClientIPwithProxy(
        req.connection?.remoteAddress || req.socket?.remoteAddress || "",
        req.headers
    );
    const normalizedUser = (username || "").trim().toLowerCase() || "unknown";
    const normalizedIP = clientIP || "unknown";
    return `${prefix}:${normalizedIP}:${normalizedUser}`;
}

/**
 * Login to web app
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @returns {Promise<(Bean|null)>} User or null if login failed
 */
exports.login = async function (username, password) {
    if (typeof username !== "string" || typeof password !== "string") {
        return null;
    }

    let user = await R.findOne("user", "TRIM(username) = ? AND active = 1 ", [username.trim()]);

    if (user && passwordHash.verify(password, user.password)) {
        // Upgrade the hash to bcrypt
        if (passwordHash.needRehash(user.password)) {
            await R.exec("UPDATE `user` SET password = ? WHERE id = ? ", [
                await passwordHash.generate(password),
                user.id,
            ]);
        }
        return user;
    }

    return null;
};

/**
 * Validate a provided API key
 * @param {string} key API key to verify
 * @returns {boolean} API is ok?
 */
async function verifyAPIKey(key) {
    if (typeof key !== "string") {
        return false;
    }

    // uk prefix + key ID is before _
    let index = key.substring(2, key.indexOf("_"));
    let clear = key.substring(key.indexOf("_") + 1, key.length);

    let hash = await R.findOne("api_key", " id=? ", [index]);

    if (hash === null) {
        return false;
    }

    let current = dayjs();
    let expiry = dayjs(hash.expires);
    if (expiry.diff(current) < 0 || !hash.active) {
        return false;
    }

    return hash && passwordHash.verify(clear, hash.key);
}

/**
 * Callback for basic auth authorizers
 * @callback authCallback
 * @param {any} err Any error encountered
 * @param {boolean} authorized Is the client authorized?
 */

/**
 * Custom authorizer for express-basic-auth
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @param {authCallback} callback Callback to handle login result
 * @returns {void}
 */
function apiAuthorizer(req, username, password, callback) {
    buildAuthRateLimitKey(req, username, "api").then((rateLimitKey) => {
        apiRateLimiter.pass(rateLimitKey, null, 0).then((pass) => {
            if (pass) {
                verifyAPIKey(password).then((valid) => {
                    if (!valid) {
                        log.warn("api-auth", `Failed API auth attempt: invalid API Key (${rateLimitKey})`);
                        apiRateLimiter.removeTokens(rateLimitKey, 1);
                    }
                    callback(null, valid);
                });
            } else {
                log.warn("api-auth", `Failed API auth attempt: rate limit exceeded (${rateLimitKey})`);
                callback(null, false);
            }
        });
    });
}

/**
 * Custom authorizer for express-basic-auth
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @param {authCallback} callback Callback to handle login result
 * @returns {void}
 */
function userAuthorizer(req, username, password, callback) {
    buildAuthRateLimitKey(req, username, "login").then((rateLimitKey) => {
        loginRateLimiter.pass(rateLimitKey, null, 0).then((pass) => {
            if (pass) {
                exports.login(username, password).then((user) => {
                    callback(null, user != null);

                    if (user == null) {
                        log.warn(
                            "basic-auth",
                            `Failed basic auth attempt: invalid username/password (${rateLimitKey})`
                        );
                        loginRateLimiter.removeTokens(rateLimitKey, 1);
                    }
                });
            } else {
                log.warn("basic-auth", `Failed basic auth attempt: rate limit exceeded (${rateLimitKey})`);
                callback(null, false);
            }
        });
    });
}

/**
 * Use basic auth if auth is not disabled
 * @param {express.Request} req Express request object
 * @param {express.Response} res Express response object
 * @param {express.NextFunction} next Next handler in chain
 * @returns {Promise<void>}
 */
exports.basicAuth = async function (req, res, next) {
    const middleware = basicAuth({
        authorizer: (username, password, callback) => userAuthorizer(req, username, password, callback),
        authorizeAsync: true,
        challenge: true,
    });

    const disabledAuth = await setting("disableAuth");

    if (!disabledAuth) {
        middleware(req, res, next);
    } else {
        next();
    }
};

/**
 * Use use API Key if API keys enabled, else use basic auth
 * @param {express.Request} req Express request object
 * @param {express.Response} res Express response object
 * @param {express.NextFunction} next Next handler in chain
 * @returns {Promise<void>}
 */
exports.apiAuth = async function (req, res, next) {
    if (!(await Settings.get("disableAuth"))) {
        let usingAPIKeys = await Settings.get("apiKeysEnabled");
        let middleware;
        if (usingAPIKeys) {
            middleware = basicAuth({
                authorizer: (username, password, callback) => apiAuthorizer(req, username, password, callback),
                authorizeAsync: true,
                challenge: true,
            });
        } else {
            middleware = basicAuth({
                authorizer: (username, password, callback) => userAuthorizer(req, username, password, callback),
                authorizeAsync: true,
                challenge: true,
            });
        }
        middleware(req, res, next);
    } else {
        next();
    }
};
