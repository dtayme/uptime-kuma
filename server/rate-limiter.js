const { RateLimiter } = require("limiter");
const { log } = require("../src/util");

class KumaRateLimiter {
    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config) {
        this.errorMessage = config.errorMessage;
        this.rateLimiter = new RateLimiter(config);
    }

    /**
     * Callback for pass
     * @callback passCB
     * @param {object} err Too many requests
     */

    /**
     * Should the request be passed through
     * @param {passCB} callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(callback, num = 1) {
        const remainingRequests = await this.removeTokens(num);
        log.info("rate-limit", "remaining requests: " + remainingRequests);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(num = 1) {
        return await this.rateLimiter.removeTokens(num);
    }
}

class KeyedRateLimiter {
    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config) {
        const { errorMessage, maxEntries, ttlMs, ...rateConfig } = config;
        this.errorMessage = errorMessage;
        this.rateConfig = rateConfig;
        this.maxEntries = maxEntries ?? 5000;
        this.ttlMs = ttlMs ?? 60 * 60 * 1000;
        this.limiters = new Map();
    }

    /**
     * Get limiter for a given key.
     * @param {string} key Limiter key
     * @returns {RateLimiter} Rate limiter instance
     */
    getLimiter(key) {
        const now = Date.now();
        const limiterKey = key || "global";
        let entry = this.limiters.get(limiterKey);

        if (entry && now - entry.lastSeen > this.ttlMs) {
            this.limiters.delete(limiterKey);
            entry = null;
        }

        if (!entry) {
            entry = {
                limiter: new RateLimiter(this.rateConfig),
                lastSeen: now,
            };
            this.limiters.set(limiterKey, entry);
        } else {
            entry.lastSeen = now;
        }

        if (this.limiters.size > this.maxEntries) {
            for (const [mapKey, value] of this.limiters) {
                if (now - value.lastSeen > this.ttlMs) {
                    this.limiters.delete(mapKey);
                }
                if (this.limiters.size <= this.maxEntries) {
                    break;
                }
            }
        }

        return entry.limiter;
    }

    /**
     * Should the request be passed through for the given key.
     * @param {string} key Limiter key
     * @param {passCB} callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(key, callback, num = 1) {
        const remainingRequests = await this.removeTokens(key, num);
        log.info("rate-limit", `remaining requests (${key || "global"}): ${remainingRequests}`);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens for a key.
     * @param {string} key Limiter key
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(key, num = 1) {
        return await this.getLimiter(key).removeTokens(num);
    }
}

const loginRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 20,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const apiRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 60,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const twoFaRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 30,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const setupRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 10,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

module.exports = {
    loginRateLimiter,
    apiRateLimiter,
    twoFaRateLimiter,
    setupRateLimiter,
};
